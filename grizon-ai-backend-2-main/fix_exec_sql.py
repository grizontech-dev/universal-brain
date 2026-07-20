import httpx, json
import os

url = os.environ.get("SUPABASE_URL", "https://nsmqvydvmrgtpdzzgkrw.supabase.co")
key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
headers = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}

# Drop and recreate exec_sql to handle both SELECT and DDL
fix_sql = """
DROP FUNCTION IF EXISTS exec_sql(text);

CREATE OR REPLACE FUNCTION exec_sql(query text)
RETURNS json AS $$
DECLARE
    result json;
BEGIN
    IF trim(lower(query)) LIKE 'select%' THEN
        EXECUTE query INTO result;
        RETURN result;
    ELSE
        EXECUTE query;
        RETURN json_build_object('success', true, 'message', 'Query executed successfully');
    END IF;
EXCEPTION WHEN OTHERS THEN
    RETURN json_build_object('error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
"""

r = httpx.post(f"{url}/rest/v1/rpc/exec_sql", headers=headers, json={"query": fix_sql}, timeout=15)
print(f"Fix exec_sql: {r.status_code} {r.text[:500]}")
