import os
key = os.getenv("OPENAI_API_KEY", "")
base = os.getenv("OPENAI_BASE_URL", "")
print(f"KEY set: {bool(key)} len={len(key)}")
print(f"BASE_URL: {base or 'default'}")
print(f"Key first 8: {key[:8]}..." if key else "No key")
