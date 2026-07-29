import json
from typing import Any, Dict, List

from Brain.shared.agent import BaseAgent
from langchain_core.messages import SystemMessage, HumanMessage

LOG = "[REPORTER]"

class ReporterAgent(BaseAgent):
    def __init__(self):
        super().__init__(
            name="Reporter",
            description="Generates a final technical report based on the full execution state.",
            model_id="claude-sonnet-4.6"
        )

    async def execute(self, state: Dict[str, Any]) -> Dict[str, Any]:
        """
        Generates a comprehensive final technical report based on the
        execution state, including project details, completed tasks,
        sandbox information, and any errors encountered.

        Sets state['status'] to 'completed' and stores the report
        in state['report'].
        """
        project_plan = state.get("project_plan", {})
        executed_tasks: List[Dict[str, Any]] = state.get("executed_tasks", [])
        print(f"{LOG} ═══ EXECUTE ═══ project='{project_plan.get('project_name', 'N/A')}' | tasks_done={len(executed_tasks)}", flush=True)
        run_config = state.get("run_config", {})
        sandbox_id = state.get("current_job_id") or state.get("sandbox_id", "N/A")
        error_msg = state.get("error_msg", "")
        run_report = state.get("run_report", "")

        # Build a structured summary of all executed tasks
        tasks_summary = []
        for i, task in enumerate(executed_tasks, 1):
            task_entry = {
                "order": i,
                "title": task.get("title", task.get("task", "Unknown")),
                "category": task.get("category", "general"),
                "status": task.get("status", "unknown"),
                "summary": task.get("summary", task.get("result", "")),
            }
            if task.get("error"):
                task_entry["error"] = task.get("error")
            tasks_summary.append(task_entry)

        # Gather project metadata
        project_name = project_plan.get("project_name", "Unnamed Project")
        project_summary = project_plan.get("summary", "No summary provided.")
        architecture = project_plan.get("architecture", {})
        milestones = project_plan.get("milestones", [])
        tech_stack = project_plan.get("tech_stack", [])

        # Build the LLM prompt
        system_prompt = """You are the Grizon Technical Report Generator.
Your task is to produce a comprehensive, professional technical report
based on the execution data provided below.

REPORT STRUCTURE:
1. Executive Summary
2. Project Overview (name, summary, tech stack, architecture)
3. Task Execution Details (per-task breakdown with status and findings)
4. Sandbox / Runtime Environment Details
5. Milestones Achieved
6. Errors & Issues (if any)
7. Conclusion & Recommendations

RULES:
- Use professional Markdown formatting with headers, code blocks, and bullet points.
- Be precise and data-driven — reference actual values from the context.
- If errors occurred, highlight them clearly with remediation suggestions.
- Do not fabricate any information; only use what is provided.
- Tone: authoritative, technical, and concise.
"""

        # Construct the context payload
        sandbox_context = (
            f"Sandbox ID: {sandbox_id}\n"
            f"Framework: {run_config.get('framework', 'N/A')}\n"
            f"Port: {run_config.get('port', 'N/A')}\n"
            f"Install Command: `{run_config.get('install_command', 'N/A')}`\n"
            f"Start Command: `{run_config.get('start_command', 'N/A')}`"
        )

        error_section = ""
        if error_msg:
            error_section = f"**Error encountered:** {error_msg}\n\n"
        if run_report:
            error_section += f"**Run Report:**\n{run_report}\n\n"

        milestones_text = ""
        for m in milestones:
            milestones_text += f"- **{m.get('title', 'Untitled')}**: "
            milestones_text += ", ".join(m.get("tasks", [])) + "\n"

        tasks_json = json.dumps(tasks_summary, indent=2)
        arch_json = json.dumps(architecture, indent=2)

        user_input = f"""
=== PROJECT DETAILS ===
Name: {project_name}
Summary: {project_summary}
Tech Stack: {', '.join(tech_stack) if tech_stack else 'Not specified'}

=== ARCHITECTURE ===
{arch_json}

=== MILESTONES ===
{milestones_text if milestones_text else 'No milestones defined.'}

=== EXECUTED TASKS ===
{tasks_json}

=== SANDBOX ENVIRONMENT ===
{sandbox_context}

=== ERRORS & RUNTIME OUTPUT ===
{error_section if error_section else 'No errors encountered.'}
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
        messages.append(HumanMessage(content=user_input))

        response_content = await self.chat(messages)

        state["report"] = response_content
        state["status"] = "completed"
        state["next_agent"] = None

        return state