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

### Frontend (`frontend/`)
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
- Controllers use `import { supabase } from '../supabase/client.js'` when persisting data (with graceful fallback if env missing).
- JSON: `{ success: true, data }` or `{ success: false, error: "..." }`.
- List all new deps in `backend/package.json` (Runner runs npm install).

### Database / Supabase
- Schema as `backend/supabase/*.sql` files only (no Supabase CLI commands).
- Tables referenced in controllers must exist in SQL files.
- Document required env vars in summary: `SUPABASE_URL`, `SUPABASE_ANON_KEY` in `backend/.env`.

### Task order (Todo Agent)
1. Database schema (if needed)
2. Backend routes + controllers + server.js mounts
3. Frontend components + pages
4. **Integration task** — rewrite App.jsx + verify server.js mounts + wire forms to API
5. Runner (install & start servers) — never duplicate in other tasks
"""

INTEGRATION_TASK_TEMPLATE = {
    "id": "t-integration",
    "title": "Wire App, Router, Backend & Supabase",
    "description": (
        "MANDATORY: (1) Rewrite frontend/src/App.jsx — import ALL components from "
        "frontend/src/components/, set up react-router-dom Routes matching Navbar links, "
        "remove ALL template boilerplate. (2) Ensure backend/server.js mounts every routes/*.js "
        "module under /api/*. (3) Connect forms via apiPost to backend endpoints that use Supabase. "
        "(4) Delete frontend/src/App.tsx if it exists. (5) Add react-router-dom to frontend/package.json if missing."
    ),
    "category": "frontend",
    "skill_required": "integration",
    "acceptance_criteria": "Preview shows complete branded UI with working navigation and API-wired forms",
}
