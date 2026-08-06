from typing import Any, Dict, List
import json
import re
from Brain.shared.agent import BaseAgent
from Brain.shared.build_standards import FULL_STACK_BUILD_STANDARDS, INTEGRATION_TASK_TEMPLATE
from Brain.services.template_service import normalize_framework
from langchain_core.messages import SystemMessage, HumanMessage

LOG = "[TODO]"
MIN_TODOS = 3
MAX_TODOS = 15


def _compact_plan(plan: dict) -> str:
    """Return only task-relevant sections of the plan instead of the full JSON dump."""
    if not isinstance(plan, dict):
        return str(plan)
    name = plan.get("project_name", "Project")
    stack = plan.get("tech_stack", [])
    markdown = str(plan.get("markdown_plan", "") or "")
    keep_headers = (
        "overview", "architecture", "data model", "key pages",
        "components to build", "components & utilities", "implementation steps",
        "utilities & helpers", "frontend stack", "backend stack",
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
        compact = "\n\n".join("\n".join(s) for s in kept) if kept else markdown[:1500]
    else:
        compact = ""
    out = f"Project: {name}"
    if stack:
        out += f"\nTech Stack: {json.dumps(stack)}"
    if compact:
        out += f"\nPlan Details:\n{compact}"
    return out


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


class TodoAgent(BaseAgent):
    def __init__(self):
        super().__init__(
            name="Todo",
            description="Converts the approved plan into executable tasks (3–15).",
            model_id="deepseek-v4-flash",
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

        {FULL_STACK_BUILD_STANDARDS}

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
        Read the plan's "Key Pages & Components" section and create tasks for EACH component listed there.
        Read the plan's "Data Models" section and create database tasks for EACH model listed there.

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

        Respond ONLY with a JSON array:
        [
          {{
            "id": "t1",
            "title": "Task Title",
            "description": "DETAILED: What to build, exact files, exact UI elements, exact dependencies",
            "category": "frontend",
            "skill_required": "skill",
            "acceptance_criteria": "How to verify"
          }}
        ]
        """

        messages = [
            SystemMessage(content=system_prompt),
        ]
        if session_context:
            messages.append(SystemMessage(content=session_context))
        if decisions_context:
            messages.append(SystemMessage(content=decisions_context))
        messages.append(HumanMessage(content=f"Approved Plan: {_compact_plan(plan)}"))

        print(f"{LOG} Calling LLM now with {len(messages)} messages, total chars={sum(len(m.content) for m in messages)}", flush=True)
        response_content = await self.chat(messages, model_id="deepseek-v4-flash", timeout=120, max_tokens=1800)
        print(f"{LOG} LLM returned {len(response_content)} chars", flush=True)
        tasks = self._format_json_response(response_content)

        import re
        plan_text = ""
        if isinstance(plan, dict):
            for key in ("tasks", "steps", "description", "summary", "content"):
                val = plan.get(key)
                if isinstance(val, str):
                    plan_text += val + " "
                elif isinstance(val, list):
                    plan_text += json.dumps(val) + " "
        elif isinstance(plan, str):
            plan_text = plan
        else:
            plan_text = json.dumps(plan)
        route_pattern = re.compile(r"/api/[A-Za-z][A-Za-z0-9_/]*", re.IGNORECASE)
        backend_routes = sorted(set(route_pattern.findall(plan_text)))
        route_hint = ""
        if backend_routes:
            route_hint = "Available backend routes: " + ", ".join(backend_routes) + "."
        else:
            route_hint = "Use frontend/src/lib/api.js (apiGet/apiPost/apiPut/apiDelete) for any data calls; see backend tasks for exact /api/* routes."

        if isinstance(tasks, list):
            for task in tasks:
                if task.get("category") == "frontend":
                    desc = task.get("description", "") or ""
                    desc = desc.rstrip()
                    if desc and not desc.endswith((".", "!", "?")):
                        desc += "."
                    desc += f" Connect forms/lists to the backend using `frontend/src/lib/api.js`; {route_hint}"
                    desc += " Do NOT create duplicate/overlapping components (avoid both Home.jsx and HomePage.jsx); reuse existing component names."
                    task["description"] = desc

        if not isinstance(tasks, list):
            tasks = [
                {
                    "id": "t1",
                    "title": "Shared Supabase schema",
                    "description": "SQL tables in backend/supabase/ using the Shared Table + JSONB Data Matrix Pattern.",
                    "category": "database",
                    "skill_required": "database",
                    "acceptance_criteria": "Schema file matches API needs and keeps tenant data isolated",
                },
                {
                    "id": "t2",
                    "title": "Express API routes + Python proxy",
                    "description": "Routes, controllers, and the Python Backend Proxy integration mounted in backend/server.js.",
                    "category": "backend",
                    "skill_required": "backend",
                    "acceptance_criteria": "All /api/* routes mounted in server.js and persistence flows through the proxy",
                },
                {
                    "id": "t3",
                    "title": "Landing UI components",
                    "description": "Navbar, Hero, Features, Contact with Tailwind in frontend/src/components/.",
                    "category": "frontend",
                    "skill_required": "frontend",
                    "acceptance_criteria": "Components created under frontend/src/components/",
                },
                {
                    "id": "t4",
                    "title": "Wire App, Router, Backend Proxy & Company Supabase",
                    "description": "Rewrite App.jsx, react-router-dom, api.js forms, and backend proxy wiring.",
                    "category": "frontend",
                    "skill_required": "integration",
                    "acceptance_criteria": "Preview shows full site, not template demo",
                },
                {
                    "id": "t5",
                    "title": "Runner: Install & Start Servers",
                    "description": "Runner starts backend and frontend dev servers.",
                    "category": "runner",
                    "skill_required": "runner",
                    "acceptance_criteria": "Preview loads on port 5173",
                },
            ]
            for task in tasks:
                if task.get("category") == "frontend":
                    desc = task.get("description", "") or ""
                    desc = desc.rstrip()
                    if desc and not desc.endswith((".", "!", "?")):
                        desc += "."
                    desc += f" Connect forms/lists to the backend using `frontend/src/lib/api.js`; {route_hint}"
                    desc += " Do NOT create duplicate/overlapping components (avoid both Home.jsx and HomePage.jsx); reuse existing component names."
                    task["description"] = desc

        tasks = clamp_todo_list(tasks)

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
