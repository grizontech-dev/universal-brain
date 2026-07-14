import asyncio, time
from Brain.agents.builder.builder_agent import BuilderAgent
from Brain.agents.builder.mcp_tools import client_save_code
from Brain.shared.build_standards import FULL_STACK_BUILD_STANDARDS
from Brain.shared.skills.resolver import SkillResolver
from langchain_core.messages import SystemMessage, HumanMessage

async def test():
    b = BuilderAgent()
    sr = SkillResolver()
    skills = sr.resolve_skills_for_task("Express API routes backend server.js routes")
    llm = b.llm.bind_tools([client_save_code])
    system = f"Backend Agent. Express API in backend/.\n\n{FULL_STACK_BUILD_STANDARDS}\n\nSKILLS:\n{skills}\n\nRULES:\n1. Update server.js.\n2. Use client_save_code.\n3. Mount routes in server.js."
    msgs = [SystemMessage(content=system), HumanMessage(content="Task: Express API routes\nDescription: Create routes/contact.js, controllers/contactController.js. Mount in server.js.")]
    print(f"System prompt: {len(system)} chars (~{len(system)//4} tokens)")
    start = time.time()
    try:
        r = await asyncio.wait_for(llm.ainvoke(msgs), timeout=90)
        elapsed = time.time() - start
        tc_count = len(r.tool_calls) if r.tool_calls else 0
        print(f"OK after {elapsed:.1f}s, tool_calls={tc_count}")
        if r.tool_calls:
            for tc in r.tool_calls:
                fp = tc["args"].get("file_path", "?")
                print(f"  {tc['name']} -> {fp}")
    except asyncio.TimeoutError:
        print(f"TIMEOUT after {time.time()-start:.1f}s")
    except Exception as e:
        print(f"ERROR after {time.time()-start:.1f}s: {type(e).__name__}: {e}")

asyncio.run(test())
