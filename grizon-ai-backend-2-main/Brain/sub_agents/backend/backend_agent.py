from typing import Any, Dict, List
import os
import json
from Brain.shared.agent import BaseAgent
from Brain.shared.build_standards import FULL_STACK_BUILD_STANDARDS
from langchain_core.messages import SystemMessage, HumanMessage
from Brain.shared.skills.resolver import SkillResolver
from Brain.shared.review_loop import QualityReviewer

class BackendAgent(BaseAgent):
    def __init__(self):
        super().__init__(
            name="Backend Agent",
            description="Specialized in Node.js and Express.js.",
            model_id="deepseek-chat"
        )
        self.skill_resolver = SkillResolver()
        self.reviewer = QualityReviewer()

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
        You are the Backend Agent for Grizon Brain. Express API in `backend/` (template exists on port 3001).

        {FULL_STACK_BUILD_STANDARDS}

        SKILLS (follow strictly):
        {skills_content}

        BACKEND AGENT RULES:
        1. **Always update `backend/server.js`** when you add or change any route — import and `app.use('/api/...', routes)`.
        2. **Structure**: `backend/routes/*.js`, `backend/controllers/*.js`, use Express.Router in routes.
        3. **Supabase**: controllers import `{{ supabase }}` from `../supabase/client.js`; handle missing env gracefully.
        4. **Frontend contract**: paths must match what frontend calls via `/api/...` (e.g. POST `/api/contact`, GET `/api/programs`).
        5. **package.json**: add express, cors, @supabase/supabase-js, etc. in dependencies when needed.
        6. **commands & packages**: ALL packages used in the project MUST be added to `backend/package.json`. This is critical so that when `npm install` runs, there are no missing package errors and the project runs correctly. If you add ANY new dependencies, you MUST add them to `backend/package.json` AND return `"commands": ["cd backend && npm install"]`. The runner handles server restarts automatically.
        Title: {task.get('title')}
        Description: {task.get('description')}
        Acceptance: {task.get('acceptance_criteria', '')}

        Respond ONLY in JSON:
        {{
          "files": [ {{ "path": "backend/...", "content": "..." }} ],
          "commands": [],
          "summary": "List routes mounted in server.js and which Supabase tables they use"
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

        messages = [SystemMessage(content=system_prompt)]
        if session_context:
            messages.append(SystemMessage(content=session_context))
        messages.append(
            HumanMessage(
                content=(
                    f"Execute task: {task.get('title')}\n"
                    f"Project plan: {json.dumps(plan, default=str)[:4000]}\n"
                    f"Recent completed tasks: {json.dumps(executed, default=str)[:2000]}"
                )
            ),
        )

        # Generation (review loop disabled to prevent timeout)
        response_content = await self.chat(messages)
        generated_json = self._format_json_response(response_content)
        return generated_json
