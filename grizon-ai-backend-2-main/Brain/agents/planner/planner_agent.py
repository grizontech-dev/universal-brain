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
            model_id="deepseek-v4-flash"
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
          "markdown_plan": "A COMPLETE Markdown plan covering ALL sections listed below. Use tight bullet points (one line per point) so it stays efficient, but DO NOT skip or shorten any section — every section below MUST be present and substantive. No filler sentences, no marketing language.",
          "tech_stack": ["React", "Express", "Supabase"],
          "stack": {{
            "frontend": "React",
            "backend": "Express",
            "db": "Supabase",
            "auth": "JWT",
            "styling": "Tailwind"
          }},
          "architecture": {{
            "pages": [
              {{
                "name": "Dashboard",
                "route": "/dashboard",
                "components": [
                  {{ "name": "StatsCard", "props": ["title", "value"], "depends_on": [] }},
                  {{ "name": "Chart", "props": ["data", "type"], "depends_on": ["StatsCard"] }}
                ]
              }}
            ],
            "components": ["Navbar", "Footer", "Sidebar"],
            "tables": [
              {{ "name": "tasks", "columns": [{{ "name": "title", "type": "text", "required": true }}] }}
            ],
            "api_routes": [
              {{ "path": "/api/tasks", "method": "GET", "purpose": "Fetch tasks" }}
            ],
            "models": ["Task", "User"],
            "features": [
              {{ "name": "Create Task", "page": "Dashboard", "backend": ["/api/tasks"], "database": ["tasks"] }}
            ],
            "dependencies": ["react-router-dom"]
          }},
          "execution_groups": [
            {{ "id": 1, "files": ["backend/supabase/schema.sql"] }},
            {{ "id": 2, "files": ["backend/routes/tasks.js", "backend/controllers/tasks.js"] }}
          ],
          "confidence": 0.9,
          "estimated_tasks": 11,
          "estimated_files": 47,
          "estimated_build_minutes": 90,
          "status": "proposed"
        }}

        GUIDELINES:
        1. The project_name MUST reflect the user's actual project (not a generic name).
        2. GROUNDING RULE (CRITICAL, ANTI-HALLUCINATION): Include ONLY what the user actually asked for in their request and Q&A answers. Do NOT invent features, pages, data models, or tech-stack items the user never mentioned or clearly implied. If the user's request is small, the plan must be small. If a section has nothing concrete to say, say it briefly rather than fabricating details.
        3. The markdown_plan MUST be based STRICTLY on the user's prompt and their Q&A answers in the context below. Every page, component, and feature in the plan must trace back to something the user said.
        4. AUTHORITY: The `markdown_plan` is for humans. The `architecture` object is for downstream agents (Todo/Builder). If they ever differ, the `architecture` object is authoritative. They MUST describe the same app — same pages, same routes, same tables, same API endpoints.
        5. HIERARCHY: Components that belong to a page go NESTED inside that page's `components` array (with props + depends_on). Only SHARED components (used on multiple pages, e.g. Navbar, Footer) go in the top-level `components` list.
        6. `api_routes` MUST include the HTTP method and purpose for every endpoint. `tables` MUST include column name, type, and required flag. Every `feature` MUST trace to its page, backend route(s), and database table(s).
        7. `execution_groups`: propose logical build groups — each group lists the exact file paths that should be built together (e.g. all files for one feature or one layer). The Todo Agent refines these into tasks.
        8. `tech_stack` (flat list) and `stack` (structured object) MUST contain the SAME technologies. Both are required.
        9. `confidence`: estimate how sure you are that the plan matches the user's intent (0.0–1.0). Low (< 0.6) only when the request is genuinely ambiguous.
        10. `estimated_tasks` / `estimated_files` / `estimated_build_minutes`: realistic estimates based on the actual scope of THIS plan.
        11. CRITICAL: You MUST use actual Markdown headers (e.g., `## Overview`, `## Architecture`, `### Frontend Stack`) for all sections. DO NOT just use bold text (`**Overview**`) for section titles.
        12. Use bullet points (`- `) for lists and ensure there is proper spacing (empty lines) between paragraphs and sections.
        13. Plan for preview-visible UI — not isolated component files.
        14. If the request includes Supabase, plan for the company-owned Supabase deployment through the Python Backend Proxy, using the Shared Table + JSONB Data Matrix Pattern, and never ask the user for their own Supabase credentials.
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

        response_content = await self.chat(messages, timeout=90, max_tokens=1800)
        plan = self._format_json_response(response_content)

        if not isinstance(plan, dict) or plan.get("error"):
            plan = {
                "project_name": "New Project",
                "markdown_plan": "## Overview\nHigh-level plan created with default assumptions.\n\n## Architecture\n- **Frontend:** React + Tailwind\n- **Backend:** Node.js + Express\n- **Database:** Company-owned Supabase via Python Backend Proxy\n- **Data Model:** Shared Table + JSONB Data Matrix Pattern\n\n## Key Pages\n- Landing Page\n- Dashboard\n- Settings",
                "tech_stack": ["React", "Tailwind", "Node", "Express", "Python Proxy", "Supabase"],
                "stack": {"frontend": "React", "backend": "Express", "db": "Supabase", "auth": "JWT", "styling": "Tailwind"},
                "architecture": {
                    "pages": [
                        {"name": "Landing Page", "route": "/", "components": [{"name": "Hero", "props": [], "depends_on": []}, {"name": "Features", "props": [], "depends_on": []}, {"name": "Footer", "props": [], "depends_on": []}]},
                        {"name": "Dashboard", "route": "/dashboard", "components": [{"name": "StatsCard", "props": ["title", "value"], "depends_on": []}, {"name": "Sidebar", "props": [], "depends_on": []}]},
                    ],
                    "components": ["Navbar"],
                    "tables": [],
                    "api_routes": [],
                    "models": [],
                    "features": [],
                    "dependencies": ["react-router-dom"],
                },
                "execution_groups": [
                    {"id": 1, "files": ["frontend/src/pages/Landing.jsx"]},
                    {"id": 2, "files": ["frontend/src/pages/Dashboard.jsx"]},
                ],
                "confidence": 0.5,
                "estimated_tasks": 8,
                "estimated_files": 25,
                "estimated_build_minutes": 60,
                "status": "proposed"
            }

        # Ensure structured keys always exist (backend/todo rely on them)
        if not isinstance(plan.get("architecture"), dict):
            plan["architecture"] = {}
        if not isinstance(plan.get("stack"), dict):
            stack_map = {}
            for t in (plan.get("tech_stack") or []):
                tl = str(t).lower()
                if "react" in tl: stack_map["frontend"] = t
                elif "vue" in tl: stack_map["frontend"] = t
                elif "angular" in tl: stack_map["frontend"] = t
                elif "next" in tl: stack_map["frontend"] = t
                elif "express" in tl: stack_map["backend"] = t
                elif "supabase" in tl: stack_map["db"] = t
                elif "postgres" in tl: stack_map["db"] = t
                elif "tailwind" in tl: stack_map["styling"] = t
                elif "jwt" in tl: stack_map["auth"] = t
            plan["stack"] = stack_map or {"frontend": "React", "backend": "Express", "db": "Supabase", "styling": "Tailwind"}

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
