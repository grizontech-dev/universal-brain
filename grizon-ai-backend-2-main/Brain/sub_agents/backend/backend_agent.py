from typing import Any, Dict, List
import os
import json
import asyncio
from Brain.shared.agent import BaseAgent
from Brain.shared.build_standards import FULL_STACK_BUILD_STANDARDS
from langchain_core.messages import SystemMessage, HumanMessage, ToolMessage
from Brain.shared.skills.resolver import SkillResolver
from Brain.agents.builder.mcp_tools import client_save_code
from Brain.services.provider_router import ProviderRouter

class BackendAgent(BaseAgent):
    def __init__(self):
        super().__init__(
            name="Backend Agent",
            description="Specialized in Node.js and Express.js.",
            model_id="Qwen/Qwen3-Coder-480B-A35B-Instruct-Turbo"
        )
        self.skill_resolver = SkillResolver()

    async def execute(self, current_task: Dict[str, Any], state: Dict[str, Any]) -> Dict[str, Any]:
        task = current_task
        plan = state.get("project_plan", {})
        executed = state.get("executed_tasks", [])[-5:]

        task_description = f"{task.get('title', '')} {task.get('description', '')}"
        
        skills_content = "{}"
        try:
            skills_content = self.skill_resolver.resolve_skills_for_task(task_description)
        except Exception as e:
            print(f"Skill resolution failed: {e}")
            skills_content = "{}"
        
        system_prompt = f"""
        You are the Backend Agent for Grizon Brain. Express API in `backend/` (template exists on port 3001) that talks to the company-owned Python Supabase proxy for persistence.

        {FULL_STACK_BUILD_STANDARDS}

        SKILLS (follow strictly):
        {skills_content}

        BACKEND AGENT RULES:
        1. **Always update `backend/server.js`** when you add or change any route — import and `app.use('/api/...', routes)`.
        2. **Structure**: `backend/routes/*.js`, `backend/controllers/*.js`, use Express.Router in routes.
        3. **Supabase**: controllers must call the Python Backend Proxy / internal persistence service; never require end-user Supabase credentials in generated code.
        4. **Frontend contract**: paths must match what frontend calls via `/api/...` (e.g. POST `/api/contact`, GET `/api/programs`).
        5. **package.json**: add express, cors, and any HTTP client deps needed to reach the proxy; do not add browser-facing Supabase client code.
        6. **commands & packages**: ALL packages used in the project MUST be added to `backend/package.json`. This is critical so that when `npm install` runs, there are no missing package errors and the project runs correctly. If you add ANY new dependencies, you MUST add them to `backend/package.json` AND return `"commands": ["cd backend && npm install"]`. The runner handles server restarts automatically.
        7. **MCP SANDBOX REQUIREMENT**: ALL web servers MUST run on port 9999 and bind to 0.0.0.0. This is an absolute requirement for the tunnel URL to work properly.
        Title: {task.get('title')}
        Description: {task.get('description')}
        Acceptance: {task.get('acceptance_criteria', '')}

        Respond ONLY in JSON:
        {{
          "files": [ {{ "path": "backend/...", "content": "..." }} ],
          "commands": [],
                    "summary": "List routes mounted in server.js and which proxy endpoints or shared tables they use"
        }}
        """

        session_state = state.get("memory_context", {}).get("session_state", {})
        wf_state = session_state.get("workflow_state", "")
        cur_agent = session_state.get("current_agent", "")
        task_idx = session_state.get("task_index", "")
        total_tk = session_state.get("total_tasks", "")
        session_summary_parts = []
        if wf_state: session_summary_parts.append(f"Phase: {wf_state}")
        if cur_agent: session_summary_parts.append(f"Active Agent: {cur_agent}")
        if task_idx or total_tk: session_summary_parts.append(f"Task: {task_idx}/{total_tk}")
        session_context = f"[Session] {' | '.join(session_summary_parts)}" if session_summary_parts else ""

        active_decisions = state.get("active_decisions", {})
        decisions_context = ""
        if active_decisions:
            decisions_lines = [f"  {k}: {v}" for k, v in active_decisions.items()]
            decisions_context = "[Approved Decisions - CRITICAL - Must Follow]\n" + "\n".join(decisions_lines)

        messages = [SystemMessage(content=system_prompt)]
        if session_context:
            messages.append(SystemMessage(content=session_context))
        if decisions_context:
            messages.append(SystemMessage(content=decisions_context))
        messages.append(
            HumanMessage(
                content=(
                    f"Execute task: {task.get('title')}\n"
                    f"Project plan: {json.dumps(plan, default=str)[:4000]}\n"
                    f"Recent completed tasks: {json.dumps(executed, default=str)[:2000]}"
                )
            ),
        )

        print(f"[BACKEND] Using model: Qwen/Qwen3-Coder-480B-A35B-Instruct-Turbo | task={task.get('title', 'N/A')}", flush=True)

        llm = ProviderRouter.get_model("Qwen/Qwen3-Coder-480B-A35B-Instruct-Turbo", temperature=0.7)
        bound_llm = llm.bind_tools([client_save_code])

        msgs = [SystemMessage(content=system_prompt), HumanMessage(content=messages[-1].content)]

        files_saved = []
        max_iterations = 8
        for iteration in range(max_iterations):
            try:
                response = await asyncio.wait_for(
                    bound_llm.ainvoke(msgs),
                    timeout=180
                )
            except Exception as e:
                print(f"[BACKEND] LLM error: {e}", flush=True)
                break

            msgs.append(response)

            if not response.tool_calls:
                break

            for tc in response.tool_calls:
                if tc["name"] == "client_save_code":
                    tool_args = tc["args"]
                    file_path = tool_args.get("file_path", "")
                    code_content = tool_args.get("code_content", "")

                    if file_path and code_content:
                        config = {"configurable": {"thread_id": state.get("current_job_id"), "task_title": task.get("title", ""), "user_id": state.get("user_id")}}
                        try:
                            await asyncio.wait_for(
                                client_save_code.ainvoke(tool_args, config=config),
                                timeout=30
                            )
                            files_saved.append(file_path)
                            print(f"[BACKEND] ✓ Saved: {file_path} ({len(code_content)} chars)", flush=True)
                            msgs.append(ToolMessage(
                                content=f"Successfully saved file: {file_path} ({len(code_content)} chars)",
                                tool_call_id=tc["id"]
                            ))
                        except Exception as e:
                            print(f"[BACKEND] ✖ Failed to save {file_path}: {e}", flush=True)
                            msgs.append(ToolMessage(
                                content=f"Error saving {file_path}: {str(e)}",
                                tool_call_id=tc["id"]
                            ))

        if not files_saved:
            last_content = msgs[-1].content if msgs else ""
            if isinstance(last_content, list):
                last_content = str(last_content)
            parsed = self._format_json_response(last_content)
            if isinstance(parsed, dict) and "files" in parsed:
                return parsed

        return {"files": [{"path": f, "content": ""} for f in files_saved], "summary": f"Saved {len(files_saved)} files via tool calls"}
