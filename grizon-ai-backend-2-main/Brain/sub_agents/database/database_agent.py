from typing import Any, Dict, List
import os
import json
from Brain.shared.agent import BaseAgent
from Brain.shared.build_standards import FULL_STACK_BUILD_STANDARDS
from langchain_core.messages import SystemMessage, HumanMessage
from Brain.shared.skills.resolver import SkillResolver

class DatabaseAgent(BaseAgent):
    def __init__(self):
        super().__init__(
            name="Database Agent",
            description="Specialized in company-owned Supabase schema design and MCP connectors.",
            model_id="deepseek-v4-flash"
        )
        self.skill_resolver = SkillResolver()

    async def execute(self, current_task: Dict[str, Any], state: Dict[str, Any]) -> Dict[str, Any]:
        task = current_task
        plan = state.get("project_plan", {})

        task_description = f"{task.get('title', '')} {task.get('description', '')}"
        
        skills_content = "{}"
        try:
            skills_content = self.skill_resolver.resolve_skills_for_task(task_description)
        except Exception as e:
            print(f"Skill resolution failed: {e}")
            skills_content = "{}"
        
        system_prompt = f"""
        You are the Database Agent for Grizon Brain. When the task uses Supabase, it must use the fixed company-owned Supabase deployment through the Shared Table + JSONB Data Matrix Pattern and the company-owned Python proxy. Do not alter any non-Supabase project flow.

        {FULL_STACK_BUILD_STANDARDS}

        SKILLS:
        {skills_content}

        DATABASE AGENT RULES:
        1. Output SQL in `backend/supabase/schema.sql` or `backend/supabase/migrations/*.sql` only for Supabase-related tasks.
        2. Prefer a shared tenant-scoped table with JSONB payload columns (`tenant_id`, `entity_type`, `entity_key`, `payload_jsonb`, `metadata_jsonb`) over per-user tables.
        3. Include RLS policies, tenant filters, and JSONB GIN indexes in SQL when tables store user data.
        4. Keep schemas compact and storage-aware so the shared company Supabase project stays within the 500 MB free-tier constraint.
        5. Do not output any user Supabase credentials; if config notes are needed, keep them server-side and proxy-only.
        6. NEVER: Supabase CLI, echo commands, npm install.
        7. **commands**: always `[]`.

        TASK:
        Title: {task.get('title')}
        Description: {task.get('description')}

        Respond ONLY in JSON:
        {{
          "files": [ {{ "path": "backend/supabase/...", "content": "..." }} ],
          "commands": [],
          "summary": "Shared table SQL created and how the proxy/backend should use it"
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
                content=f"Execute task: {task.get('title')}\nPlan: {json.dumps(plan, default=str)[:3000]}"
            ),
        )

        # Generation (review loop disabled to prevent timeout)
        response_content = await self.chat(messages, timeout=180, max_tokens=2000)
        generated_json = self._format_json_response(response_content)
        return generated_json
