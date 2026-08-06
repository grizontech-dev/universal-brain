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

### CRITICAL: UI Quality Standards (NON-NEGOTIABLE)
- **Every component MUST have REAL content** — not just `<h1>Home Page</h1>`. Include:
  - Proper Tailwind CSS styling (dark theme, gradients, shadows)
  - Real headings, paragraphs, images (use placeholder images from unsplash/picsum)
  - Interactive elements (buttons, forms, modals)
  - Responsive design (mobile-first)
  - Animations/transitions for polish
- **Home page MUST have**: Hero section, Features section, About section, Contact section, Footer
- **Dashboard MUST have**: Stats cards, data tables/charts, sidebar navigation
- **Auth pages MUST have**: Form fields with validation, loading states, error handling
- **NEVER output placeholder components** like `<h1>Home Page</h1>` or `<p>Coming soon</p>`
- **Home.jsx MUST be 150-300 lines minimum** — include hero, stats bar, feature cards grid, why section, CTA section. NOT just a heading and one paragraph.
- **Header.jsx MUST use `<Link to=\"/page\">` from react-router-dom** — NEVER use `<a href=\"/page\">` which causes full page reloads and breaks SPA navigation.
- **Footer.jsx MUST be 50+ lines** — brand column, 3 link columns, copyright, social icons.

### CRITICAL: Navigation Standards (NON-NEGOTIABLE)
- Header nav links MUST use: `import {{ Link, useLocation }} from 'react-router-dom'` then `<Link to=\"/dashboard\">Dashboard</Link>`
- NEVER use `<a href=\"/dashboard\">` — this causes a full page reload and breaks the single-page app
- Use `useLocation()` to highlight the active nav item: `const isActive = location.pathname === item.path`
- Every CTA button in Home.jsx MUST use `<Link to=\"/page\">` — not `<button onClick={...}>`
- Footer links MUST use `<Link to=\"/page\">` — not `<a href=\"/page\">`

### CRITICAL: Task Failures (NON-NEGOTIABLE)
The following will cause the task to FAIL immediately:
- Using `<Switch>` instead of `<Routes>` (React Router v5 syntax)
- Using `component={Home}` instead of `element={<Home />}` (v5 syntax)
- Creating components but NOT importing them in App.jsx (orphan components)
- Home.jsx containing only `<h1>Home Page</h1>` (placeholder, not real UI)
- Not including the FULL updated App.jsx in the response
- Missing Navbar in App.jsx when Navbar component exists

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
- **Routing (React Router v6)**: wrap app in `BrowserRouter`; Navbar uses `<Link to="...">`; use `<Routes>` (NOT `<Switch>`); use `element={<Component />}` (NOT `component={Component}`); paths MUST match Link targets exactly (`/`, `/about`, `/programs`, `/contact`, etc.). Example: `<Route path="/" element={<Home />} />`
- **Single-page landing**: one route `/` with Navbar + Hero + Features + About + Contact + Footer stacked; navbar anchor/hash links must scroll to section ids.
- **API calls**: use `import { apiGet, apiPost } from './lib/api.js'` — paths like `/api/contact`, `/api/programs` (Vite proxies `/api` → Express :3001).
- **UI quality**: Use shadcn-style components for production quality. Create `frontend/src/components/ui/` with Button, Card, Input, Badge components. Add `class-variance-authority`, `clsx`, `tailwind-merge` to package.json. Create `frontend/src/lib/utils.js` with `cn` helper. Use CSS variables for theming.
- **Forms**: Contact/program forms call `apiPost('/api/...', data)` with loading + error states. Use shadcn Input and Button components.

### Backend (`backend/`)
- Express on port **3001**. Every new `routes/*.js` MUST be imported and mounted in `backend/server.js`:
  `app.use('/api/contact', contactRoutes);`
- Controllers must check for a connected user Supabase connector first; if one exists, generated code should use that connector's configuration. Only fall back to the company-owned Python Supabase proxy when no connector is connected. Never ask users for their own Supabase credentials or expose database access in the browser.
- JSON: `{ success: true, data }` or `{ success: false, error: "..." }`.
- List all new deps in `backend/package.json` (Runner runs npm install).

### Database / Supabase
- Use the Shared Table + JSONB Data Matrix Pattern for Supabase-backed features: a shared tenant-scoped table with JSONB payload fields, not one table per user.
- If a user already has a connected Supabase connector, prefer that connector first; fall back to the company-owned Python Supabase proxy only when no connector is connected.
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

### FINAL VALIDATION CHECKLIST (Before marking task complete)
- [ ] App.jsx imports ALL created components (no orphans)
- [ ] Every component has REAL UI content (not placeholders)
- [ ] Tailwind CSS applied to all components
- [ ] Backend server.js mounts ALL routes
- [ ] Frontend connects to backend via api.js
- [ ] No console errors in preview
- [ ] Responsive design works on mobile
"""

INTEGRATION_TASK_TEMPLATE = {
    "id": "t-integration",
    "title": "Wire App, Router, Backend & Supabase",
    "description": (
        "MANDATORY VALIDATION CHECKLIST (all items must pass or this task FAILS):\n"
        "1. List EVERY file currently in `frontend/src/components/` and `frontend/src/pages/` (recursively, including subfolders like `components/ui/`).\n"
        "2. Rewrite `frontend/src/App.jsx` so that it imports AND renders ALL of those components/pages — no orphans are allowed.\n"
        "3. Use React Router v6 syntax throughout App.jsx: wrap in `<BrowserRouter>`, use `<Routes>` (NOT `<Switch>`), and use `element={<Component />}` (NOT `component={Component}`).\n"
        "   Example: `<Route path=\"/\" element={<Home />} />`\n"
        "4. Connect any forms, lists, or data-driven views to the backend through `frontend/src/lib/api.js` using the actual `/api/*` routes defined by the backend tasks (apiGet / apiPost / apiPut / apiDelete).\n"
        "5. Delete any duplicate or placeholder components (e.g. do NOT keep both `Home.jsx` and `HomePage.jsx`; keep exactly one canonical name per feature).\n"
        "6. Delete `frontend/src/App.tsx` if it exists.\n"
        "7. Include the FULL updated `App.jsx` in the response.\n\n"
        "STEPS:\n"
        "1. Enumerate all files recursively in `frontend/src/components/` and `frontend/src/pages/`.\n"
        "2. Rewrite `App.jsx` with v6 routing, importing every file found in step 1 and rendering each under a `<Route>`.\n"
        "3. Verify `backend/server.js` mounts every `routes/*.js` under `/api/*`.\n"
        "4. Wire frontend forms/lists to the backend via `frontend/src/lib/api.js` using the backend's real `/api/*` endpoints.\n"
        "5. Remove duplicate/placeholder components (consolidate to a single canonical filename per feature).\n"
        "6. Delete `frontend/src/App.tsx` if present and add `react-router-dom` to `frontend/package.json` if missing.\n"
    ),
    "category": "frontend",
    "skill_required": "integration",
    "acceptance_criteria": "Preview shows complete working website with navigation, styled components, and working API calls",
}
