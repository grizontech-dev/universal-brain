from typing import Any, Dict, List
import os
import json
import asyncio
from Brain.shared.agent import BaseAgent
from Brain.shared.build_standards import FULL_STACK_BUILD_STANDARDS
from langchain_core.messages import SystemMessage, HumanMessage, ToolMessage
from Brain.shared.skills.resolver import SkillResolver
from Brain.agents.builder.mcp_tools import client_save_code
from Brain.services.provider_router import ProviderRouter

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

        ***CRITICAL UI QUALITY RULES (NON-NEGOTIABLE)***:
        - NEVER output placeholder components like `<h1>Home Page</h1>` or `<p>Coming soon</p>`
        - EVERY component MUST have REAL, polished UI with Tailwind CSS
        - Home page MUST include: Hero section with gradient background, Features grid, About section, Contact form, Footer
        - Dashboard MUST include: Stats cards with icons, data visualization, sidebar nav, tables
        - Auth pages MUST include: Styled form fields, validation, loading spinners, error states
        - Use real placeholder images from: https://picsum.photos/800/400 or https://placehold.co/600x400
        - Add hover effects, transitions, shadows for polish
        - Mobile-responsive design is MANDATORY

        ***SHADCN UI COMPONENTS (USE FOR PRODUCTION QUALITY)***:
        - Use shadcn-style components for buttons, cards, inputs, badges, forms
        - Create components in `frontend/src/components/ui/` directory
        - Always import `cn` from `../lib/utils` for className merging
        - Add dependencies to package.json: class-variance-authority, clsx, tailwind-merge, @radix-ui/react-slot
        - Use CSS variables for theming (add to index.css)
        - Example Card usage:
          ```jsx
          import {{ Card, CardContent, CardHeader, CardTitle }} from "../components/ui/card";
          <Card>
            <CardHeader><CardTitle>Title</CardTitle></CardHeader>
            <CardContent>Content here</CardContent>
          </Card>
          ```

        ***CRITICAL VIOLATIONS THAT WILL FAIL THE TASK***:
        - Using `<Switch>` instead of `<Routes>` (React Router v5 vs v6)
        - Using `component={{Home}}` instead of `element={{<Home />}}` (v5 vs v6 syntax)
        - Creating components but NOT importing them in App.jsx (orphan components)
        - Importing or using a browser Supabase client in frontend code (all DB access is server-side only)
        - Home.jsx containing only `<h1>Home Page</h1>` (placeholder, not real UI)
        - Not including the FULL updated App.jsx in your response
        - Creating the SAME component in BOTH `frontend/src/components/` AND `frontend/src/pages/` (duplicate files)
        - Creating a component that is NOT imported in App.jsx (orphan)

        FRONTEND AGENT RULES:
        1. **CRITICAL — Vite entry**: `frontend/src/main.jsx` imports `./App.jsx` ONLY. **`App.tsx` is NEVER used in preview.** All routes and component imports go in `frontend/src/App.jsx`.
        2. **App.jsx is the product** — You MUST include `frontend/src/App.jsx` in every response that adds or changes components.
           Import and render every component you create. Remove template demo (counter, "Grizon React", "ready for Brain to extend").
        3. **FORBIDDEN**: `frontend/src/App.tsx` — do not create it. Use plain JSX in App.jsx (no TypeScript, no `React.FC` types).
        4. **NO DUPLICATE FILES**: NEVER create the same component in both `frontend/src/components/` and `frontend/src/pages/`. Pages go in `pages/`, reusable UI blocks go in `components/`. If `PostPage.jsx` exists in `pages/`, do NOT also create it in `components/`.
        5. **NO ORPHAN COMPONENTS**: Every file you create in `frontend/src/components/` or `frontend/src/pages/` MUST be imported in `frontend/src/App.jsx` and rendered in the JSX. Before returning, verify: for every component file, is it in App.jsx imports AND in the JSX tree?
        6. **REACT ROUTER v6 MANDATORY**: Use `<Routes>` NOT `<Switch>`. Use `element={{<Component />}}` NOT `component={{Component}}`. Example:
           ```jsx
           import {{ BrowserRouter, Routes, Route }} from 'react-router-dom';
           <BrowserRouter>
             <Routes>
               <Route path="/" element={{<Home />}} />
               <Route path="/about" element={{<About />}} />
             </Routes>
           </BrowserRouter>
           ```
        7. **IMPORT ALL COMPONENTS**: If you created Home.jsx, About.jsx, Contact.jsx, Navbar.jsx, HeroSection.jsx — ALL must be imported in App.jsx. No orphan components allowed!
        8. **REAL UI ONLY**: Every component MUST have real Tailwind CSS styling. NEVER output `<h1>Home Page</h1>` as the only content. Use the skills provided for UI quality.
        9. **API integration** — Connect forms and data to the backend via `frontend/src/lib/api.js` (`apiGet`, `apiPost`, `apiPut`, `apiDelete`), using the backend's REAL `/api/*` routes (which mount in `backend/server.js`). NEVER import or use a browser Supabase client (e.g. `import {{ supabase }} from '../supabase/client.js'`) — all DB access happens server-side. Example: contact form → `apiPost('/api/contact', formData)`.
        10. **Tailwind** — Use utility classes; add `tailwindcss`, `postcss`, `autoprefixer` to `frontend/package.json` if missing; include `tailwind.config.js` and `src/index.css` with `@tailwind` directives when styling.
        11. **Structure**: `frontend/src/components/` for UI blocks; `frontend/src/pages/` for route pages when using router.
        12. **commands & packages**: ALL packages used in the project MUST be added to `frontend/package.json`. This is critical so that when `npm install` runs, there are no missing package errors and the project runs correctly. If you add ANY new dependencies (like `react-icons`, `lucide-react`, `@supabase/supabase-js`, etc.) or if the user reports a "Failed to resolve import" error, you MUST add them to `frontend/package.json` AND return `"commands": ["cd frontend && npm install"]`. The runner handles `npm run dev` at the end automatically.
        13. **MCP SANDBOX REQUIREMENT**: ALL web servers MUST run on port 9999 and bind to 0.0.0.0. For Vite, you MUST configure `vite.config.js` or the package.json dev script to explicitly use `--port 9999 --host 0.0.0.0`. This is an absolute requirement for the tunnel URL to work properly.
        14. **CRITICAL VALIDATION RULE**: Before returning files, you MUST mentally verify for EVERY file created inside `frontend/src/components/` and `frontend/src/pages/`:
            - 1. Is it imported in App.jsx or a parent page?
            - 2. Is it rendered somewhere in the component tree?
            - 3. No orphan components are allowed! An orphan component is any component that exists but is not reachable from App.jsx. If a component is not connected, the task is considered FAILED. Return ONLY when all components pass this internal checklist.
        15. **APP.JSX IS THE SINGLE SOURCE OF TRUTH**: Every page, route, layout, component, section, widget, table, modal, form, dashboard, chart, navbar, footer, sidebar, and UI element created by the agent MUST be reachable from `App.jsx`. Never leave a placeholder `Home.jsx` as the only rendered page. Replace template routes completely with the generated application.
        16. **ROUTING RULES**: If you create more than one page, you MUST: (1) Import all pages into App.jsx, (2) Create Route entries, (3) Create navigation links, (4) Ensure every page can be visited. Failure to connect routes is considered a failed task.
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

        llm = ProviderRouter.get_model("Qwen/Qwen3-Coder-480B-A35B-Instruct-Turbo", temperature=0.7)
        bound_llm = llm.bind_tools([client_save_code])

        msgs = [SystemMessage(content=system_prompt), HumanMessage(content=messages[-1].content)]

        files_saved = []
        max_iterations = 8
        for iteration in range(max_iterations):
            try:
                response = await asyncio.wait_for(
                    bound_llm.ainvoke(msgs),
                    timeout=180
                )
            except Exception as e:
                print(f"[FRONTEND] LLM error: {e}", flush=True)
                break

            msgs.append(response)

            if not response.tool_calls:
                break

            for tc in response.tool_calls:
                if tc["name"] == "client_save_code":
                    tool_args = tc["args"]
                    file_path = tool_args.get("file_path", "")
                    code_content = tool_args.get("code_content", "")

                    if file_path and code_content:
                        config = {"configurable": {"thread_id": state.get("current_job_id"), "task_title": task.get("title", ""), "user_id": state.get("user_id")}}
                        try:
                            await asyncio.wait_for(
                                client_save_code.ainvoke(tool_args, config=config),
                                timeout=30
                            )
                            files_saved.append(file_path)
                            print(f"[FRONTEND] ✓ Saved: {file_path} ({len(code_content)} chars)", flush=True)
                        except Exception as e:
                            print(f"[FRONTEND] ✖ Failed to save {file_path}: {e}", flush=True)

        if not files_saved:
            # Fallback: try parsing JSON from response
            last_content = msgs[-1].content if msgs else ""
            if isinstance(last_content, list):
                last_content = str(last_content)
            parsed = self._format_json_response(last_content)
            if isinstance(parsed, dict) and "files" in parsed:
                return parsed

        return {"files": [{"path": f, "content": ""} for f in files_saved], "summary": f"Saved {len(files_saved)} files via tool calls"}
