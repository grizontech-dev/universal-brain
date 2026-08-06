# Backend Development Skills (Grizon Brain)

Express API on **port 3001**. Frontend uses Vite proxy `/api` → backend.

## Structure
```
backend/
  server.js          # mount all routes here
  routes/*.js        # Express.Router per feature
  controllers/*.js   # business logic
  supabase/client.js # optional local helper only; persistence should go through the Python proxy
  supabase/*.sql     # schema (files only, no CLI)
  package.json
```

## Route mounting (required)
Every route module MUST be registered in `server.js`:
```js
import contactRoutes from './routes/contactRoutes.js';
app.use('/api/contact', contactRoutes);
```

## Supabase
- When a feature uses Supabase, generated backend code must first check whether the current user has a connected Supabase connector. Use that connector when available; otherwise use the fixed company-owned Supabase project through the Python Backend Proxy API.
- Do not ask end users for Supabase credentials or connection details.
- The proxy must stamp each request with a validated tenant_id from the server session, never from the frontend.
- The shared database shape should be a single tenant-scoped vault table with JSONB payload columns, RLS, and GIN indexes for JSONB search.
- Keep payloads flat and compact so the shared free-tier Supabase project stays within the 500 MB limit.

## API contract
- JSON responses: `{ success: true, data }` or `{ success: false, error: "message" }`
- Use async/await; try/catch in controllers

## Constraints
- Port **3001**
- `commands: []` — Runner runs npm install/start
- Update `backend/package.json` when adding dependencies
