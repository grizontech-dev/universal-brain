# Backend Development Skills (Grizon Brain)

Express API on **port 3001**. Frontend uses Vite proxy `/api` → backend.

## Structure
```
backend/
  server.js          # mount all routes here
  routes/*.js        # Express.Router per feature
  controllers/*.js   # business logic
  supabase/client.js # Supabase client (from template)
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
- `import {{ supabase }} from './supabase/client.js'`
- Env: `SUPABASE_URL`, `SUPABASE_ANON_KEY` in `backend/.env` (document in summary, do not run echo/cp in commands)

## API contract
- JSON responses: `{ success: true, data }` or `{ success: false, error: "message" }`
- Use async/await; try/catch in controllers

## Constraints
- Port **3001**
- `commands: []` — Runner runs npm install/start
- Update `backend/package.json` when adding dependencies
