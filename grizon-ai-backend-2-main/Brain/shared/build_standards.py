"""
Build standards for Grizon Brain agents.
Split into agent-specific standards to reduce token usage.
"""

# ═══════════════════════════════════════════════════════════════
# GLOBAL — Inject into ALL agents (~300 tokens)
# ═══════════════════════════════════════════════════════════════
GLOBAL_BUILD_STANDARDS = """
## Grizon Brain — Global Rules (NON-NEGOTIABLE)

### Code Quality
- Output production-ready code. NEVER generate placeholders, stubs, or TODOs.
- Every file must be complete, functional, and follow existing project conventions.
- Use the project's established folder structure. Do not create new top-level directories.
- Keep imports valid — every import must resolve to an actual file.
- Do not hallucinate files or dependencies that don't exist.
- Respect the structured spec when provided. Follow acceptance criteria exactly.

### Naming & Structure
- File names: PascalCase for components (Navbar.jsx), camelCase for utilities (api.js).
- Route paths: lowercase kebab-case (/api/contact-us).
- Variable names: camelCase. Component names: PascalCase.
- Keep consistent naming across frontend and backend.

### Validation Checklist
- [ ] Every import resolves to an actual file
- [ ] No orphan files (every file is used/imported)
- [ ] All packages listed in package.json
- [ ] Code follows existing patterns in the project
"""

# ═══════════════════════════════════════════════════════════════
# FRONTEND — Only FrontendAgent (~500 tokens)
# ═══════════════════════════════════════════════════════════════
FRONTEND_BUILD_STANDARDS = """
## Frontend Standards (NON-NEGOTIABLE)

### Preview & App.jsx
- Vite entry: `frontend/src/main.jsx` → imports `./App.jsx` ONLY (NOT App.tsx).
- Preview reads `frontend/src/App.jsx`. If it shows placeholder text — build FAILED.
- NEVER leave orphan files. Every component MUST be imported and rendered from App.jsx.
- NEVER create `frontend/src/App.tsx`. Use App.jsx only (plain JSX, no TypeScript).

### UI Quality
- Every component MUST have REAL content — never `<h1>Home Page</h1>`.
- Tailwind CSS on everything: dark theme, gradients, shadows, responsive.
- Home page: Hero + Features + About + Contact + Footer sections.
- Dashboard: Stats cards, data tables/charts, sidebar navigation.
- Auth pages: Form fields with validation, loading states, error handling.
- Animations: framer-motion — page transitions, hover effects, scroll animations.
  - ⚠️ framer-motion `AnimatePresence` RULE: Any component rendered DIRECTLY inside `<AnimatePresence>` MUST use `React.forwardRef()`. Plain function components inside AnimatePresence cause ref warnings.
  - Correct pattern:
    ```jsx
    const TodoItem = React.forwardRef(({ item }, ref) => (
      <motion.div ref={ref} ...>...</motion.div>
    ));
    TodoItem.displayName = 'TodoItem';
    ```
  - Wrong pattern: `const TodoItem = ({ item }) => <motion.div>...</motion.div>` (no forwardRef)
- Use shadcn-style components for production quality.

### Navigation (React Router v6)
- Wrap app in `<BrowserRouter>`. Use `<Routes>` NOT `<Switch>`.
- Use `element={<Component />}` NOT `component={Component}`.
- Header/Footer links: `<Link to="/page">` — NEVER `<a href>` (breaks SPA).
- Use `useLocation()` to highlight active nav item.
- Every route in App.jsx must have a matching Link in navigation.

### Import Validation
- Every import in App.jsx MUST correspond to an actual file.
- Before writing App.jsx, list all component files and ONLY import those.
- Router routes MUST use same component names as imports.
- If you create 5 components, App.jsx imports and renders exactly 5.

### Port & Config
- Vite dev server MUST run on port 9999 (for external web preview).
- Express backend API runs on port 3001 (internal).
- In vite.config.js: `server: { port: 9999 }` and proxy `/api` → `http://localhost:3001`.
- API calls: `import { apiGet, apiPost } from './lib/api.js'`
- `frontend/src/lib/api.js` must export every named helper imported by pages/components. Add an API contract ledger comment mapping each helper to its exact backend route, for example `createInvoice -> POST /api/invoices`.
- Components never hardcode fetch/axios URLs. They call named `api.js` helpers, and those helpers call the exact mounted `/api/...` backend routes.
- If, and only if, auth is requested, auth forms call `/api/auth/login` and `/api/auth/register` through `api.js`; never hardcode `/auth/login`, `/login`, `/api/users/login`, or localhost URLs in components.

### Task Failures (Immediate Fail)
- Using `<Switch>` instead of `<Routes>`
- Using `component={Home}` instead of `element={<Home />}`
- Creating orphan components not imported in App.jsx
- Home.jsx containing only `<h1>Home Page</h1>`
- Not including FULL updated App.jsx in response (when App.jsx is modified by task)
- Wrapping plain function components in `<AnimatePresence>` without `React.forwardRef()` — causes console ref warnings
"""

# ═══════════════════════════════════════════════════════════════
# BACKEND — Only BackendAgent (~400 tokens)
# ═══════════════════════════════════════════════════════════════
BACKEND_BUILD_STANDARDS = """
## Backend Standards (NON-NEGOTIABLE)

### Stack & Syntax
- Express.js on port 3001. CommonJS (require/module.exports). NEVER use ES modules.
- Structure: `backend/routes/*.js`, `backend/controllers/*.js`.
- Use Express.Router in routes: `module.exports = router;`
- Every controller starts with: `const supabase = require('../supabase/client');`
- ALWAYS null-check: `if (!supabase) return res.json({ success: true, data: [] });`

### Server.js
- `server.js` MUST start with `require('dotenv').config();` at line 1 so environment variables are loaded.
- Every new route MUST be imported and mounted in `backend/server.js`:
  `const featureRoutes = require('./routes/feature');`
  `app.use('/api/feature', featureRoutes);`
- Write server.js LAST with ALL routes mounted.
- Preserve existing mounts when updating server.js.
- ⚠️ ONLY mount routes in server.js whose files you ACTUALLY generate. Missing route file = validation ERROR.

### Supabase & Database
- Check user's connected Supabase connector first; fallback to Python proxy.
- NEVER ask users for their own Supabase credentials.
- NEVER import browser Supabase client. All DB access is server-side.
- Shared Table + JSONB: one shared tenant-scoped table, NOT one table per user.
- Feature data uses a canonical `schema_name` derived from the resource, for example `projects`, `invoices`, or `contact_messages`. If auth is requested, login/register data uses `schema_name = 'auth_users'`. Never create physical domain tables.
- Schema as `backend/supabase/*.sql` files only (no Supabase CLI).
- Keep payloads sparse, prune large blobs (500 MB free-tier limit).

### API Contract & Error Resiliency
- Frontend calls `/api/...` — your routes must match exactly.
- Every feature gets one canonical mounted `/api/<resource>` route family and frontend helpers must call that exact family. If auth is requested, use canonical `POST /api/auth/register`, `POST /api/auth/login`, optional `GET /api/auth/me`, mounted at `/api/auth`.
- ALWAYS wrap controller logic in `try { ... } catch (err)` blocks.
- If supabase client is null (env vars not set) or DB query fails, return `{ success: true, data: [], note: "DB not configured" }` — NEVER throw HTTP 500!
- JSON responses: `{ success: true, data }` or `{ success: false, error: "..." }`.
- In `server.js`, handle `/favicon.ico`: `app.get('/favicon.ico', (req, res) => res.status(204).end());`
- List all new deps in `backend/package.json`.
- Return `"commands": ["cd backend && npm install"]` when adding dependencies.

### Port & Config
- Express backend runs on port 3001 (internal API server).
- Vite dev server runs on port 9999 and proxies `/api/*` → Express `:3001`.
- Bind Express to `0.0.0.0` for sandbox compatibility.
"""

# ═══════════════════════════════════════════════════════════════
# DATABASE — Only DatabaseAgent (~200 tokens)
# ═══════════════════════════════════════════════════════════════
DATABASE_BUILD_STANDARDS = """
## Database / Supabase Standards (NON-NEGOTIABLE)

### Schema Pattern
- Shared Table + JSONB Data Matrix: one shared tenant-scoped table with JSONB payload fields.
- NOT one table per user. Use tenant_id + JSONB for flexibility.
- Feature data uses a canonical `schema_name` derived from the resource in `tenant_connector_vault` when shared mode is active. If auth is requested in shared mode, login/register data uses `schema_name = 'auth_users'`. Physical-table mode may create real domain tables when explicitly enabled.
- Schema files: `backend/supabase/*.sql` only. No Supabase CLI commands.

### Connector Priority
- If user has connected Supabase connector → use that connector's config first.
- Fallback to company-owned Python Supabase proxy only when no connector connected.
- Never request user Supabase credentials. Never expose DB access in browser.

### Constraints
- Indexes must reflect tenant filters + JSONB search paths.
- Keep payloads sparse. Prune large blobs (500 MB free-tier limit).
- Document only server-side, company-owned env vars in summaries.

### Validation
- Tables referenced in controllers MUST exist in SQL files.
- Every SQL file must be syntactically valid.
- Include appropriate indexes for query performance.
"""

# ═══════════════════════════════════════════════════════════════
# INTEGRATION — Only Integration task (~300 tokens)
# ═══════════════════════════════════════════════════════════════
INTEGRATION_BUILD_STANDARDS = """
## Integration Standards (NON-NEGOTIABLE)

### App.jsx Wiring
1. List EVERY file in `frontend/src/components/` and `frontend/src/pages/` recursively.
2. Rewrite App.jsx to import AND render ALL those files — no orphans allowed.
3. React Router v6: `<BrowserRouter>`, `<Routes>` (NOT `<Switch>`), `element={<X />}` (NOT `component={X}`).

### Backend Wiring
1. Verify `backend/server.js` mounts every `routes/*.js` under `/api/*`.
2. Ensure all controllers are properly imported.

### API Connection
1. Wire frontend forms/lists to backend via `frontend/src/lib/api.js`.
2. Use actual `/api/*` routes defined by backend tasks.
3. Use apiGet / apiPost / apiPut / apiDelete.

### Cleanup
1. Delete duplicate components (keep one canonical name per feature).
2. Delete `frontend/src/App.tsx` if it exists.
3. Add `react-router-dom` to `frontend/package.json` if missing.
4. Include FULL updated App.jsx in response.

### Validation
- [ ] App.jsx imports ALL created components
- [ ] server.js mounts ALL routes
- [ ] Frontend forms connect to backend API
- [ ] No orphan files remain
- [ ] No duplicate components
"""

# ═══════════════════════════════════════════════════════════════
# TASK ORDER — For Todo Agent
# ═══════════════════════════════════════════════════════════════
TASK_ORDER_STANDARDS = """
## Task Order (Todo Agent)

1. Database schema (if needed)
2. Backend routes + controllers + server.js mounts
3. Frontend components + pages
4. Integration task — wire App.jsx + server.js + API connections
5. Runner (install & start servers) — never duplicate in other tasks

### Acceptance Criteria
- Preview shows complete working website with navigation
- All styled components render correctly
- Working API calls between frontend and backend
- No console errors in preview
- Responsive design works on mobile
"""

# ═══════════════════════════════════════════════════════════════
# BACKWARD COMPATIBILITY — Keep original for any external usage
# ═══════════════════════════════════════════════════════════════
FULL_STACK_BUILD_STANDARDS = GLOBAL_BUILD_STANDARDS + FRONTEND_BUILD_STANDARDS + BACKEND_BUILD_STANDARDS + DATABASE_BUILD_STANDARDS

INTEGRATION_TASK_TEMPLATE = {
    "id": "t-integration",
    "title": "Wire App, Router, Backend & Supabase",
    "description": (
        "MANDATORY VALIDATION CHECKLIST (all items must pass or this task FAILS):\n"
        "1. List EVERY file currently in `frontend/src/components/` and `frontend/src/pages/` (recursively, including subfolders like `components/ui/`).\n"
        "2. Rewrite `frontend/src/App.jsx` so that it imports AND renders ALL of those components/pages — no orphans are allowed.\n"
        "3. Use React Router v6 syntax throughout App.jsx: wrap in `<BrowserRouter>`, use `<Routes>` (NOT `<Switch>`), and use `element={<Component />}` (NOT `component={Component}`).\n"
        "   Example: `<Route path=\"/\" element={<Home />} />`\n"
        "4. Connect any forms, lists, or data-driven views to the backend through `frontend/src/lib/api.js` using the actual `/api/*` routes defined by the backend tasks (apiGet / apiPost / apiPut / apiDelete). Ensure `api.js` exports every helper imported anywhere and includes an API contract ledger mapping helper names to exact routes.\n"
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
