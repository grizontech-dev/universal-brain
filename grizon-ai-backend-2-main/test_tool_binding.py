import asyncio
from Brain.agents.builder.builder_agent import BuilderAgent
from Brain.agents.builder.mcp_tools import client_save_code
from langchain_core.messages import SystemMessage, HumanMessage

async def test():
    b = BuilderAgent()
    llm = b.llm.bind_tools([client_save_code])
    msgs = [
        SystemMessage(content="Create a health route in Express"),
        HumanMessage(content="Create backend/routes/health.js with a GET /health endpoint")
    ]
    r = await asyncio.wait_for(llm.ainvoke(msgs), timeout=60)
    print(f"Tool calls: {len(r.tool_calls) if r.tool_calls else 0}")
    if r.tool_calls:
        for tc in r.tool_calls:
            print(f"  Tool: {tc['name']}, args: {list(tc['args'].keys())}")
    else:
        print(f"Content: {(r.content or '')[:200]}")

asyncio.run(test())
