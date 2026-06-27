from typing import Any, Dict, List
import os
import json
from Brain.shared.agent import BaseAgent
from Brain.shared.build_standards import FULL_STACK_BUILD_STANDARDS
from langchain_core.messages import SystemMessage, HumanMessage
from Brain.shared.skills.resolver import SkillResolver
from Brain.shared.review_loop import QualityReviewer

class DatabaseAgent(BaseAgent):
    def __init__(self):
        super().__init__(
            name="Database Agent",
            description="Specialized in Supabase and MCP connectors.",
            model_id="gpt-4o-mini"
        )
        self.skill_resolver = SkillResolver()
        self.reviewer = QualityReviewer()

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
        You are the Database Agent for Grizon Brain. Supabase + PostgreSQL via files in `backend/supabase/`.

        {FULL_STACK_BUILD_STANDARDS}

        SKILLS:
        {skills_content}

        DATABASE AGENT RULES:
        1. Output SQL in `backend/supabase/schema.sql` or `backend/supabase/migrations/*.sql`.
        2. Table/column names MUST match what Backend controllers will use (e.g. `contact_submissions`).
        3. Include RLS policies in SQL when tables store user data.
        4. Optionally output `backend/.env.example` with SUPABASE_URL, SUPABASE_ANON_KEY placeholders.
        5. Update `backend/supabase/client.js` only if needed — template already exports `supabase`.
        6. NEVER: Supabase CLI, echo commands, npm install.
        7. **commands**: always `[]`.

        TASK:
        Title: {task.get('title')}
        Description: {task.get('description')}

        Respond ONLY in JSON:
        {{
          "files": [ {{ "path": "backend/supabase/...", "content": "..." }} ],
          "commands": [],
          "summary": "Tables created and how backend routes should use them"
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
        response_content = await self.chat(messages)
        generated_json = self._format_json_response(response_content)
        return generated_json
