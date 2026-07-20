import httpx
import os

url = os.environ.get("SUPABASE_URL", "https://nsmqvydvmrgtpdzzgkrw.supabase.co")
key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
headers = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}

# Grant permissions
sql1 = "GRANT ALL ON public.todos TO service_role;"
r1 = httpx.post(f"{url}/rest/v1/rpc/exec_sql", headers=headers, json={"query": sql1}, timeout=15)
print(f"Grant service_role: {r1.status_code} {r1.text[:200]}")

sql2 = "GRANT ALL ON public.todos TO anon;"
r2 = httpx.post(f"{url}/rest/v1/rpc/exec_sql", headers=headers, json={"query": sql2}, timeout=15)
print(f"Grant anon: {r2.status_code} {r2.text[:200]}")

sql3 = "GRANT ALL ON public.todos TO authenticated;"
r3 = httpx.post(f"{url}/rest/v1/rpc/exec_sql", headers=headers, json={"query": sql3}, timeout=15)
print(f"Grant authenticated: {r3.status_code} {r3.text[:200]}")

# Verify
r4 = httpx.get(f"{url}/rest/v1/todos?select=*&limit=1", headers=headers, timeout=10)
print(f"Verify: {r4.status_code} {r4.text[:300]}")

# Test insert
r5 = httpx.post(f"{url}/rest/v1/todos", headers={**headers, "Prefer": "return=representation"}, json={"title": "Test todo", "description": "Testing table works", "priority": "high"}, timeout=10)
print(f"Insert: {r5.status_code} {r5.text[:300]}")
