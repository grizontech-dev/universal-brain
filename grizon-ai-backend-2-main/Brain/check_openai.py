import os
import httpx
import asyncio
from dotenv import load_dotenv

load_dotenv()

async def check_openai_models():
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        print("OpenAI API Key not found.")
        return
    
    url = "https://api.openai.com/v1/models"
    headers = {
        "Authorization": f"Bearer {api_key}"
    }
    
    async with httpx.AsyncClient() as client:
        try:
            response = await client.get(url, headers=headers)
            if response.status_code == 200:
                models = response.json().get("data", [])
                print("\nAvailable OpenAI Models:")
                for m in models:
                    if "gpt" in m['id']:
                        print(f"- {m['id']}")
            else:
                print(f"\nFailed to list OpenAI models: {response.status_code}")
                print(response.text)
        except Exception as e:
            print(f"Error checking OpenAI models: {str(e)}")

if __name__ == "__main__":
    asyncio.run(check_openai_models())
