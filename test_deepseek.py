from openai import OpenAI
import os

client = OpenAI(
    api_key=os.getenv("DEEPSEEK_API_KEY", "YOUR_DEEPSEEK_KEY"),
    base_url="https://api.deepseek.com/v1"
)

try:
    resp = client.chat.completions.create(
        model="deepseek-chat",
        messages=[{"role": "user", "content": "hi"}],
        max_tokens=10
    )
    print("OK:", resp.choices[0].message.content)
except Exception as e:
    print("ERROR:", type(e).__name__, str(e))
