import asyncio
import httpx
import os

SUPABASE_URL = "https://nsmqvydvmrgtpdzzgkrw.supabase.co"
SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "YOUR_SUPABASE_KEY")

# Try to use PostgREST to create table via SQL injection endpoint
# Some Supabase instances have this enabled

async def try_create_table():
    async with httpx.AsyncClient() as client:
        headers = {
            "apikey": SERVICE_ROLE_KEY,
            "Authorization": f"Bearer {SERVICE_ROLE_KEY}",
            "Content-Type": "application/json",
        }
        
        # Method 1: Try to create via rpc with raw SQL
        print("Method 1: Trying RPC exec_sql...")
        response = await client.post(
            f"{SUPABASE_URL}/rest/v1/rpc/exec_sql",
            headers=headers,
            json={"query": "SELECT 1"}
        )
        print(f"  Status: {response.status_code}")
        
        # Method 2: Try to use the schema endpoint
        print("\nMethod 2: Trying schema endpoint...")
        response = await client.get(
            f"{SUPABASE_URL}/rest/v1/",
            headers=headers
        )
        print(f"  Status: {response.status_code}")
        
        # Method 3: Try to create via PostgREST proxy
        print("\nMethod 3: Trying PostgREST proxy...")
        response = await client.post(
            f"{SUPABASE_URL}/rest/v1/rpc/create_table_if_not_exists",
            headers=headers,
            json={
                "table_name": "tenant_connector_vault",
                "columns": [
                    {"name": "id", "type": "uuid", "default": "gen_random_uuid()", "primary": True},
                    {"name": "tenant_id", "type": "text", "nullable": False},
                    {"name": "schema_name", "type": "text", "nullable": False},
                    {"name": "record_data", "type": "jsonb", "default": "'{}'::jsonb"},
                    {"name": "created_at", "type": "timestamptz", "default": "now()"},
                    {"name": "updated_at", "type": "timestamptz", "default": "now()"}
                ]
            }
        )
        print(f"  Status: {response.status_code}")
        print(f"  Response: {response.text[:200]}")
        
        # Method 4: Try direct database connection via Supabase
        print("\nMethod 4: Checking Supabase connection info...")
        response = await client.get(
            f"{SUPABASE_URL}/rest/v1/",
            headers={**headers, "Accept": "application/openapi+json"}
        )
        print(f"  Status: {response.status_code}")
        if response.status_code == 200:
            data = response.json()
            print(f"  Paths: {list(data.get('paths', {}).keys())[:10]}")

asyncio.run(try_create_table())
