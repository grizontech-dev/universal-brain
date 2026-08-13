# Backend Development Skills (Grizon Brain)

Express API on **port 3001**. Frontend uses Vite proxy `/api` → backend.

## Architecture (MANDATORY — OVERRIDES ALL OTHER SKILL FILES)
- This project uses **Supabase PostgreSQL** as the only database.
- Data access pattern: **Shared Table + JSONB Data Matrix** via `tenant_connector_vault`.
- **NEVER use Mongoose, Prisma, Sequelize, TypeORM, or any ORM/ODM.**
- **NEVER create domain-specific tables** like `users`, `todos`, `tasks`, `messages`.
- **NEVER use in-memory arrays** (`const tasks = []`) for persistence.
- All controllers must use the shared `backend/supabase/client.js` helper or the Python Backend Proxy API.
- If `backend/supabase/client.js` does not exist yet, CREATE it as the first file.

## Structure
```
backend/
  server.js          # mount all routes here
  routes/*.js        # Express.Router per feature
  controllers/*.js   # business logic
  supabase/client.js # shared Supabase client (CREATE THIS FIRST)
  supabase/*.sql     # schema (files only, no CLI)
  package.json
```

## Route mounting (required)
Every route module MUST be registered in `server.js`:
```js
const contactRoutes = require('./routes/contactRoutes');
app.use('/api/contact', contactRoutes);
```

## Supabase client helper (REQUIRED)
Create `backend/supabase/client.js` as the single shared helper:
```js
require('dotenv').config();
const ws = require('ws');
const { createClient } = require('@supabase/supabase-js');
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_KEY || '';
module.exports = createClient(SUPABASE_URL, SUPABASE_KEY, {
  global: { fetch },
  realtime: { transport: ws }
});
```

## Data access pattern (REQUIRED)
Use the shared `tenant_connector_vault` table:
```js
const supabase = require('../supabase/client');

// List tasks for a tenant
const { data, error } = await supabase
  .from('tenant_connector_vault')
  .select('*')
  .eq('tenant_id', tenantId)
  .eq('schema_name', 'tasks')
  .eq('record_data->>status', 'active');
```

## Python Backend Proxy (alternative)
When the user has connected their own Supabase connector, use:
```
GET /api/connector/query?tenant_id=...&schema_name=users&record_data->>name=John
```

## API contract
- JSON responses: `{ success: true, data }` or `{ success: false, error: "message" }`
- Use async/await; try/catch in controllers
- ALWAYS wrap DB queries in try/catch; return `{ success: true, data: [] }` on failure instead of HTTP 500

## Constraints
- Port **3001**
- `commands: []` — Runner runs npm install/start
- Update `backend/package.json` when adding dependencies
- CommonJS only: `require()` / `module.exports`
