"""
Mandatory full-stack build standards for Grizon Brain agents.
Injected into Planner, Todo, Builder sub-agents, and skills alignment.
"""

FULL_STACK_BUILD_STANDARDS = """
## Grizon Brain — mandatory full-stack delivery (NON-NEGOTIABLE)

### Preview must show the real product
- Vite entry is `frontend/src/main.jsx` → imports **`./App.jsx` only** (NOT App.tsx). Writing `App.tsx` will NOT appear in preview.
- The live preview reads `frontend/src/App.jsx`. If components exist but App.jsx still shows "Grizon React", a counter demo, or "ready for Brain to extend" — the build FAILED.
- NEVER leave orphan files under `frontend/src/components/` — every component MUST be imported and rendered from App.jsx (or a page imported by App.jsx).

### CRITICAL: Import validation (NON-NEGOTIABLE)
- **Every import in App.jsx MUST correspond to an actual file in the workspace.** Before writing App.jsx, the agent MUST list all component files it created and ONLY import those.
- **NEVER import components that don't exist.** If you created `Home.jsx`, `About.jsx`, `Contact.jsx` — import those. If you created `Login.jsx`, `Register.jsx`, `TaskList.jsx` — import those. Match imports to actual files.
- **NEVER import from paths like `./components/NotFound`** unless `NotFound.jsx` was explicitly created by the agent in the same task.
- **Router routes MUST use the same component names as the imports.** If you import `Home`, use `<Home />`. If you import `TaskList`, use `<TaskList />`.
- **Every page/component imported in App.jsx MUST exist as a file.** The agent must verify: "I created X files, I import X files, they match."
- If the agent creates 5 components, App.jsx MUST import and render exactly those 5 components — no more, no fewer.

### Frontend (`frontend/`)
- **CRITICAL PORT: Vite dev server MUST run on port 9999** (not 5173). The remote sandbox tunnel is bound to port 9999.
  - In `vite.config.js`: `server: { port: 9999 }`
  - In `package.json` dev script: `"dev": "vite --host 0.0.0.0 --port 9999"`
  - If port is 5173, the live preview will show "refused to connect".
- **NEVER create `frontend/src/App.tsx`.** Put all app wiring in **`frontend/src/App.jsx`** only (JavaScript JSX, not TypeScript).
- If you wrote TypeScript by habit, rewrite the same content as `App.jsx` and do not output App.tsx.
- Add `react-router-dom` in `frontend/package.json` when using multiple pages.
- **Routing**: wrap app in `BrowserRouter`; Navbar uses `<Link to="...">`; `<Routes>` paths MUST match Link targets exactly (`/`, `/about`, `/programs`, `/contact`, etc.).
- **Single-page landing**: one route `/` with Navbar + Hero + Features + About + Contact + Footer stacked; navbar anchor/hash links must scroll to section ids.
- **API calls**: use `import { apiGet, apiPost } from './lib/api.js'` — paths like `/api/contact`, `/api/programs` (Vite proxies `/api` → Express :3001).
- **UI quality**: Tailwind CSS, dark/modern college or brand theme, real headings and copy (no Lorem ipsum), responsive layout, polished Navbar/Footer — not default gray Vite boilerplate.
- **Forms**: Contact/program forms call `apiPost('/api/...', data)` with loading + error states.

### Backend (`backend/`)
- Express on port **3001**. Every new `routes/*.js` MUST be imported and mounted in `backend/server.js`:
  `app.use('/api/contact', contactRoutes);`
- Controllers must persist through the company-owned Python Supabase proxy; never ask users for their own Supabase credentials or expose database access in the browser.
- JSON: `{ success: true, data }` or `{ success: false, error: "..." }`.
- List all new deps in `backend/package.json` (Runner runs npm install).

### Database / Supabase
- Use the Shared Table + JSONB Data Matrix Pattern for Supabase-backed features: a shared tenant-scoped table with JSONB payload fields, not one table per user.
- Schema as `backend/supabase/*.sql` files only (no Supabase CLI commands).
- Tables referenced in controllers must exist in SQL files, and indexes must reflect tenant filters plus JSONB search paths.
- Keep payloads sparse and prune large blobs to respect the 500 MB free-tier storage constraint.
- Document only server-side, company-owned env vars in summaries; never request user Supabase credentials.

### Task order (Todo Agent)
1. Database schema (if needed)
2. Backend routes + controllers + server.js mounts
3. Frontend components + pages
4. **Integration task** — rewrite App.jsx + verify server.js mounts + wire forms to API through the Python Supabase proxy
5. Runner (install & start servers) — never duplicate in other tasks
"""

INTEGRATION_TASK_TEMPLATE = {
    "id": "t-integration",
    "title": "Wire App, Router, Backend & Supabase",
    "description": (
        "MANDATORY: (1) Rewrite frontend/src/App.jsx — import ONLY the components that actually exist in "
        "frontend/src/components/. Before writing App.jsx, list all component files. Each import MUST "
        "match a real file. (2) Ensure backend/server.js mounts every routes/*.js "
        "module under /api/*. (3) Connect forms via apiPost to backend endpoints that use Supabase. "
        "(4) Delete frontend/src/App.tsx if it exists. (5) Add react-router-dom to frontend/package.json if missing. "
        "CRITICAL: If you created Home.jsx, About.jsx, Contact.jsx — import those. If you created Login.jsx, "
        "Register.jsx, TaskList.jsx — import those. NEVER import a component that doesn't exist as a file."
    ),
    "category": "frontend",
    "skill_required": "integration",
    "acceptance_criteria": "Preview shows complete branded UI with working navigation and API-wired forms",
}
