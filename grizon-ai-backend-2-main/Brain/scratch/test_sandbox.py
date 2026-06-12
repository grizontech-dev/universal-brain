import os
import asyncio
import httpx
from dotenv import load_dotenv

# Load env before importing services that use them
env_path = os.path.join(os.path.dirname(__file__), "..", "..", ".env")
load_dotenv(dotenv_path=env_path)

from Brain.services.sandbox_service import SandboxService

async def test_sandbox():
    # Re-initialize or use a fresh one to pick up env
    service = SandboxService()
    
    print("--- Sandbox Connectivity Test ---")
    print(f"Base URL: {service.base_url}")

    print(f"API Key: {service.api_key[:10]}..." if service.api_key else "API Key: MISSING")
    
    if not service.base_url:
        print("ERROR: BRAIN0_BASE_URL is not set.")
        return

    # 1. Check Health
    print("\n1. Checking Health...")
    health = await service.check_health()
    print(f"Health Response: {health}")

    # 2. Test Job Creation Logic...
    print("\n2. Testing Job Creation Logic...")
    repo_url = "https://github.com/Lightricks/LTX-2"
    user_intent = "Test job creation and URL resolution."
    
    job_data = await service.create_job(repo_url, user_intent, "test_job_id")

    
    if "error" in job_data:
        print(f"Job Creation Failed (expected if remote is down or data invalid): {job_data['error']}")
    else:
        print("Job Creation Succeeded!")
        print(f"Stream URL: {job_data.get('stream_url')}")
        print(f"Artifact URL: {job_data.get('artifact_url')}")
        
        # Verify no 127.0.0.1 or localhost remain
        stream_url = job_data.get('stream_url', '')
        if "127.0.0.1" in stream_url or "localhost" in stream_url:
            print("FAILED: URL still contains local address!")
        else:
            print("SUCCESS: URL resolution logic verified.")

if __name__ == "__main__":
    asyncio.run(test_sandbox())
