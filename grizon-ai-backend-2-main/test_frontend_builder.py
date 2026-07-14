import asyncio, time
from Brain.agents.builder.builder_agent import BuilderAgent
from Brain.agents.builder.mcp_tools import client_save_code
from Brain.shared.build_standards import FULL_STACK_BUILD_STANDARDS
from Brain.shared.skills.resolver import SkillResolver
from langchain_core.messages import SystemMessage, HumanMessage

async def test():
    b = BuilderAgent()
    sr = SkillResolver()
    skills = sr.resolve_skills_for_task("React frontend Navbar Hero Features Tailwind")
    llm = b.llm.bind_tools([client_save_code])
    system = f"Frontend Agent. React in frontend/.\n\n{FULL_STACK_BUILD_STANDARDS}\n\nSKILLS:\n{skills}\n\nRULES:\n1. main.jsx imports App.jsx ONLY.\n2. Include App.jsx in every response.\n3. Connect all components in App.jsx.\n4. Use client_save_code for EVERY file.\n5. Vite MUST run on port 9999.\n6. Every import MUST match actual file.\n7. MAX 12 tool calls.\n8. React Router v6 MANDATORY.\n9. REAL UI ONLY with Tailwind CSS."
    msgs = [SystemMessage(content=system), HumanMessage(content="Task: Build Frontend Components\nDescription: Create Navbar.jsx, Hero.jsx, Features.jsx in frontend/src/components/. Navbar: dark bg, logo, links. Hero: gradient bg, headline, CTA. Features: 3-card grid. All with Tailwind dark theme.")]
    print(f"System prompt: {len(system)} chars (~{len(system)//4} tokens)")
    start = time.time()
    try:
        r = await asyncio.wait_for(llm.ainvoke(msgs), timeout=120)
        elapsed = time.time() - start
        tc_count = len(r.tool_calls) if r.tool_calls else 0
        print(f"OK after {elapsed:.1f}s, tool_calls={tc_count}")
        if r.tool_calls:
            for tc in r.tool_calls:
                fp = tc["args"].get("file_path", "?")
                content_len = len(tc["args"].get("code_content", ""))
                print(f"  {tc['name']} -> {fp} ({content_len} chars)")
    except asyncio.TimeoutError:
        print(f"TIMEOUT after {time.time()-start:.1f}s")
    except Exception as e:
        print(f"ERROR after {time.time()-start:.1f}s: {type(e).__name__}: {e}")

asyncio.run(test())
