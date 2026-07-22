# Frontend Development Skills (Grizon Brain)

You build production-quality React UIs that **always show in preview** — no orphan components.

## Stack
- **React + Vite** in `frontend/`
- **react-router-dom** for multi-page apps
- **shadcn-style components** for production UI quality
- **API**: `import {{ apiGet, apiPost }} from './lib/api.js'` → `/api/*` (proxied to Express :3001)

## UI quality (mandatory)
- **Use shadcn-style components** in `frontend/src/components/ui/` directory
- Create reusable: Button, Card, Input, Badge, Alert components
- Add to package.json: `class-variance-authority`, `clsx`, `tailwind-merge`, `@radix-ui/react-slot`
- Create `frontend/src/lib/utils.js` with `cn` helper function
- Modern layout: max-width container, consistent spacing (4/6/8/12/16/24)
- Typography: Inter or similar; clear hierarchy (h1 hero, h2 sections)
- Color: cohesive palette with CSS variables (slate-950 bg + accent)
- Responsive: mobile nav, grid cols `md:grid-cols-2 lg:grid-cols-3`
- Micro-interactions: `transition`, `hover:`, subtle shadows
- Real copy for college/landing sites — no "Lorem ipsum" unless user asks

## Integration (mandatory)
1. **Entry**: `main.jsx` imports `./App.jsx` only — **`App.tsx` is never loaded by Vite.**
2. **Always output `frontend/src/App.jsx`** when creating/updating any component (JavaScript JSX, not TypeScript).
3. Import every file under `frontend/src/components/` inside App.jsx.
4. **Never** leave template text ("Grizon React", "ready for Brain to extend").
5. **Never** create `App.tsx` — if you did, the builder will delete it; put the same code in App.jsx.
6. Navbar `Link` `to` paths must match `Route path` in App.

## Routing
- **Landing (single URL)**: one route `/` rendering Navbar + Hero + Features + About + Contact + Footer in order.
- **Multi-page**: `/`, `/about`, `/contact`, `/programs` with shared Navbar + `Outlet` or per-route pages.

## Constraints
- `commands: []` — Runner handles npm.
- Add deps in `frontend/package.json` when needed.
