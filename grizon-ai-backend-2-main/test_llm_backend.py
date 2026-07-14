import asyncio
from Brain.agents.builder.builder_agent import BuilderAgent
from Brain.agents.builder.mcp_tools import client_save_code
from Brain.shared.build_standards import FULL_STACK_BUILD_STANDARDS
from langchain_core.messages import SystemMessage, HumanMessage

async def test():
    b = BuilderAgent()
    llm = b.llm.bind_tools([client_save_code])
    system = f"You are the Backend Agent. Express API in backend/.\n\n{FULL_STACK_BUILD_STANDARDS}\n\nRULES:\n1. Always update backend/server.js when adding routes.\n2. Use client_save_code for EVERY file.\n3. Every route MUST be imported and mounted in server.js."
    msgs = [SystemMessage(content=system), HumanMessage(content="Task: Express API routes\nDescription: Create routes/contact.js with POST handler, controllers/contactController.js. Mount in server.js.")]
    try:
        r = await asyncio.wait_for(llm.ainvoke(msgs), timeout=120)
        print(f"Tool calls: {len(r.tool_calls) if r.tool_calls else 0}")
        if r.tool_calls:
            for tc in r.tool_calls:
                print(f"  Tool: {tc['name']}, path: {tc['args'].get('file_path', 'N/A')}")
        else:
            print(f"Content: {(r.content or '')[:200]}")
    except asyncio.TimeoutError:
        print("TIMED OUT after 120s")
    except Exception as e:
        print(f"ERROR: {type(e).__name__}: {e}")

asyncio.run(test())
