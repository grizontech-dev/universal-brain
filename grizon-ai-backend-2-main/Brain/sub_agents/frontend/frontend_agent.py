from typing import Any, Dict, List
import os
import json
from Brain.shared.agent import BaseAgent
from Brain.shared.build_standards import FULL_STACK_BUILD_STANDARDS
from langchain_core.messages import SystemMessage, HumanMessage
from Brain.shared.skills.resolver import SkillResolver
from Brain.shared.review_loop import QualityReviewer

class FrontendAgent(BaseAgent):
    def __init__(self):
        super().__init__(
            name="Frontend Agent",
            description="Specialized in HTML, CSS, JS, React, Angular, Tailwind CSS, and Bootstrap.",
            model_id="gpt-4o-mini"
        )
        self.skill_resolver = SkillResolver()
        self.reviewer = QualityReviewer()

    async def execute(self, current_task: Dict[str, Any], state: Dict[str, Any]) -> Dict[str, Any]:
        task = current_task
        framework = (state.get("framework") or "react").lower()
        plan = state.get("project_plan", {})
        executed = state.get("executed_tasks", [])[-5:]
        
        task_description = f"{task.get('title', '')} {task.get('description', '')}"
        
        skills_content = "{}"
        try:
            skills_content = self.skill_resolver.resolve_skills_for_task(task_description)
        except Exception as e:
            print(f"Skill resolution failed: {e}")
            skills_content = "{}"
        
        system_prompt = f"""
        You are the Frontend Agent for Grizon Brain. Stack: {framework} in `frontend/` (Vite + React template exists).
        You build **production-quality, connected UIs** that appear correctly in the live preview.

        {FULL_STACK_BUILD_STANDARDS}

        SKILLS (follow strictly):
        {skills_content}

        FRONTEND AGENT RULES:
        1. **CRITICAL — Vite entry**: `frontend/src/main.jsx` imports `./App.jsx` ONLY. **`App.tsx` is NEVER used in preview.** All routes and component imports go in `frontend/src/App.jsx`.
        2. **App.jsx is the product** — You MUST include `frontend/src/App.jsx` in every response that adds or changes components.
           Import and render every component you create. Remove template demo (counter, "Grizon React", "ready for Brain to extend").
        3. **FORBIDDEN**: `frontend/src/App.tsx` — do not create it. Use plain JSX in App.jsx (no TypeScript, no `React.FC` types).
        4. **react-router-dom & Connection** — ALWAYS connect all components, pages, and everything in `App.jsx`. If it is a single page application, render the components directly. If there are multiple pages, use `react-router-dom` (BrowserRouter, Routes, Route, Link) to route and connect. Paths must match.
        5. **API integration** — Use `frontend/src/lib/api.js` (`apiGet`, `apiPost`). Example: contact form → `apiPost('/api/contact', formData)`.
        6. **Tailwind** — Use utility classes; add `tailwindcss`, `postcss`, `autoprefixer` to `frontend/package.json` if missing; include `tailwind.config.js` and `src/index.css` with `@tailwind` directives when styling.
        7. **Structure**: `frontend/src/components/` for UI blocks; `frontend/src/pages/` for route pages when using router.
        8. **commands & packages**: ALL packages used in the project MUST be added to `frontend/package.json`. This is critical so that when `npm install` runs, there are no missing package errors and the project runs correctly. If you add ANY new dependencies (like `react-icons`, `lucide-react`, etc.) or if the user reports a "Failed to resolve import" error, you MUST add them to `frontend/package.json` AND return `"commands": ["cd frontend && npm install"]`. The runner handles `npm run dev` at the end automatically.
        9. **MCP SANDBOX REQUIREMENT**: ALL web servers MUST run on port 9999 and bind to 0.0.0.0. For Vite, you MUST configure `vite.config.js` or the package.json dev script to explicitly use `--port 9999 --host 0.0.0.0`. This is an absolute requirement for the tunnel URL to work properly.
        10. **CRITICAL VALIDATION RULE**: Before returning files, you MUST mentally verify for EVERY file created inside `frontend/src/components/` and `frontend/src/pages/`:
           - 1. Is it imported in App.jsx or a parent page?
           - 2. Is it rendered somewhere in the component tree?
           - 3. No orphan components are allowed! An orphan component is any component that exists but is not reachable from App.jsx. If a component is not connected, the task is considered FAILED. Return ONLY when all components pass this internal checklist.
        11. **APP.JSX IS THE SINGLE SOURCE OF TRUTH**: Every page, route, layout, component, section, widget, table, modal, form, dashboard, chart, navbar, footer, sidebar, and UI element created by the agent MUST be reachable from `App.jsx`. Never leave a placeholder `Home.jsx` as the only rendered page. Replace template routes completely with the generated application.
        12. **ROUTING RULES**: If you create more than one page, you MUST: (1) Import all pages into App.jsx, (2) Create Route entries, (3) Create navigation links, (4) Ensure every page can be visited. Failure to connect routes is considered a failed task.
        ```jsx
        import {{ BrowserRouter, Routes, Route }} from 'react-router-dom';
        import Navbar from './components/Navbar';
        import Home from './pages/Home';
        // import ALL other components/pages you created
        export default function App() {{
          return (
            <BrowserRouter>
              <div className="min-h-screen bg-slate-950 text-white">
                <Navbar />
                <Routes>
                  <Route path="/" element={{<Home />}} />
                  {{/* more routes */}}
                </Routes>
              </div>
            </BrowserRouter>
          );
        }}
        ```

        TASK:
        Title: {task.get('title')}
        Description: {task.get('description')}
        Acceptance: {task.get('acceptance_criteria', '')}

        Respond ONLY in JSON. You MUST ALWAYS include the FULL `frontend/src/App.jsx` in the `files` array, even if you just added a small component. If you do not include `App.jsx`, the components will be orphaned and the UI will fail.
        {{
          "files": [ 
             {{ "path": "frontend/src/App.jsx", "content": "import {{ BrowserRouter... \n// FULL UPDATED CODE HERE" }},
             {{ "path": "frontend/src/components/MyNewComponent.jsx", "content": "..." }}
          ],
          "commands": [],
          "summary": "List components created AND how they are wired in App.jsx + routes + API calls"
        }}
        """

        workspace_id = state.get("current_job_id")
        current_app_jsx = ""
        if workspace_id and not workspace_id.startswith("error:"):
            from Brain.services.workspace_manager import workspace_manager
            ws_root = workspace_manager.resolve_workspace_path(workspace_id)
            if ws_root:
                app_jsx_path = os.path.join(ws_root, "frontend", "src", "App.jsx")
                if os.path.exists(app_jsx_path):
                    try:
                        with open(app_jsx_path, "r", encoding="utf-8") as f:
                            current_app_jsx = f.read()
                    except Exception:
                        pass
        
        app_jsx_context = ""
        if current_app_jsx:
            app_jsx_context = f"\n\n--- CURRENT frontend/src/App.jsx CONTENT ---\n```jsx\n{current_app_jsx}\n```\nIMPORTANT: Build upon this file! If it contains a placeholder comment ('Brain MUST replace this file' or 'Remove this placeholder'), you MUST remove the placeholder setup entirely and implement the real Router with the components you created. Otherwise, preserve all existing real routes and imports. Return the FULL updated App.jsx file in your response."

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

        active_decisions = state.get("active_decisions", {})
        decisions_context = ""
        if active_decisions:
            decisions_lines = [f"  {k}: {v}" for k, v in active_decisions.items()]
            decisions_context = "[Approved Decisions - CRITICAL - Must Follow]\n" + "\n".join(decisions_lines)

        messages = [SystemMessage(content=system_prompt)]
        if session_context:
            messages.append(SystemMessage(content=session_context))
        if decisions_context:
            messages.append(SystemMessage(content=decisions_context))
        messages.append(
            HumanMessage(
                content=(
                    f"Execute task: {task.get('title')}\n"
                    f"Project plan: {json.dumps(plan, default=str)[:4000]}\n"
                    f"Recent completed tasks: {json.dumps(executed, default=str)[:2000]}"
                    f"{app_jsx_context}"
                )
            ),
        )

        # Generation (review loop disabled to prevent timeout)
        response_content = await self.chat(messages)
        generated_json = self._format_json_response(response_content)
        return generated_json
