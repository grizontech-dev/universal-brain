from typing import Any, Dict, List
import json
from Brain.shared.agent import BaseAgent
from Brain.shared.build_standards import FULL_STACK_BUILD_STANDARDS, INTEGRATION_TASK_TEMPLATE
from Brain.services.template_service import normalize_framework
from langchain_core.messages import SystemMessage, HumanMessage

MIN_TODOS = 3
MAX_TODOS = 15


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
            model_id="deepseek-chat",
        )

    async def execute(self, state: Dict[str, Any]) -> Dict[str, Any]:
        plan = state.get("project_plan", {})
        framework = normalize_framework(state.get("framework"))

        session_state = state.get("memory_context", {}).get("session_state", {})
        wf_state = session_state.get("workflow_state", "")
        cur_agent = session_state.get("current_agent", "")
        task_idx = session_state.get("task_index", "")
        total_tk = session_state.get("total_tasks", "")
        session_summary_parts = []
        if wf_state: session_summary_parts.append(f"Phase: {wf_state}")
        if cur_agent: session_summary_parts.append(f"Active Agent: {cur_agent}")
        if task_idx or total_tk: session_summary_parts.append(f"Task: {task_idx}/{total_tk}")
        session_context = f"[Session] {' | '.join(session_summary_parts)}" if session_summary_parts else ""

        system_prompt = f"""
        You are the Todo Agent. Convert the approved project plan into executable tasks that produce a **fully connected** app in preview.

        {FULL_STACK_BUILD_STANDARDS}

        SELECTED FRONTEND FRAMEWORK: {framework}
        - React/Vite: use existing `frontend/` react-template (do NOT re-scaffold).

        HARD LIMITS:
        - Between {MIN_TODOS} and {MAX_TODOS} tasks (including runner).
        - Break down large frontend features into smaller, granular tasks (max 2-3 components per task). Do NOT group all frontend components into a single task.

        REQUIRED TASK ORDER (typical full-stack landing):
        1. **database** — Shared Supabase schema in `backend/supabase/` using the Shared Table + JSONB Data Matrix Pattern (if project needs persistence).
        2. **backend** — Express routes, controllers, and the Python Backend Proxy integration; mount all routes in `server.js`.
        3. **frontend** — Components, pages, Tailwind styling (Navbar, Hero, Features, Contact, etc.).
        4. **frontend** — "Wire App, Router, Backend Proxy & Company Supabase" — rewrite `App.jsx`, react-router-dom, api.js forms, verify server.js mounts (acceptance: preview shows full site, not template demo).
        5. **runner** — last task only; title like "Runner: Install Dependencies & Start Servers".

        RULES:
        - Do NOT plan supabase CLI or npm install/dev in build tasks.
        - Frontend tasks must mention wiring components into App.jsx in acceptance_criteria.
        - Backend tasks must mention mounting routes in server.js in acceptance_criteria.

        TASK CATEGORIES: frontend | backend | database | runner

        Respond ONLY with a JSON array:
        [
          {{
            "id": "t1",
            "title": "Task Title",
            "description": "What to build",
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
        messages.append(HumanMessage(content=f"Approved Plan: {json.dumps(plan)}"))

        response_content = await self.chat(messages, model_id="deepseek-chat")
        tasks = self._format_json_response(response_content)

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

        tasks = clamp_todo_list(tasks)
        print(f"DEBUG: TodoAgent produced {len(tasks)} tasks (clamp {MIN_TODOS}-{MAX_TODOS})")

        state["tasks"] = tasks
        state["status"] = "tasks_ready"
        state["next_agent"] = "builder"
        return state
