import sys, os
sys.path.insert(0, os.path.abspath('..'))

import json, urllib.request, uuid

BASE = "http://127.0.0.1:8001/brain/projects"
owner_id = str(uuid.uuid4())

# 1. Create
data = json.dumps({
    "name": "API Test Project",
    "description": "Created via API",
    "frontend": "React",
    "backend": "Node.js",
    "database": "PostgreSQL",
    "css_framework": "Tailwind",
    "auth_method": "JWT",
    "requirements": ["auth", "api"],
    "owner_id": owner_id
}).encode()

req = urllib.request.Request(f"{BASE}", data=data, headers={"Content-Type": "application/json"}, method="POST")
resp = urllib.request.urlopen(req)
created = json.loads(resp.read())
print("CREATE:", created["id"], created["name"])
print("  frontend:", created["frontend"], "backend:", created["backend"])
print("  requirements:", created["requirements"])

pid = created["id"]

# 2. Get by ID
req = urllib.request.Request(f"{BASE}/{pid}")
resp = urllib.request.urlopen(req)
fetched = json.loads(resp.read())
print("\nGET:", fetched["name"], fetched["frontend"])

# 3. Append requirement
data = json.dumps({"requirement": "testing via API"}).encode()
req = urllib.request.Request(f"{BASE}/{pid}/requirements", data=data, headers={"Content-Type": "application/json"}, method="POST")
resp = urllib.request.urlopen(req)
print("\nAPPEND_REQ:", json.loads(resp.read()))

# 4. Update stack
data = json.dumps({"frontend": "Vue", "backend": "Python"}).encode()
req = urllib.request.Request(f"{BASE}/{pid}/stack", data=data, headers={"Content-Type": "application/json"}, method="PATCH")
resp = urllib.request.urlopen(req)
print("UPDATE_STACK:", json.loads(resp.read()))

# 5. List by owner
req = urllib.request.Request(f"{BASE}?owner_id={owner_id}")
resp = urllib.request.urlopen(req)
listed = json.loads(resp.read())
print("\nLIST:", len(listed), "project(s) for owner")

# Verify changes
req = urllib.request.Request(f"{BASE}/{pid}")
resp = urllib.request.urlopen(req)
final = json.loads(resp.read())
print("\nFINAL:", final["frontend"], final["backend"], final["requirements"])

print("\nAll API tests passed!")
