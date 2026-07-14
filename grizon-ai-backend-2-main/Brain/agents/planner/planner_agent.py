from typing import Any, Dict, List
import json
import os
from Brain.shared.agent import BaseAgent
from langchain_core.messages import SystemMessage, HumanMessage

LOG = "[PLANNER]"

class PlannerAgent(BaseAgent):
    def __init__(self):
        super().__init__(
            name="Planner",
            description="Creates the technical architecture and project plan.",
            model_id=os.getenv("DEFAULT_CHEAP_MODEL", "gpt-4o")
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
        print(f"{LOG} ═══ EXECUTE ═══ prompt='{prompt[:200]}' | has_feedback={bool(state.get('plan_feedback'))}", flush=True)
        history = state.get("messages", [])
        feedback = state.get("plan_feedback", "")
        current_plan = state.get("project_plan", {})

        memory_context = state.get("memory_context", {})
        session_state = memory_context.get("session_state", {})
        active_decisions = memory_context.get("decisions", {})
        architecture_patterns = memory_context.get("architecture_patterns", [])
        best_skills = memory_context.get("best_skills", [])
        similar_projects = memory_context.get("similar_projects", [])
        wf_state = session_state.get("workflow_state", "")
        cur_agent = session_state.get("current_agent", "")
        task_idx = session_state.get("task_index", "")
        total_tk = session_state.get("total_tasks", "")
        session_summary_parts = []
        if wf_state: session_summary_parts.append(f"Phase: {wf_state}")
        if cur_agent: session_summary_parts.append(f"Active Agent: {cur_agent}")
        if task_idx or total_tk: session_summary_parts.append(f"Task: {task_idx}/{total_tk}")
        session_context = f"[Session] {' | '.join(session_summary_parts)}" if session_summary_parts else ""

        decisions_context = ""
        if active_decisions:
            decisions_lines = [f"  {k}: {v}" for k, v in active_decisions.items()]
            decisions_context = "[Approved Decisions - MUST FOLLOW]\n" + "\n".join(decisions_lines)

        # ArchitectureMemory — proven tech patterns
        arch_context = ""
        if architecture_patterns:
            arch_lines = [f"  {p['pattern']}: used {p['uses']}x, {p['success_rate']*100:.0f}% success" for p in architecture_patterns]
            arch_context = "[Proven Architecture Patterns]\n" + "\n".join(arch_lines)

        # SkillMemory — best performing agents
        skills_context = ""
        if best_skills:
            skills_lines = [f"  {s['name']}: {s['uses']} uses, avg score {s['score']:.0f}" for s in best_skills]
            skills_context = "[Best Performing Agents]\n" + "\n".join(skills_lines)

        # LongTermMemory — similar past projects
        similar_context = ""
        if similar_projects:
            similar_lines = [f"  {s.get('content', '')[:100]}... (similarity: {s.get('similarity', 0):.2f})" for s in similar_projects]
            similar_context = "[Similar Past Projects]\n" + "\n".join(similar_lines)

        # Build a clean context summary from history
        context_summary = self._build_context_summary(history, prompt)

        system_prompt = f"""
        You are the Strategic Planner Agent for Grizon AI.
        
        CRITICAL: You MUST base your plan STRICTLY on the user's actual request and their Q&A answers provided in the conversation context below.
        Do NOT create a generic plan. Read every user message and answer carefully.

        OUTPUT FORMAT - Return ONLY valid JSON, no markdown fences:
        {{
          "project_name": "Short descriptive name of the actual project",
          "markdown_plan": "A clear, well-structured Markdown plan (concise but complete) with sections for Overview, Architecture, Frontend Stack, Data Models, Key Pages & Components, Components to Build, Utilities & Helpers, Implementation Steps, Data Storage Strategy, and Future Enhancements. Include bullet points, bold text, and code formatting where appropriate.",
          "tech_stack": ["React", "Express", "Supabase"],
          "status": "proposed"
        }}

        GUIDELINES:
        1. The project_name MUST reflect the user's actual project (not a generic name).
        2. The markdown_plan MUST be clear and complete (concise, not bloated) based on the user's answers. Break down the components, the data model, and exactly what pages will be built.
        3. CRITICAL: You MUST use actual Markdown headers (e.g., `## Overview`, `## Architecture`, `### Frontend Stack`) for all sections. DO NOT just use bold text (`**Overview**`) for section titles.
        4. Use bullet points (`- `) for lists and ensure there is proper spacing (empty lines) between paragraphs and sections.
        5. Plan for preview-visible UI — not isolated component files.
        6. If the request includes Supabase, plan for the company-owned Supabase deployment through the Python Backend Proxy, using the Shared Table + JSONB Data Matrix Pattern, and never ask the user for their own Supabase credentials.
        """

        messages = [SystemMessage(content=system_prompt)]
        if session_context:
            messages.append(SystemMessage(content=session_context))
        if decisions_context:
            messages.append(SystemMessage(content=decisions_context))
        if arch_context:
            messages.append(SystemMessage(content=arch_context))
        if skills_context:
            messages.append(SystemMessage(content=skills_context))
        if similar_context:
            messages.append(SystemMessage(content=similar_context))

        # Inject the clean context summary as the primary input
        messages.append(HumanMessage(content=f"Project Context (including Q&A answers):\n{context_summary}"))

        if current_plan:
            messages.append(SystemMessage(content=f"Current Plan to Update: {json.dumps(current_plan)[:1000]}"))
            if feedback:
                messages.append(HumanMessage(content=f"User Feedback on Plan: {feedback}"))

        response_content = await self.chat(messages, max_tokens=1800)
        plan = self._format_json_response(response_content)

        if not isinstance(plan, dict) or plan.get("error"):
            plan = {
                "project_name": "New Project",
                "markdown_plan": "## Overview\nHigh-level plan created with default assumptions.\n\n## Architecture\n- **Frontend:** React + Tailwind\n- **Backend:** Node.js + Express\n- **Database:** Company-owned Supabase via Python Backend Proxy\n- **Data Model:** Shared Table + JSONB Data Matrix Pattern\n\n## Key Pages\n- Landing Page\n- Dashboard\n- Settings",
                "tech_stack": ["React", "Tailwind", "Node", "Express", "Python Proxy", "Supabase"],
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
