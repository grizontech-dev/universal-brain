import asyncio
from Brain.agents.builder.mcp_tools import mcp_list_tools

async def test():
    config = {
        "configurable": {
            "thread_id": "test_session",
            "task_title": "test",
            "user_id": "490008c7-46fd-4ece-83c5-fa821613fcdc"
        }
    }
    print("Testing Supabase MCP tools...")
    res_sb = await mcp_list_tools.ainvoke({"service": "supabase"}, config=config)
    print("SUPABASE RESULT:", res_sb[:100])

if __name__ == "__main__":
    asyncio.run(test())
