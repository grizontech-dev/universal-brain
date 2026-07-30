from typing import Any, Dict, List
import os
import json
from Brain.shared.agent import BaseAgent
from Brain.shared.build_standards import FULL_STACK_BUILD_STANDARDS
from langchain_core.messages import SystemMessage, HumanMessage
from Brain.shared.skills.resolver import SkillResolver

class FrontendAgent(BaseAgent):
    def __init__(self):
        super().__init__(
            name="Frontend Agent",
            description="Specialized in HTML, CSS, JS, React, Angular, Tailwind CSS, and Bootstrap.",
            model_id="Qwen/Qwen3-Coder-480B-A35B-Instruct-Turbo"
        )
        self.skill_resolver = SkillResolver()

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

        ═══ CRITICAL RULES (NON-NEGOTIABLE) ═══
        1. NEVER output placeholder components like `<h1>Home Page</h1>` or `<p>Coming soon</p>`
        2. EVERY component MUST have REAL, polished UI with Tailwind CSS dark theme
        3. App.jsx MUST import ALL components and use BrowserRouter + Routes
        4. Every file you create MUST be imported in App.jsx (no orphan components)
        5. Use react-router-dom Link, NOT <a href>
        6. Mobile-responsive design is MANDATORY
        7. ALL packages MUST be in frontend/package.json
        8. Vite MUST run on port 9999: add --port 9999 --host 0.0.0.0

        ═══ OUTPUT FORMAT ═══
        Return a JSON object with:
        - files: array of {{path, content}} objects
        - commands: array of shell commands (e.g., ["cd frontend && npm install"])

        ═══ EXAMPLE: Component structure ═══
        ```jsx
        // frontend/src/components/Navbar.jsx
        import {{ Link }} from 'react-router-dom';
        import {{ Menu, X }} from 'lucide-react';
        import {{ useState }} from 'react';

        export default function Navbar() {{
          const [open, setOpen] = useState(false);
          return (
            <nav className="bg-[#09090b] border-b border-white/10 sticky top-0 z-50">
              <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
                <Link to="/" className="text-xl font-bold bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
                  Grizon AI
                </Link>
                <div className="hidden md:flex gap-6">
                  <Link to="/" className="text-gray-300 hover:text-white transition">Home</Link>
                  <Link to="/dashboard" className="text-gray-300 hover:text-white transition">Dashboard</Link>
                </div>
              </div>
            </nav>
          );
        }}
        ```

        ═══ VALIDATION CHECKLIST (before returning) ═══
        For EVERY component file:
        - Is it imported in App.jsx?
        - Is it rendered in the JSX tree?
        - Does it have real Tailwind styling (not placeholder)?
        - Does it have responsive design?
        """
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
        user_id = state.get("user_id")
        current_app_jsx = ""
        if workspace_id and not workspace_id.startswith("error:"):
            from Brain.services.workspace_manager import workspace_manager
            ws_root = workspace_manager.resolve_workspace_path(workspace_id, user_id=user_id)
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
            # Truncate to save tokens — only send first 1500 chars
            truncated = current_app_jsx[:1500] + ("..." if len(current_app_jsx) > 1500 else "")
            app_jsx_context = f"\n\n--- CURRENT frontend/src/App.jsx (truncated) ---\n```jsx\n{truncated}\n```\nIMPORTANT: Build upon this file! If it contains a placeholder comment ('Brain MUST replace this file' or 'Remove this placeholder'), you MUST remove the placeholder setup entirely and implement the real Router with the components you created. Otherwise, preserve all existing real routes and imports. Return the FULL updated App.jsx file in your response."

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

        print(f"[FRONTEND] Using model: Qwen/Qwen3-Coder-480B-A35B-Instruct-Turbo | task={task.get('title', 'N/A')}", flush=True)
        response_content = await self.chat(messages, timeout=300, temperature=0.7)
        generated_json = self._format_json_response(response_content)
        return generated_json
