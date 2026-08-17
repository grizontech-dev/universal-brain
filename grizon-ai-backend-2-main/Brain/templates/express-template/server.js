require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Health endpoints (MANDATORY — do not remove)
app.get('/health', (_req, res) => res.status(200).json({ status: 'ok' }));
app.get('/api/health', (_req, res) => res.status(200).json({ status: 'ok' }));
app.get('/favicon.ico', (_req, res) => res.status(204).end());

// NOTE FOR BUILDER: Mount ONLY the routes whose files you actually generate.
// For each route you add here, a matching backend/routes/<name>.js MUST exist.
// Example (uncomment and replace with actual feature):
// const taskRoutes = require('./routes/tasks');
// app.use('/api/tasks', taskRoutes);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[Server] Express API running on port ${PORT}`);
});
