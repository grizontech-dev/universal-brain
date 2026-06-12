# React + Vite (Grizon Brain)

## Non-negotiable
- Output **`frontend/src/App.jsx`** whenever you create or change components.
- Import every file in `frontend/src/components/`.
- Use **`react-router-dom`** for multi-page sites; Navbar `<Link to>` must match `<Route path>`.
- Call backend via **`frontend/src/lib/api.js`** (`apiGet`, `apiPost`) — never hardcode `localhost:3001` in components.
- **Never** ship template text ("Grizon React", counter demo, "ready for Brain to extend").
- **Never** create both `App.jsx` and `App.tsx`.

## UI
- Tailwind utility classes, responsive grids, real copy for landing/college sites.
- Forms: loading state, error message, success feedback.

## Files
- `components/` — Navbar, Hero, Features, ContactForm, Footer, etc.
- `pages/` — one file per route when using router.
- `package.json` — include `react-router-dom`, `tailwindcss` if styling.
