import asyncio
import os
import json
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Add the current directory to sys.path
import sys
current_dir = os.path.dirname(os.path.abspath(__file__))
parent_dir = os.path.dirname(current_dir)
if parent_dir not in sys.path:
    sys.path.insert(0, parent_dir)

from Brain.services.sandbox_service import sandbox_service

async def check_job():
    job_id = "j-1778590253-87510f01" # The UNIFIED job ID
    print(f"[CHECK] Checking status for Unified Job: {job_id}")
    
    status = await sandbox_service.get_job_status(job_id)
    print(f"\n[JOB STATUS]\n{json.dumps(status, indent=2)}")

if __name__ == "__main__":
    asyncio.run(check_job())
