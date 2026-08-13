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

## Structure (MANDATORY)
```
backend/
  server.js          # App entry: middleware + route mounts + /health
  routes/
    <feature>.js     # Express.Router per feature — NO business logic
  controllers/
    <feature>.js     # ALL business logic, DB queries, error handling
  supabase/
    client.js        # shared Supabase client (CREATE THIS FIRST)
    *.sql            # schema migrations
  package.json
```

## Route pattern (REQUIRED)
Every route module MUST delegate to a controller:
```js
const router = require('express').Router();
const controller = require('../controllers/<feature>');
router.get('/', controller.list);
router.post('/', controller.create);
module.exports = router;
```

## Controller pattern (REQUIRED)
Every controller MUST use async/await with try/catch:
```js
const supabase = require('../supabase/client');
exports.list = async (req, res) => {
  try {
    const {{ data, error }} = await supabase
      .from('tenant_connector_vault')
      .select('*')
      .eq('tenant_id', req.user.tenant_id)
      .eq('schema_name', 'feature');
    if (error) throw error;
    res.json({{ success: true, data }});
  } catch (err) {
    res.status(500).json({{ success: false, error: err.message }});
  }
};
```

## Route mounting (required)
Every route module MUST be registered in `server.js`:
```js
const featureRoutes = require('./routes/feature');
app.use('/api/feature', featureRoutes);
```

## Supabase client helper (REQUIRED)
Create `backend/supabase/client.js` as the single shared helper:
```js
require('dotenv').config();
const ws = require('ws');
const supabaseLib = require('@supabase/supabase-js');
const createClient = supabaseLib.createClient || supabaseLib;
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
const {{ data, error }} = await supabase
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

## server.js template (REQUIRED)
```js
require('dotenv').config();
const express = require('express');
const app = express();
app.use(express.json());

// Routes
const featureRoutes = require('./routes/feature');
app.use('/api/feature', featureRoutes);

// Health endpoint (MANDATORY)
app.get('/health', (req, res) => res.status(200).json({{ status: 'ok' }}));

app.listen(process.env.PORT || 9999, '0.0.0.0');
```

## Constraints
- Port **3001**
- `commands: []` — Runner runs npm install/start
- Update `backend/package.json` when adding dependencies
- CommonJS only: `require()` / `module.exports`
- NEVER use `import`/`export` — CommonJS ONLY
- NEVER use browser Supabase client (`window.supabase`)
- NEVER create domain-specific tables (`users`, `todos`, `tasks`, `messages`)
- NEVER use in-memory storage (`const tasks = []`)
- NEVER omit error handling — every async function MUST have try/catch
