import os
import httpx
import json
from typing import Dict, Any, Optional

class SandboxService:
    def __init__(self):
        self.base_url = os.getenv("BRAIN0_BASE_URL", "").rstrip("/")
        self.api_key = os.getenv("BRAIN0_API_KEY", "")
        self.headers = {
            "x-api-key": self.api_key,
            "Content-Type": "application/json"
        }
        if not self.base_url:
            print("WARNING: BRAIN0_BASE_URL is not set. Sandbox features may not work.")


    async def check_health(self) -> Dict[str, Any]:
        async with httpx.AsyncClient() as client:
            try:
                response = await client.get(f"{self.base_url}/healthz")
                return response.json()
            except Exception as e:
                return {"status": "error", "message": str(e)}

    async def create_job(self, repo_url: str, user_intent: str, job_id_external: Optional[str] = None) -> Dict[str, Any]:
        """Submits a job to the remote sandbox."""
        openai_key = os.getenv("OPENAI_API_KEY", "").strip()
        ant_key = os.getenv("ANTHROPIC_API_KEY", "").strip()
        openai_base = os.getenv("OPENAI_BASE_URL", "").strip() or None

        env_vars = {
            "OPENAI_API_KEY": openai_key,
            "OPENAI_BASE_URL": openai_base or "https://api.openai.com/v1",
            "DEEPSEEK_API_KEY": os.getenv("DEEPSEEK_API_KEY", ""),
            "DEEPSEEK_BASE_URL": os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com/v1"),
        }

        payload = {
            "repo_url": repo_url,
            "user_intent": user_intent,
            "job_id_external": job_id_external,
            "env": env_vars,
            "environment": env_vars,
            "model": os.getenv("DEFAULT_CHEAP_MODEL", "deepseek-chat"),
            "provider": "deepseek",
            "api_key": os.getenv("DEEPSEEK_API_KEY", openai_key),
            "base_url": os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com/v1"),
            "api_keys": env_vars
        }



        request_headers = {
            **self.headers,
            "X-OpenAI-Api-Key": openai_key or "",
        }



        
        print(f"DEBUG: Submitting job to {self.base_url}/jobs...")
        
        async with httpx.AsyncClient(timeout=30.0) as client:
            try:
                response = await client.post(
                    f"{self.base_url}/jobs",
                    headers=request_headers,
                    json=payload
                )
                
                print(f"DEBUG: Sandbox Response Status: {response.status_code}")
                if response.status_code != 202:
                    print(f"DEBUG: Sandbox Error Response: {response.text}")

                if response.status_code == 202:

                    data = response.json()
                    
                    # Determine the public host for the sandbox
                    # Priority: 1. SANDBOX_PUBLIC_HOST env var, 2. Host from BRAIN0_BASE_URL
                    public_host = os.getenv("SANDBOX_PUBLIC_HOST")
                    if not public_host:
                        # Extract host from base_url (e.g., http://65.0.11.173:8081 -> 65.0.11.173)
                        public_host = self.base_url.replace("http://", "").replace("https://", "").split(':')[0].split('/')[0]
                    
                    # Fix internal URLs if they point to localhost or 127.0.0.1
                    for key in ["stream_url", "artifact_url"]:
                        if key in data and data[key]:
                            # Replace localhost/127.0.0.1 with the public host
                            data[key] = data[key].replace("127.0.0.1", public_host).replace("localhost", public_host)
                            
                            # Ensure the URL has a protocol
                            if not data[key].startswith("http") and not data[key].startswith("ws"):
                                data[key] = f"http://{data[key]}"
                    
                    return data

                else:
                    print(f"Sandbox error {response.status_code}: {response.text}")
                    return {"error": response.text, "status_code": response.status_code}
            except Exception as e:
                print(f"Sandbox connection failed: {e}")
                return {"error": str(e)}

    async def get_job_status(self, job_id: str) -> Dict[str, Any]:
        async with httpx.AsyncClient() as client:
            try:
                response = await client.get(
                    f"{self.base_url}/jobs/{job_id}",
                    headers=self.headers
                )
                return response.json()
            except Exception as e:
                return {"error": str(e)}

    async def stop_job(self, job_id: str) -> Dict[str, Any]:
        """Terminates an active job in the sandbox."""
        async with httpx.AsyncClient() as client:
            try:
                # Assuming DELETE /jobs/{id} or POST /jobs/{id}/stop
                # We'll try DELETE first as it's standard for termination
                response = await client.delete(
                    f"{self.base_url}/jobs/{job_id}",
                    headers=self.headers
                )
                if response.status_code in [200, 204]:
                    return {"status": "stopped", "job_id": job_id}
                else:
                    # Fallback to /stop endpoint if DELETE isn't implemented
                    response = await client.post(
                        f"{self.base_url}/jobs/{job_id}/stop",
                        headers=self.headers
                    )
                    return response.json()
            except Exception as e:
                return {"error": str(e)}

sandbox_service = SandboxService()
