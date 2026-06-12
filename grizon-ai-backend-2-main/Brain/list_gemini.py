import os
import httpx
import asyncio
from dotenv import load_dotenv

load_dotenv()

async def main():
    api_key = os.getenv("GOOGLE_AI_API_KEY")
    if not api_key:
        print("GOOGLE_AI_API_KEY not found.")
        return
    
    url = f"https://generativelanguage.googleapis.com/v1beta/models?key={api_key}"
    async with httpx.AsyncClient() as client:
        try:
            response = await client.get(url)
            if response.status_code == 200:
                models = response.json().get("models", [])
                print("Available Gemini Models (generateContent):")
                for m in models:
                    if 'generateContent' in m['supportedGenerationMethods']:
                        print(f"- {m['name']}")
            else:
                print(f"Error {response.status_code}: {response.text}")
        except Exception as e:
            print(f"Error: {e}")

if __name__ == "__main__":
    asyncio.run(main())
