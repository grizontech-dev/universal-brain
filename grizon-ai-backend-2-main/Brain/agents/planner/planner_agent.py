from typing import Any, Dict, List
import json
from Brain.shared.agent import BaseAgent
from Brain.shared.build_standards import FULL_STACK_BUILD_STANDARDS
from langchain_core.messages import SystemMessage, HumanMessage

class PlannerAgent(BaseAgent):
    def __init__(self):
        super().__init__(
            name="Planner",
            description="Creates the technical architecture and project plan.",
            model_id="deepseek-chat"
        )

    def _build_context_summary(self, history: List[dict], prompt: str) -> str:
        """Extracts a clean summary of what the user wants from conversation history."""
        context_lines = []
        for msg in history:
            role = msg.get("role", "USER").upper()
            content = str(msg.get("content", ""))
            if content.startswith("__CLARIFY__:"):
                continue
            if role == "USER" and content.strip():
                context_lines.append(f"User: {content.strip()}")
            elif role == "ASSISTANT" and content.strip() and not content.startswith("{"):
                context_lines.append(f"Context: {content.strip()[:200]}")
        context_lines.append(f"Final Request: {prompt}")
        return "\n".join(context_lines[-10:])  # Last 10 exchanges

    async def execute(self, state: Dict[str, Any]) -> Dict[str, Any]:
        """
        Creates or updates a comprehensive project plan based on user prompt and Q&A answers.
        """
        prompt = state.get("content", "")
        history = state.get("messages", [])
        feedback = state.get("plan_feedback", "")
        current_plan = state.get("project_plan", {})

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

        # Build a clean context summary from history
        context_summary = self._build_context_summary(history, prompt)

        system_prompt = f"""
        You are the Strategic Planner Agent for Grizon AI.
        
        CRITICAL: You MUST base your plan STRICTLY on the user's actual request and their Q&A answers provided in the conversation context below.
        Do NOT create a generic plan. Read every user message and answer carefully.
        
        {FULL_STACK_BUILD_STANDARDS}

        OUTPUT FORMAT - Return ONLY valid JSON, no markdown fences:
        {{
          "project_name": "Short descriptive name of the actual project",
          "markdown_plan": "A comprehensive, highly detailed Markdown document (v0-style) with sections for Overview, Architecture, Frontend Stack, Data Models, Key Pages & Components, Components to Build, Utilities & Helpers, Implementation Steps, Data Storage Strategy, and Future Enhancements. Include bullet points, bold text, and code formatting where appropriate.",
          "tech_stack": ["React", "Express", "Supabase"],
          "status": "proposed"
        }}

        GUIDELINES:
        1. The project_name MUST reflect the user's actual project (not a generic name).
        2. The markdown_plan MUST be extremely rich and detailed based on the user's answers. Break down the components, the data model, and exactly what pages will be built.
        3. CRITICAL: You MUST use actual Markdown headers (e.g., `## Overview`, `## Architecture`, `### Frontend Stack`) for all sections. DO NOT just use bold text (`**Overview**`) for section titles.
        4. Use bullet points (`- `) for lists and ensure there is proper spacing (empty lines) between paragraphs and sections.
        5. Plan for preview-visible UI — not isolated component files.
        """

        messages = [SystemMessage(content=system_prompt)]
        if session_context:
            messages.append(SystemMessage(content=session_context))

        # Inject the clean context summary as the primary input
        messages.append(HumanMessage(content=f"Project Context (including Q&A answers):\n{context_summary}"))

        if current_plan:
            messages.append(SystemMessage(content=f"Current Plan to Update: {json.dumps(current_plan)[:1000]}"))
            if feedback:
                messages.append(HumanMessage(content=f"User Feedback on Plan: {feedback}"))

        response_content = await self.chat(messages)
        plan = self._format_json_response(response_content)

        if not isinstance(plan, dict) or plan.get("error"):
            plan = {
                "project_name": "New Project",
                "markdown_plan": "## Overview\nHigh-level plan created with default assumptions.\n\n## Architecture\n- **Frontend:** React + Tailwind\n- **Backend:** Node.js + Express\n- **Database:** Supabase\n\n## Key Pages\n- Landing Page\n- Dashboard\n- Settings",
                "tech_stack": ["React", "Tailwind", "Node", "Express", "Supabase"],
                "status": "proposed"
            }

        # Ensure markdown_plan exists
        if not plan.get("markdown_plan"):
            plan["markdown_plan"] = "## Overview\nPlan created successfully.\n\n## Details\n" + str(plan.get("summary_points", "No detailed plan available."))

        # Minimal report text (just used internally, not displayed in chat)
        report = f"## {plan.get('project_name', 'New Project')} - Implementation Plan\n{plan.get('summary', '')}"

        state["project_plan"] = plan
        state["project_report"] = report
        state["status"] = "plan_proposed"
        state["next_agent"] = None

        return state
