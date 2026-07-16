from typing import Any, Dict, List
import json
import os
from Brain.shared.agent import BaseAgent
from langchain_core.messages import SystemMessage, HumanMessage

LOG = "[MANAGER]"

class ManagerAgent(BaseAgent):
    def __init__(self):
        super().__init__(
            name="Leader/Manager",
            description="Analyzes user intent, ensures context is complete, and coordinates the workflow.",
            model_id="deepseek-chat"
        )

    def _build_rich_thought(self, prompt: str, analysis: dict, is_post_answers: bool = False) -> str:
        """Builds a rich, v0-style markdown thought from the manager's JSON analysis."""
        raw_analysis = analysis.get("analysis", "")
        missing_details = analysis.get("missing_details", [])
        next_agent = analysis.get("next_agent", "planner")

        lines = []

        if raw_analysis:
            lines.append(raw_analysis)
        else:
            lines.append(f'The user wants to build: **{prompt}**')

        if missing_details and len(missing_details) > 0 and next_agent == "questions":
            lines.append("")
            lines.append("They haven't specified:")
            for detail in missing_details:
                lines.append(f"- {detail}")

        lines.append("")
        if next_agent == "questions":
            if is_post_answers:
                lines.append("Some additional context is still needed to create the perfect plan. Asking a few more targeted questions.")
            else:
                lines.append("I should ask clarifying questions to understand exactly what they want to build. This will help me create something that actually serves their needs rather than guessing.")
        else:
            if is_post_answers:
                lines.append("I now have all the context I need. Calling the **Planner Agent** to create a full technical roadmap based on these requirements.")
            else:
                lines.append("I have enough context to proceed directly to planning. Calling the **Planner Agent** to create the technical roadmap now.")

        return "\n".join(lines)

    def _is_answering_questions(self, history: List[dict]) -> bool:
        """Detects if the user is answering clarification questions."""
        if not history:
            return False
        for msg in reversed(history):
            role = msg.get("role", "").upper()
            content = str(msg.get("content", ""))
            if role == "ASSISTANT":
                return content.startswith("__CLARIFY__:")
        return False

    def _extract_user_answers(self, history: List[dict]) -> str:
        """Extracts the user's answers (last USER message after a CLARIFY block)."""
        found_clarify = False
        for msg in reversed(history):
            role = msg.get("role", "").upper()
            content = str(msg.get("content", ""))
            if role == "ASSISTANT" and content.startswith("__CLARIFY__:"):
                found_clarify = True
            elif role == "USER" and found_clarify:
                return content
        return ""

    async def execute(self, state: Dict[str, Any]) -> Dict[str, Any]:
        """
        Analyzes the user prompt and decides the next step.
        - If user is answering questions → re-analyze with answers to decide: more questions OR planner
        - If context is missing → go to questions_agent
        - If clear → go to planner_agent
        """
        prompt = state.get("content", "")
        print(f"{LOG} ═══ EXECUTE ═══ prompt='{prompt[:200]}' | rounds={state.get('question_rounds', 0)}", flush=True)
        history = state.get("messages", [])
        current_rounds = state.get("question_rounds", 0)
        is_post_answers = self._is_answering_questions(history)

        # Extract session state for context injection
        memory_context = state.get("memory_context", {})
        session_state = memory_context.get("session_state", {})
        active_decisions = memory_context.get("decisions", {})
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

        # === POST-ANSWER PATH: User answered questions, re-evaluate with their answers ===
        if is_post_answers:
            print(f"DEBUG: ManagerAgent detected user answered questions (round {current_rounds})")
            user_answers = prompt  # The user's submitted answers IS the current message

            # Force go to planner after 2 rounds of Q&A (prevent infinite loops)
            if current_rounds >= 2:
                rich_thought = (
                    f"The user has provided their requirements across {current_rounds} rounds of questions.\n\n"
                    f"Based on their answers:\n{user_answers}\n\n"
                    f"I now have sufficient context to proceed. Calling the **Planner Agent** to create the full technical roadmap."
                )
                analysis = {
                    "analysis": rich_thought,
                    "is_context_missing": False,
                    "missing_details": [],
                    "next_agent": "planner",
                    "confidence": 0.9
                }
                state["leader_analysis"] = analysis
                state["intent_confidence"] = 0.9
                state["next_agent"] = "planner"
                state["status"] = "ready_to_plan"
                return state

            # Quick re-evaluation: do we have enough now, or do we need one more round?
            re_eval_prompt = f"""
            You are the Grizon Lead Project Architect. The user was just asked clarification questions and has answered them.

            Their answers: {user_answers}

            Based on THESE SPECIFIC answers, decide:
            1. Do we now have ENOUGH context to build the project? → next_agent = "planner"
            2. Is there ONE critical piece of info still missing that would fundamentally change the architecture? → next_agent = "questions", list it in missing_details

            IMPORTANT: Be lenient. If we can make reasonable assumptions, go to "planner". Only ask again if truly critical.

            Respond ONLY in JSON:
            {{
              "analysis": "One or two sentences describing what was learned from the answers and what to do next.",
              "is_context_missing": true or false,
              "missing_details": ["Only truly critical gaps"],
              "next_agent": "questions" or "planner",
              "confidence": 0.0 to 1.0
            }}
            """

            re_eval_messages = [
                SystemMessage(content=re_eval_prompt),
            ]
            if session_context:
                re_eval_messages.append(SystemMessage(content=session_context))
            if decisions_context:
                re_eval_messages.append(SystemMessage(content=decisions_context))
            re_eval_messages.append(HumanMessage(content=f"User answers: {user_answers}"))

            print(f"DEBUG: ManagerAgent re-evaluating post-answers with {self.model_id}")
            response_content = await self.chat(re_eval_messages, model_id=os.getenv("DEFAULT_CHEAP_MODEL", "deepseek-chat"), max_tokens=600)
            analysis = self._format_json_response(response_content)
            print(f"DEBUG: ManagerAgent re-eval result: {json.dumps(analysis)[:200]}...")

            if not isinstance(analysis, dict) or analysis.get("error"):
                # Default to planner if re-eval fails
                analysis = {
                    "analysis": f"Based on the user's answers, I have enough context to proceed with planning.",
                    "is_context_missing": False,
                    "missing_details": [],
                    "next_agent": "planner",
                    "confidence": 0.8
                }

            # Build rich thought for post-answer context
            rich_thought = self._build_rich_thought(user_answers, analysis, is_post_answers=True)
            analysis["analysis"] = rich_thought

            state["leader_analysis"] = analysis
            state["intent_confidence"] = analysis.get("confidence", 0.8)
            state["next_agent"] = analysis.get("next_agent", "planner")
            state["status"] = "needs_clarification" if state["next_agent"] == "questions" else "ready_to_plan"
            return state

        # === NORMAL FIRST-TIME PATH: Analyze the prompt ===
        system_prompt = """
        You are the Grizon Lead Project Architect (Manager Agent).
        Your goal is to ensure the user's request is technically complete enough to create a high-fidelity plan.

        PRODUCTION-READY REASONING:
        1. ANALYZE: Look at the current prompt and history carefully.
        2. CONTEXT CHECK: Do we know specifically WHAT they want to build? Is the domain/purpose clear?
        3. TECH STACK: Do we have enough info to pick a stack? (Default to React/Node/Supabase — don't ask unless fundamentally ambiguous.)
        4. DECISION:
           - If critical info is missing (e.g. "Build a website" — what kind? For whom?): is_context_missing = true, next_agent = "questions".
           - If we have enough to start planning: is_context_missing = false, next_agent = "planner".

        Respond ONLY in JSON (no extra text, no markdown fences):
        {
          "analysis": "One or two sentences describing what the user wants and why we need more info (or why we have enough).",
          "is_context_missing": true or false,
          "missing_details": ["Specific missing detail 1", "Specific missing detail 2", "Specific missing detail 3"],
          "next_agent": "questions" or "planner",
          "confidence": 0.0 to 1.0
        }
        """

        messages = [SystemMessage(content=system_prompt)]
        if session_context:
            messages.append(SystemMessage(content=session_context))
        if decisions_context:
            messages.append(SystemMessage(content=decisions_context))

        for msg in history:
            role = msg.get("role", "USER")
            content = str(msg.get("content", ""))
            if role == "USER":
                messages.append(HumanMessage(content=content))
            else:
                messages.append(SystemMessage(content=f"Assistant: {content}"))

        messages.append(HumanMessage(content=f"Current User Input: {prompt}"))

        print(f"DEBUG: ManagerAgent requesting chat with model {self.model_id}")
        response_content = await self.chat(messages, model_id=os.getenv("DEFAULT_CHEAP_MODEL", "deepseek-chat"), max_tokens=600)
        print(f"DEBUG: ManagerAgent raw response: {response_content[:200]}...")
        analysis = self._format_json_response(response_content)
        print(f"DEBUG: ManagerAgent parsed analysis: {json.dumps(analysis)[:200]}...")

        if not isinstance(analysis, dict) or analysis.get("error"):
            analysis = {
                "analysis": f"The user wants to build: **{prompt}**",
                "is_context_missing": True,
                "missing_details": ["primary goal and purpose", "target audience", "key features required"],
                "next_agent": "questions",
                "confidence": 0.3
            }

        # Build the rich, v0-style markdown thought programmatically
        rich_thought = self._build_rich_thought(prompt, analysis, is_post_answers=False)
        analysis["analysis"] = rich_thought

        state["leader_analysis"] = analysis
        state["intent_confidence"] = analysis.get("confidence", 0.5)

        # Force planner if we've been in questions for too long
        if current_rounds >= 2:
            state["next_agent"] = "planner"
            state["status"] = "ready_to_plan"
        else:
            state["next_agent"] = analysis.get("next_agent", "questions")
            state["status"] = "needs_clarification" if state["next_agent"] == "questions" else "ready_to_plan"

        print(f"{LOG} → next_agent='{state['next_agent']}' | status='{state['status']}' | confidence={state.get('intent_confidence', 'N/A')}", flush=True)
        return state
