from typing import Any, Dict, List
import json
import re
import asyncio
import time
from Brain.shared.agent import BaseAgent
from Brain.shared.build_standards import TASK_ORDER_STANDARDS, INTEGRATION_TASK_TEMPLATE
from Brain.services.template_service import normalize_framework
from langchain_core.messages import SystemMessage, HumanMessage

LOG = "[TODO]"
MIN_TODOS = 3
MAX_TODOS = 15


def _is_frontend_only_request(prompt: str) -> bool:
    """Landing pages and frontend-only prompts should not auto-create backend/database tasks."""
    if not isinstance(prompt, str):
        return False
    text = prompt.lower()
    frontend_only_markers = [
        "landing page", "homepage", "hero section", "marketing page", "portfolio page",
        "frontend only", "front-end only", "ui only", "design only", "no backend",
        "no database", "static website", "single page website", "splash page", "promo page"
    ]
    backend_markers = [
        "backend", "api", "database", "supabase", "postgres", "auth", "login system",
        "crud", "rest api", "server", "models", "schema", "db"
    ]
    if any(marker in text for marker in frontend_only_markers):
        return True
    if any(marker in text for marker in backend_markers):
        return False
    return False


def _compact_plan(plan: dict) -> str:
    """Return task-relevant sections of the plan. Falls back to a generous
    portion of the full markdown when sections are thin, so context is never
    lost (prevents hallucinating generic tasks).

    When the planner provides the structured `architecture` block, it is
    injected verbatim — the Todo Agent then reads exact pages/components/
    tables/api_routes instead of parsing markdown."""
    if not isinstance(plan, dict):
        return str(plan)
    name = plan.get("project_name", "Project")
    stack = plan.get("tech_stack", [])
    markdown = str(plan.get("markdown_plan", "") or "")

    out = f"Project: {name}"
    if stack:
        out += f"\nTech Stack: {json.dumps(stack)}"

    arch = plan.get("architecture")
    if isinstance(arch, dict) and arch:
        arch_trimmed = json.dumps(arch, default=str)[:4000]
        out += f"\n\nARCHITECTURE SPEC (authoritative source — pages with their components, tables with columns, api_routes with methods. Use these EXACT names):\n{arch_trimmed}"

    stack_map = plan.get("stack")
    if isinstance(stack_map, dict) and stack_map:
        out += f"\n\nSTACK SPEC: {json.dumps(stack_map, default=str)[:800]}"

    keep_headers = (
        "overview", "architecture", "data model", "key pages", "pages",
        "components to build", "components & utilities", "implementation steps",
        "utilities & helpers", "frontend", "backend", "features", "schema",
        "database", "api", "routes", "endpoints", "auth", "data storage",
        "models", "tables",
    )
    sections = []
    if markdown:
        current: List[str] = []
        for line in markdown.splitlines():
            if line.startswith("##"):
                if current:
                    sections.append(current)
                    current = []
            current.append(line)
        if current:
            sections.append(current)
        kept = [s for s in sections if any(h in s[0].lower() for h in keep_headers)]
        kept_text = "\n\n".join("\n".join(s) for s in kept) if kept else ""
        if not kept or len(kept_text) < 2000:
            compact = markdown[:5000]
        else:
            compact = kept_text[:5000]
        if compact:
            out += f"\n\nPlan Details:\n{compact}"
    return out


def _normalize_task(task: Dict[str, Any]) -> Dict[str, Any]:
    """Coerce structured task output into a Builder-compatible shape.
    Composes the free-text description from structured fields (files/ui/api/acceptance)
    so legacy consumers (BuilderAgent, service.py) keep working unchanged."""
    if not isinstance(task, dict):
        return task
    task.setdefault("category", "frontend")
    task.setdefault("skill_required", "implement")

    files = task.get("files")
    if not isinstance(files, list):
        files = []
    ui = task.get("ui")
    if not isinstance(ui, list):
        ui = []
    api = task.get("api")
    if not isinstance(api, list):
        api = []
    acc = task.get("acceptance") or task.get("acceptance_criteria")
    if isinstance(acc, str):
        acc = [acc]
    if not isinstance(acc, list):
        acc = []

    if acc:
        task["acceptance_criteria"] = "; ".join(str(a) for a in acc)

    parts = []
    if files:
        parts.append("Files: " + ", ".join(str(f) for f in files))
    if ui:
        parts.append("UI: " + ", ".join(str(u) for u in ui))
    if api:
        parts.append("API: " + ", ".join(str(a) for a in api))
    if acc:
        parts.append("Acceptance: " + "; ".join(str(a) for a in acc))

    desc = task.get("description") or ""
    if len(desc) < 80 and parts:
        desc = desc.rstrip()
        if desc and not desc.endswith((".", "!", "?")):
            desc += "."
        task["description"] = ((desc + " ") if desc else "") + "\n".join(parts)

    task["files"] = files
    task["ui"] = ui
    task["api"] = api
    return task


def clamp_todo_list(tasks: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    if not isinstance(tasks, list):
        return tasks

    runner = None
    rest = []
    for t in tasks:
        if t.get("category") == "runner":
            runner = t
        else:
            rest.append(t)

    if len(rest) > MAX_TODOS - 1:
        rest = rest[: MAX_TODOS - 1]

    merged = rest + ([runner] if runner else [])
    if not runner and merged:
        merged[-1] = {
            **merged[-1],
            "category": "runner",
            "title": merged[-1].get("title", "Start dev servers"),
            "description": merged[-1].get(
                "description",
                "Install dependencies and start frontend dev server for preview.",
            ),
        }

    has_runner = runner or any(t.get("category") == "runner" for t in merged)
    non_runner = [t for t in merged if t.get("category") != "runner"]
    pad_guard = 0
    while len(non_runner) < MIN_TODOS and len(merged) < MAX_TODOS and pad_guard < 5:
        pad_guard += 1
        n = len(merged) + 1
        merged.insert(
            -1 if has_runner else len(merged),
            {
                "id": f"t{n}",
                "title": f"Implementation step {n}",
                "description": "Continue building per the approved plan.",
                "category": "frontend",
                "skill_required": "implement",
                "acceptance_criteria": "Feature works in preview",
            },
        )
        non_runner = [t for t in merged if t.get("category") != "runner"]

    if len(merged) > MAX_TODOS:
        merged = merged[:MAX_TODOS]

    merged = _ensure_integration_task(merged)
    return merged


def _ensure_integration_task(tasks: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Penultimate task: wire App.jsx, router, server.js mounts, API forms."""
    runner_idx = next(
        (i for i, t in enumerate(tasks) if t.get("category") == "runner"),
        len(tasks),
    )
    wire_keys = ("wire", "integrat", "app.jsx", "router", "connect", "mount")
    has_wire = any(
        any(k in f"{t.get('title', '')} {t.get('description', '')}".lower() for k in wire_keys)
        for t in tasks
        if t.get("category") != "runner"
    )
    if has_wire:
        return tasks
    wire = {**INTEGRATION_TASK_TEMPLATE, "id": f"t-wire-{len(tasks)}"}
    if runner_idx >= len(tasks):
        tasks.append(wire)
    else:
        tasks.insert(runner_idx, wire)
    if len(tasks) > MAX_TODOS:
        runners = [t for t in tasks if t.get("category") == "runner"][:1]
        others = [t for t in tasks if t.get("category") != "runner" and t is not wire]
        budget = max(0, MAX_TODOS - len(runners) - 1)
        tasks = others[:budget] + [wire] + runners
    return tasks


def _fallback_from_architecture(plan: dict, backend_routes: List[str], scope: str = "all") -> List[Dict[str, Any]]:
    """Deterministic fallback tasks derived from the plan's `architecture`
    (pages -> frontend, tables -> database, api_routes -> backend). Never
    generic Hero/Features/Contact landing pages. `scope` filters to
    "build" (database+backend) or "frontend" for the parallel calls."""
    arch = plan.get("architecture") if isinstance(plan, dict) else None
    if not isinstance(arch, dict):
        arch = {}
    tasks: List[Dict[str, Any]] = []
    n = 0

    def next_id() -> str:
        nonlocal n
        n += 1
        return f"t{n}"

    def parent_dep() -> List[str]:
        for t in reversed(tasks):
            if t["category"] != "frontend":
                return [t["id"]]
        return []

    tables = arch.get("tables", [])
    table_names = []
    if isinstance(tables, list):
        for tb in tables:
            if isinstance(tb, dict) and tb.get("name"):
                table_names.append(str(tb["name"]))
            elif isinstance(tb, str):
                table_names.append(tb)
    if table_names:
        tasks.append({
            "id": next_id(),
            "title": f"Supabase schema: {', '.join(table_names[:5])}",
            "description": f"Provision database schema for {', '.join(table_names)} in backend/supabase/schema.sql. Use physical domain tables for connected Supabase users (default) and shared tenant_connector_vault mode otherwise. Run via supabase_exec_sql.",
            "category": "database",
            "skill_required": "database",
            "files": ["backend/supabase/schema.sql"],
            "ui": [],
            "api": [],
            "acceptance": [f"Schema for {', '.join(table_names[:3])} created in selected storage mode", "RLS and indexes are applied", "Tenant data stays isolated"],
            "depends_on": [],
        })

    if backend_routes:
        tasks.append({
            "id": next_id(),
            "title": "Backend API routes",
            "description": f"Implement {', '.join(backend_routes[:6])} in backend/routes/ and mount in backend/server.js.",
            "category": "backend",
            "skill_required": "backend",
            "files": ["backend/routes/api.js", "backend/server.js"],
            "ui": [],
            "api": list(backend_routes),
            "acceptance": [f"All {len(backend_routes)} routes mounted in server.js", "Persistence flows through the Python proxy"],
            "depends_on": [tasks[0]["id"]] if tasks else [],
        })

    pages = arch.get("pages", [])
    if isinstance(pages, list):
        for p in pages:
            if not isinstance(p, dict):
                continue
            pname = str(p.get("name") or "Page")
            route = str(p.get("route") or f"/{pname.lower().replace(' ', '-')}")
            comps = p.get("components")
            if not isinstance(comps, list):
                comps = []
            comps = [str(c) for c in comps]
            slug = pname.replace(" ", "")
            files = [f"frontend/src/pages/{slug}.jsx"]
            files += [f"frontend/src/components/{c.replace(' ', '')}.jsx" for c in comps[:4]]
            tasks.append({
                "id": next_id(),
                "title": f"Build {pname} page",
                "description": f"Page at route {route} with Tailwind UI.",
                "category": "frontend",
                "skill_required": "frontend",
                "files": files,
                "ui": comps or [pname],
                "api": list(backend_routes),
                "acceptance": [f"{pname} renders real data at {route}", "Components imported in App.jsx"],
                "depends_on": parent_dep(),
            })

    shared_components = arch.get("components", [])
    if isinstance(shared_components, list) and shared_components:
        comps = [str(c) for c in shared_components]
        tasks.append({
            "id": next_id(),
            "title": "Shared components",
            "description": f"Build shared components {', '.join(comps[:8])} with Tailwind.",
            "category": "frontend",
            "skill_required": "frontend",
            "files": [f"frontend/src/components/{c.replace(' ', '')}.jsx" for c in comps[:5]],
            "ui": comps,
            "api": [],
            "acceptance": ["Shared components render in preview"],
            "depends_on": parent_dep(),
        })

    if scope == "build":
        return [t for t in tasks if t.get("category") in ("database", "backend")]
    if scope == "frontend":
        return [t for t in tasks if t.get("category") == "frontend"]
    return tasks


def _merge_scoped_tasks(build_tasks: List[Dict[str, Any]], fe_tasks: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Merge the two parallel scoped LLM outputs into one canonical task list.
    Build tasks (database/backend) go first, frontend after. All ids are
    renumbered sequentially; dependencies are remapped across scopes.
    `@db` / `@backend` placeholders (frontend -> backend deps) resolve to the
    real merged ids. Any leftovers are cleaned by _validate_dependencies."""
    merged: List[Dict[str, Any]] = []
    id_map: Dict[str, str] = {}

    for scope, lst in (("b", build_tasks), ("f", fe_tasks)):
        for t in lst:
            if not isinstance(t, dict):
                continue
            local = str(t.get("id") or f"{scope}{len(merged) + 1}")
            new_id = f"t{len(merged) + 1}"
            id_map[f"{scope}:{local}"] = new_id
            t["id"] = new_id
            merged.append(t)

    db_id = next((t["id"] for t in merged if t.get("category") == "database"), None)
    backend_id = next((t["id"] for t in merged if t.get("category") == "backend"), None)

    for t in merged:
        deps = t.get("depends_on")
        if not isinstance(deps, list):
            continue
        new_deps = []
        for d in deps:
            d = str(d)
            if d == "@db":
                new_deps.append(db_id or backend_id)
            elif d == "@backend" or d.startswith("@"):
                new_deps.append(backend_id or db_id)
            elif d in id_map:
                new_deps.append(id_map[d])
            else:
                new_deps.append(d)
        t["depends_on"] = [x for x in new_deps if x]
    return merged


def _enforce_file_limit(tasks: List[Dict[str, Any]], max_files: int = 5) -> List[Dict[str, Any]]:
    """Split tasks with more than max_files files into chained tasks so the
    Builder never receives an oversized task. If the list is already at
    MAX_TODOS, truncate files instead (log it)."""
    if not isinstance(tasks, list):
        return tasks
    out: List[Dict[str, Any]] = []
    for t in tasks:
        if not isinstance(t, dict):
            out.append(t)
            continue
        files = t.get("files")
        if not isinstance(files, list) or len(files) <= max_files:
            out.append(t)
            continue
        if len(out) >= MAX_TODOS:
            dropped = len(files) - max_files
            print(f"{LOG} ⚠ {t.get('id')}: task budget full — truncated {dropped} files to {max_files}", flush=True)
            t["files"] = files[:max_files]
            out.append(t)
            continue
        chunks = [files[i:i + max_files] for i in range(0, len(files), max_files)]
        base_id = str(t.get("id") or f"t{len(out) + 1}")
        prev_id = base_id
        for ci, chunk in enumerate(chunks):
            if ci == 0:
                t["files"] = chunk
                out.append(t)
                continue
            nt = {k: v for k, v in t.items() if k != "id"}
            nt["id"] = f"{base_id}-f{ci + 1}"
            nt["files"] = chunk
            nt["depends_on"] = [prev_id]
            out.append(nt)
            prev_id = nt["id"]
        print(f"{LOG} ℹ {base_id}: split {len(files)} files into {len(chunks)} tasks", flush=True)
    return out


def _validate_dependencies(tasks: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Guarantee a valid DAG: list order is build order, so depends_on may only
    reference tasks that exist and appear earlier in the list (no self/forward/
    cyclic refs). Drops invalid refs with a log line."""
    if not isinstance(tasks, list):
        return tasks
    index: Dict[str, int] = {}
    for i, t in enumerate(tasks):
        if isinstance(t, dict) and t.get("id"):
            index[str(t["id"])] = i
    for i, t in enumerate(tasks):
        if not isinstance(t, dict):
            continue
        tid = str(t.get("id") or f"t{i + 1}")
        if not t.get("id"):
            t["id"] = tid
        deps = t.get("depends_on")
        if not isinstance(deps, list):
            t["depends_on"] = []
            continue
        kept = []
        for d in deps:
            d = str(d)
            if d == tid:
                print(f"{LOG} ⚠ {tid}: dropped self-dependency {d}", flush=True)
            elif d not in index:
                print(f"{LOG} ⚠ {tid}: dropped unknown dependency {d}", flush=True)
            elif index[d] >= i:
                print(f"{LOG} ⚠ {tid}: dropped forward/cyclic dependency {d} (must come earlier in build order)", flush=True)
            else:
                kept.append(d)
        t["depends_on"] = kept
    return tasks


class TodoAgent(BaseAgent):
    def __init__(self):
        super().__init__(
            name="Todo",
            description="Converts the approved plan into executable tasks (3–15).",
            model_id="llama-4-scout-17b-16e-instruct",
        )

    async def execute(self, state: Dict[str, Any]) -> Dict[str, Any]:
        plan_raw = state.get("project_plan", {})
        framework = normalize_framework(state.get("framework"))
        
        # Handle both dict and string plan formats
        if isinstance(plan_raw, str):
            try:
                import json as _json
                plan = _json.loads(plan_raw)
            except Exception:
                plan = {"markdown_plan": plan_raw, "project_name": "Project"}
        elif isinstance(plan_raw, dict):
            plan = plan_raw
        else:
            plan = {"project_name": "Project"}
        
        print(f"{LOG} ═══ EXECUTE ═══ plan_name='{plan.get('project_name', 'N/A')}' | framework={framework} | plan_type={type(state.get('project_plan')).__name__}", flush=True)

        prompt_text = str(state.get("content") or "")
        frontend_only = _is_frontend_only_request(prompt_text)
        if frontend_only:
            print(f"{LOG} Frontend-only request detected — suppressing backend/database task generation", flush=True)

        memory_context = state.get("memory_context", {})
        session_state = memory_context.get("session_state", {})
        active_decisions = memory_context.get("decisions", {})
        wf_state = session_state.get("workflow_state", "")
        cur_agent = session_state.get("current_agent", "")
        task_idx = session_state.get("task_index", "")
        total_tk = session_state.get("total_tasks", "")
        session_summary_parts = []
        if wf_state: session_summary_parts.append(f"Phase: {wf_state}")
        if cur_agent: session_summary_parts.append(f"Active Agent: {cur_agent}")
        if task_idx or total_tk: session_summary_parts.append(f"Task: {task_idx}/{total_tk}")
        session_context = f"[Session] {' | '.join(session_summary_parts)}" if session_summary_parts else ""

        decisions_context = ""
        if active_decisions:
            decisions_lines = [f"  {k}: {v}" for k, v in active_decisions.items()]
            decisions_context = "[Approved Decisions - MUST FOLLOW]\n" + "\n".join(decisions_lines)

        system_prompt = f"""
        You are the Todo Agent. Convert the approved project plan into executable tasks that produce a **fully connected** app in preview.

        {TASK_ORDER_STANDARDS}

        SELECTED FRONTEND FRAMEWORK: {framework}
        - React/Vite: use existing `frontend/` react-template (do NOT re-scaffold).

        HARD LIMITS:
        - Between {MIN_TODOS} and {MAX_TODOS} tasks (including runner).
        - MAX 5 FILES PER TASK (any category — frontend, backend, database).
        - If a task needs more than 5 files, SPLIT it into multiple tasks.
        - Frontend: max 2-3 components per task.
        - Backend: max 3-4 routes/controllers per task.
        - Each file generates one LLM call (~30-60s), so 5 files = ~5 minutes per task.

        CRITICAL: FOLLOW THE PLAN EXACTLY. Do NOT add generic components (Hero, Features, Contact) unless the plan specifically mentions them.
        If the plan includes an "ARCHITECTURE SPEC" block, it is AUTHORITATIVE — use it as the primary source:
        - create a database task for EVERY table in `tables` (use its exact column names/types)
        - create a backend task for EVERY route in `api_routes` (use its exact path + method)
        - create a frontend task for EVERY page in `pages` (each page's nested components are its own — keep them in that page's task or a focused page task)
        - shared components (top-level `components`) go with the page that needs them or a shared-components task
        Use those exact names and routes — do NOT invent or rename anything. The `architecture` object is your PRIMARY input. `markdown_plan` is ONLY secondary/descriptive context — when they conflict, follow the ARCHITECTURE SPEC.
        Execution grouping, file grouping, task count, and build order are YOUR responsibility — derive them from the architecture.

        REQUIRED TASK ORDER:
        1. **database** — Create Supabase tables matching the plan's Data Models (Tasks, Categories, etc.) in `backend/supabase/schema.sql`. Use `supabase_exec_sql` to create tables.
        2. **backend** — Express routes + controllers for the plan's API endpoints. Mount in `server.js`.
        3. **frontend** — Components and pages from the plan's "Key Pages & Components" section.
        4. **frontend** — Wire App.jsx with React Router, import ALL components, connect to backend API.
        5. **runner** — last task only; title like "Runner: Install Dependencies & Start Servers".

        RULES:
        - Do NOT plan supabase CLI or npm install/dev in build tasks.
        - Frontend tasks must mention wiring components into App.jsx in acceptance_criteria.
        - Backend tasks must mention mounting routes in server.js in acceptance_criteria.
        - EVERY frontend task must specify REAL UI content with Tailwind CSS styling (NOT placeholders)
        - Frontend tasks must connect to the backend's real `/api/*` routes via `frontend/src/lib/api.js`.
        - CRITICAL: Integration task MUST validate React Router v6 syntax (Routes not Switch, element=Component not component=Component)
        - CRITICAL: Do NOT create README files, documentation, or placeholder content.
        - CRITICAL: Do NOT create generic landing pages unless the plan specifically asks for them.

        TASK CATEGORIES: frontend | backend | database | runner

        Respond ONLY with a JSON array. Each task is a STRUCTURED object with short, precise values (no long prose):
        [
          {{
            "id": "t1",
            "title": "Task Title",
            "category": "frontend",
            "skill_required": "implement",
            "files": ["frontend/src/components/Dashboard.jsx", "frontend/src/components/StatsCard.jsx"],
            "ui": ["sidebar", "stats cards", "chart", "dark theme"],
            "api": ["/api/dashboard", "/api/stats"],
            "depends_on": ["t2"],
            "acceptance": ["Dashboard renders real stats from /api/dashboard", "Components imported in App.jsx"]
          }}
        ]

        FIELD GUIDE:
        - files: EXACT file paths to create or modify (max 5). CRITICAL — the Builder writes exactly these files.
        - ui: specific UI elements/components to build with Tailwind styling (no placeholders).
        - api: exact /api/* endpoints this task connects to (only routes from the plan).
        - depends_on: task ids that must finish first (empty if none).
        - acceptance: 2-3 concrete verification checks.
        - description: OPTIONAL — only a short 1-2 sentence summary if needed.
        """

        base_msgs = []
        if session_context:
            base_msgs.append(SystemMessage(content=session_context))
        if decisions_context:
            base_msgs.append(SystemMessage(content=decisions_context))
        base_msgs.append(HumanMessage(content=f"Approved Plan: {_compact_plan(plan)}"))

        build_prompt = system_prompt + (
            "\n\nSCOPE: Return ONLY database and backend tasks (Supabase tables + Express API routes/controllers). "
            "Do NOT create frontend or runner tasks. For dependencies within this list use the ids you assign."
        )
        if frontend_only:
            build_prompt += "\n\nIMPORTANT: This request is frontend-only / landing-page focused. Do NOT create database or backend tasks. Return an empty JSON array for the build scope."
        fe_prompt = system_prompt + (
            "\n\nSCOPE: Return ONLY frontend tasks (pages with their nested components, shared components, and the "
            "final App.jsx wiring/integration task). Do NOT create database, backend, or runner tasks. "
            "For dependencies on database/backend work use the placeholder '@db' (tables) or '@backend' (API routes). "
            "Within this list use the ids you assign."
        )
        if frontend_only:
            fe_prompt += "\n\nIMPORTANT: This is a landing-page/frontend-only request. Keep the scope strictly on UI: sections, components, and App.jsx wiring only. No backend, database, auth, or server tasks."

        async def _scope_call(sys: str, timeout: float, max_tok: int):
            """Call LLM with automatic fallback to deepseek-v4-flash on rate limit."""
            msgs = [SystemMessage(content=sys)] + list(base_msgs)
            # Try primary model first
            try:
                result = await self.chat(msgs, model_id="llama-4-scout-17b-16e-instruct", timeout=timeout, max_tokens=max_tok)
                if result and not result.startswith('{"error"'):
                    return result
            except Exception as e:
                err_str = str(e)
                is_rate_limit = ("429" in err_str or "RateLimit" in type(e).__name__
                                 or "engine_overloaded" in err_str or "Model busy" in err_str)
                if not is_rate_limit:
                    raise
                print(f"{LOG} ↻ llama-4-scout rate limited — switching to deepseek-v4-flash", flush=True)

            # Fallback to deepseek-v4-flash
            import asyncio as _aio
            await _aio.sleep(1.0)  # brief pause before fallback
            try:
                result = await self.chat(msgs, model_id="deepseek-v4-flash", timeout=timeout, max_tokens=max_tok)
                print(f"{LOG} ✓ deepseek-v4-flash fallback succeeded", flush=True)
                return result
            except Exception as e2:
                print(f"{LOG} ✖ Fallback also failed: {e2}", flush=True)
                return '{"error": "LLM call failed"}'

        print(f"{LOG} Calling LLM — 2 scoped calls in parallel (build + frontend), total chars={sum(len(m.content) for m in base_msgs)}", flush=True)
        _t0 = time.time()
        build_raw, fe_raw = await asyncio.gather(
            _scope_call(build_prompt, 90, 900),
            _scope_call(fe_prompt, 90, 1100),
        )
        print(f"{LOG} Both scoped calls done in {time.time() - _t0:.1f}s | build={len(build_raw)} chars | frontend={len(fe_raw)} chars", flush=True)
        print(f"{LOG} ─ BUILD HEAD: {build_raw[:1500]}", flush=True)
        print(f"{LOG} ─ FRONTEND HEAD: {fe_raw[:1500]}", flush=True)
        build_tasks = self._format_json_response(build_raw)
        fe_tasks = self._format_json_response(fe_raw)

        # Deterministic route extraction: architecture.api_routes is the source
        # of truth (no regex over free text). Regex fallback only for legacy
        # plans that predate the structured architecture.
        backend_routes = []
        arch = plan.get("architecture") if isinstance(plan, dict) else None
        if isinstance(arch, dict):
            arch_routes = arch.get("api_routes", [])
            if isinstance(arch_routes, list):
                for r in arch_routes:
                    if isinstance(r, dict) and r.get("path"):
                        backend_routes.append(str(r["path"]))
                    elif isinstance(r, str):
                        backend_routes.append(r)
        if not backend_routes:
            markdown_only = plan.get("markdown_plan") if isinstance(plan, dict) else ""
            if isinstance(markdown_only, str):
                backend_routes = re.findall(r"/api/[A-Za-z][A-Za-z0-9_/]*", markdown_only)
        backend_routes = sorted(set(backend_routes))
        route_hint = "Available backend routes: " + ", ".join(backend_routes) + "."
        if not backend_routes:
            route_hint = "Use frontend/src/lib/api.js (apiGet/apiPost/apiPut/apiDelete) for any data calls; see backend tasks for exact /api/* routes."

        if frontend_only:
            backend_routes = []
            build_tasks = []
            plan = plan.copy() if isinstance(plan, dict) else plan
            if isinstance(plan, dict):
                arch = plan.setdefault("architecture", {})
                arch["tables"] = []
                arch["api_routes"] = []
                arch["pages"] = arch.get("pages") or [{"name": "Landing Page", "route": "/", "components": ["HeroSection", "Features", "Testimonials", "CTASection"]}]
            print(f"{LOG} frontend-only request: forcing build scope empty and clearing API/database architecture", flush=True)
        if not isinstance(build_tasks, list):
            print(f"{LOG} ⚠ build scope failed ({build_tasks.get('error') if isinstance(build_tasks, dict) else str(build_tasks)[:150]}) — deterministic fallback", flush=True)
            build_tasks = [t for t in _fallback_from_architecture(plan, backend_routes, "build")
                           if t.get("category") in ("database", "backend")]
        if frontend_only:
            build_tasks = []
        if not isinstance(fe_tasks, list):
            print(f"{LOG} ⚠ frontend scope failed ({fe_tasks.get('error') if isinstance(fe_tasks, dict) else str(fe_tasks)[:150]}) — deterministic fallback", flush=True)
            fe_tasks = [t for t in _fallback_from_architecture(plan, backend_routes, "frontend")
                        if t.get("category") == "frontend"]

        tasks = _merge_scoped_tasks(build_tasks, fe_tasks)
        tasks = [_normalize_task(t) for t in tasks]

        # Shared frontend enrichment (route hints + no-duplicate guard)
        for task in tasks:
            if task.get("category") == "frontend":
                desc = task.get("description", "") or ""
                desc = desc.rstrip()
                if desc and not desc.endswith((".", "!", "?")):
                    desc += "."
                desc += f" Connect forms/lists to the backend using `frontend/src/lib/api.js`; {route_hint}"
                desc += " Do NOT create duplicate/overlapping components (avoid both Home.jsx and HomePage.jsx); reuse existing component names."
                task["description"] = desc
                if not task.get("api") and backend_routes:
                    task["api"] = list(backend_routes)

        tasks = clamp_todo_list(tasks)
        tasks = _enforce_file_limit(tasks)
        tasks = _validate_dependencies(tasks)

        import re as _re
        for task in tasks:
            title = task.get("title", "")
            title = _re.sub(r'[^\w\s\-:.,&+()/]', '', title).strip()
            title = _re.sub(r'\s{2,}', ' ', title)
            if len(title) > 80:
                title = title[:80].rsplit(' ', 1)[0]
            task["title"] = title or f"Task {task.get('id', 'unknown')}"

        print(f"DEBUG: TodoAgent produced {len(tasks)} tasks (clamp {MIN_TODOS}-{MAX_TODOS})")

        state["tasks"] = tasks
        state["status"] = "tasks_ready"
        state["next_agent"] = "builder"
        return state
