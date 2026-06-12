import os
import httpx
import asyncio
from dotenv import load_dotenv

load_dotenv()

async def check_google_models():
    api_key = os.getenv("GOOGLE_AI_API_KEY")
    if not api_key:
        print("Google API Key not found.")
        return
    
    url = f"https://generativelanguage.googleapis.com/v1beta/models?key={api_key}"
    async with httpx.AsyncClient() as client:
        try:
            response = await client.get(url)
            if response.status_code == 200:
                models = response.json().get("models", [])
                print("\nAvailable Google Models:")
                for m in models:
                    print(f"- {m['name']} (Supports: {', '.join(m['supportedGenerationMethods'])})")
            else:
                print(f"\nFailed to list Google models: {response.status_code}")
                print(response.text)
        except Exception as e:
            print(f"Error checking Google models: {str(e)}")

async def check_anthropic_models():
    # Anthropic doesn't have a direct 'list models' endpoint for keys.
    # We have to try a few common ones.
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        print("Anthropic API Key not found.")
        return
    
    models_to_try = [
        "claude-3-5-sonnet-20240620",
        "claude-3-sonnet-20240229",
        "claude-3-haiku-20240307",
        "claude-2.1"
    ]
    
    print("\nTesting Anthropic Models Access:")
    url = "https://api.anthropic.com/v1/messages"
    headers = {
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
    }
    
    async with httpx.AsyncClient() as client:
        for model in models_to_try:
            payload = {
                "model": model,
                "max_tokens": 1,
                "messages": [{"role": "user", "content": "Hi"}]
            }
            try:
                response = await client.post(url, headers=headers, json=payload)
                if response.status_code == 200:
                    print(f"- {model}: AVAILABLE")
                else:
                    print(f"- {model}: NOT AVAILABLE (Status {response.status_code})")
            except Exception as e:
                print(f"- {model}: ERROR ({str(e)})")

if __name__ == "__main__":
    asyncio.run(check_google_models())
    asyncio.run(check_anthropic_models())
