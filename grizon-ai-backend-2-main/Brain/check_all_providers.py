import os
import asyncio
from dotenv import load_dotenv
from langchain_openai import ChatOpenAI
from langchain_anthropic import ChatAnthropic
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.messages import HumanMessage

load_dotenv()

async def test_provider(name, model_obj):
    print(f"Testing {name}...")
    try:
        response = await model_obj.ainvoke([HumanMessage(content="hi")])
        print(f"SUCCESS: {name} works!")
        return True
    except Exception as e:
        print(f"FAIL: {name} failed: {str(e)}")
        return False

async def main():
    openai_key = os.getenv("OPENAI_API_KEY")
    anthropic_key = os.getenv("ANTHROPIC_API_KEY")
    gemini_key = os.getenv("GOOGLE_AI_API_KEY")

    tasks = []
    if openai_key:
        tasks.append(test_provider("OpenAI", ChatOpenAI(model="gpt-4o-mini", api_key=openai_key)))
    else:
        print("OpenAI key missing")

    if anthropic_key:
        tasks.append(test_provider("Anthropic", ChatAnthropic(model="claude-3-5-sonnet-20240620", anthropic_api_key=anthropic_key)))
    else:
        print("Anthropic key missing")

    if gemini_key:
        tasks.append(test_provider("Gemini", ChatGoogleGenerativeAI(model="gemini-1.5-flash", google_api_key=gemini_key)))
    else:
        print("Gemini key missing")

    if tasks:
        await asyncio.gather(*tasks)
    else:
        print("No keys found at all!")

if __name__ == "__main__":
    asyncio.run(main())
