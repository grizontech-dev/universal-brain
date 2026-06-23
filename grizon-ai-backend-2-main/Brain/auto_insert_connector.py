import sys, os, httpx, jwt
from datetime import datetime

current_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(current_dir))

from Brain.config.database import SessionLocal
from sqlalchemy import text

app_id = os.getenv("GITHUB_APP_ID")
private_key_path = os.getenv("GITHUB_APP_PRIVATE_KEY_PATH", "").strip('"')
private_key = ""
if private_key_path and os.path.exists(private_key_path):
    with open(private_key_path, "r") as f:
        private_key = f.read()

if not app_id or not private_key:
    print("Missing env vars")
    sys.exit(1)

private_key = private_key.replace("\\n", "\n")
now = datetime.utcnow()
payload = {"iat": int(now.timestamp()) - 60, "exp": int(now.timestamp()) + 540, "iss": app_id}
app_jwt = jwt.encode(payload, private_key, algorithm="RS256")

headers = {
    "Authorization": f"Bearer {app_jwt}",
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
}

response = httpx.get("https://api.github.com/app/installations", headers=headers)
installations = response.json()

if not installations:
    print("No installations found")
else:
    print("Installations response:", installations)
    print("Found installation ID:", inst_id)
    
    db = SessionLocal()
    import uuid
    db.execute(text("INSERT INTO connectors (id, \"userId\", type, config, \"createdAt\", \"updatedAt\") VALUES (:id, 'test_user_123', 'github', :config, now(), now()) ON CONFLICT DO NOTHING"), {"id": str(uuid.uuid4()), "config": '{"installation_id": "' + inst_id + '", "metadata": {}}'})
    db.commit()
    print("Inserted connector for test_user_123!")
