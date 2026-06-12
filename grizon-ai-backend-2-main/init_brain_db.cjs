const { execSync } = require('child_process');

const queries = [
    `CREATE TABLE IF NOT EXISTS brain_projects (id uuid PRIMARY KEY, user_id uuid REFERENCES users(id), conversation_id uuid REFERENCES conversations(id), title text, repo_url text, status text, created_at timestamp, updated_at timestamp);`,
    `CREATE TABLE IF NOT EXISTS brain_tasks (id uuid PRIMARY KEY, project_id uuid REFERENCES brain_projects(id), label text, strategy text, agent text, status text, task_order integer, created_at timestamp);`
];

for (const q of queries) {
    console.log(`Running: ${q}`);
    execSync(`docker exec grizon-postgres psql -U app -d app -c "${q}"`);
}

console.log("Done");
