import httpx
import os

url = os.environ.get("SUPABASE_URL", "https://nsmqvydvmrgtpdzzgkrw.supabase.co")
key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
headers = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}

sql = "CREATE TABLE IF NOT EXISTS public.todos (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), title text NOT NULL, description text DEFAULT '', completed boolean DEFAULT false, priority text DEFAULT 'medium', due_date timestamptz, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());"

r = httpx.post(f"{url}/rest/v1/rpc/exec_sql", headers=headers, json={"query": sql}, timeout=15)
print(f"Create table: {r.status_code} {r.text[:300]}")

sql2 = "ALTER TABLE public.todos ENABLE ROW LEVEL SECURITY;"
r2 = httpx.post(f"{url}/rest/v1/rpc/exec_sql", headers=headers, json={"query": sql2}, timeout=15)
print(f"RLS: {r2.status_code} {r2.text[:300]}")

sql3 = "DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'todos') THEN CREATE POLICY allow_all ON public.todos FOR ALL USING (true) WITH CHECK (true); END IF; END $$;"
r3 = httpx.post(f"{url}/rest/v1/rpc/exec_sql", headers=headers, json={"query": sql3}, timeout=15)
print(f"Policy: {r3.status_code} {r3.text[:300]}")

r4 = httpx.get(f"{url}/rest/v1/todos?select=*&limit=1", headers=headers, timeout=10)
print(f"Verify: {r4.status_code} {r4.text[:300]}")
