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
            model_id="deepseek-v4-flash"
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

        # Resume build without plan approval — determine correct next step
        if state.get("resume_build") and not state.get("plan_approved"):
            _has_questions = False
            _has_plan = bool(state.get("project_plan"))
            _has_assistant_msgs = any(m.get("role", "").lower() == "assistant" for m in history)
            _history = state.get("messages", [])
            for _msg in reversed(_history):
                if _msg.get("role", "").lower() == "assistant":
                    _content = _msg.get("content", "")
                    if "__CLARIFY__" in _content or '"questions"' in _content:
                        _has_questions = True
                        break
            
            # Case 1: No assistant messages exist — user stopped during first processing
            # Don't intercept — let normal flow re-run with original content
            if not _has_assistant_msgs and not _has_plan:
                print(f"{LOG} Resume: no assistant messages or plan — re-running normal flow", flush=True)
                # Fall through to normal manager analysis below
            elif _has_questions:
                # Case 2: Questions were asked — resume questions flow
                print(f"{LOG} Resume build: questions pending — routing to questions", flush=True)
                state["next_agent"] = "questions"
                state["status"] = "needs_clarification"
                state["intent_confidence"] = 0.9
                state["leader_analysis"] = {
                    "analysis": "Resuming from interruption. There are pending questions to answer.",
                    "is_context_missing": True,
                    "next_agent": "questions",
                    "confidence": 0.9
                }
                return state
            elif _has_plan:
                # Case 3: Plan exists but not approved — show plan for review
                print(f"{LOG} Resume build: plan exists but not approved — routing to planner", flush=True)
                analysis = {
                    "analysis": "Resuming from interruption. The plan needs to be reviewed again before building.",
                    "is_context_missing": False,
                    "missing_details": [],
                    "next_agent": "planner",
                    "confidence": 0.95
                }
                state["leader_analysis"] = analysis
                state["intent_confidence"] = 0.95
                state["next_agent"] = "planner"
                state["status"] = "ready_to_plan"
                return state

        # Check for PDF or Image attachments in state or prompt
        has_attachments = (
            bool(state.get("attached_files")) or
            bool(state.get("attachedFileIds")) or
            "[File:" in prompt or
            "[Image Attachment:" in prompt or
            "[Document Attachment:" in prompt or
            "[PDF" in prompt or
            "pdf" in prompt.lower()
        )

        if has_attachments:
            print(f"{LOG} Attached PDF/Image detected! Automatically analyzing document and proceeding to Planner.", flush=True)
            rich_thought = "Attached document/image analyzed successfully. Extracting requirements and creating technical plan & todo list directly."
            analysis = {
                "analysis": rich_thought,
                "is_context_missing": False,
                "missing_details": [],
                "next_agent": "planner",
                "confidence": 0.95
            }
            state["leader_analysis"] = analysis
            state["intent_confidence"] = 0.95
            state["next_agent"] = "planner"
            state["status"] = "ready_to_plan"
            return state

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

            # Extract color palette from user answers
            from Brain.agents.questions.questions_agent import COLOR_PALETTES
            answers_lower = str(user_answers).lower()
            
            # Extract color palette - check predefined first
            palette_found = False
            for palette in COLOR_PALETTES:
                if palette["name"].lower() in answers_lower or palette["id"].lower() in answers_lower:
                    state["selected_color_palette"] = palette
                    state["theme_preference"] = palette.get("theme", "dark")
                    print(f"DEBUG: Selected color palette: {palette['name']} (theme: {palette.get('theme', 'dark')})", flush=True)
                    palette_found = True
                    break
            
            # If no predefined palette matched, treat as custom color input
            if not palette_found:
                state["custom_color_input"] = str(user_answers)
                state["theme_preference"] = "dark" if "dark" in str(user_answers).lower() else "light"
                print(f"DEBUG: Custom color input: {user_answers} (theme: {state['theme_preference']})", flush=True)

            # Skip LLM re-evaluation after ANY answer round — the QuestionsAgent
            # already asked targeted questions; re-evaluating adds a full LLM round
            # trip (~20s) just to decide what we already know.
            if current_rounds >= 1:
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
            response_content = await self.chat(re_eval_messages, model_id="deepseek-v4-flash", max_tokens=600)
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

        # === FOLLOW-UP PATH: User asks for a new feature or posts an error on existing project ===
        is_follow_up = len(history) >= 2
        
        if is_follow_up and not is_post_answers:
            # Check if user is requesting changes to the PLAN (not a new feature)
            plan_change_keywords = [
                "request changes", "change plan", "revise plan", "update plan",
                "modify plan", "edit plan", "change the plan", "revise the strategy",
                "update the strategy", "change the strategy", "plan feedback",
                "i would like to request changes", "plan changes", "redo plan",
                "replan", "re plan", "new plan", "different plan",
            ]
            prompt_lower = prompt.lower()
            is_plan_change = any(kw in prompt_lower for kw in plan_change_keywords)

            if is_plan_change:
                # Route to Planner to revise the plan
                print(f"DEBUG: ManagerAgent detected plan change request. Routing to Planner.")
                state["next_agent"] = "planner"
                state["status"] = "ready_to_plan"
                state["plan_feedback"] = prompt
                analysis = {
                    "analysis": f"The user requested changes to the plan: '{prompt}'. Routing to the Planner Agent to revise the technical strategy.",
                    "is_context_missing": False,
                    "missing_details": [],
                    "next_agent": "planner",
                    "confidence": 0.9
                }
                state["leader_analysis"] = analysis
                state["intent_confidence"] = 0.9
                return state

            print(f"DEBUG: ManagerAgent detected follow-up mode (len history = {len(history)}). Bypassing Planner.")
            
            # For follow-ups, Manager acts as the direct planner and task divider
            follow_up_prompt = """
            You are the Grizon Lead Project Architect. The user is asking for a change, a new feature, or posting an error for an ALREADY EXISTING project.
            
            Your job is to analyze the prompt and immediately divide it into a few concrete execution tasks for the Builder agent.
            Keep tasks small and scoped (e.g. 1-2 tasks for a small change, up to 3-4 for a big feature).
            ALWAYS include a final 'runner' task so the user can preview the changes.
            
            Categories available:
            - "frontend": for React components, UI, Vite config.
            - "backend": for Express routes, controllers, API logic.
            - "database": for ANY Supabase schema changes, creating tables, or writing SQL migrations.
            - "runner": to start servers.
            
            Respond ONLY with a JSON array of tasks:
            [
              {
                "id": "t1",
                "title": "Task Title",
                "description": "What exact files to modify and how to fix the issue or add the feature.",
                "category": "database", 
                "skill_required": "implement",
                "acceptance_criteria": "How to verify"
              },
              {
                "id": "t2",
                "title": "Runner: Install Dependencies & Start Servers",
                "description": "Runner starts backend and frontend dev servers.",
                "category": "runner",
                "skill_required": "runner",
                "acceptance_criteria": "Preview loads on port 5173"
              }
            ]
            """
            
            messages = [SystemMessage(content=follow_up_prompt)]
            if session_context:
                messages.append(SystemMessage(content=session_context))
            
            # Add recent history for context
            for msg in history[-4:]:
                role = msg.get("role", "USER")
                content = str(msg.get("content", ""))
                if role == "USER":
                    messages.append(HumanMessage(content=content))
                else:
                    messages.append(SystemMessage(content=f"Assistant: {content}"))
                    
            messages.append(HumanMessage(content=f"Current Update Request: {prompt}"))
            
            print(f"DEBUG: ManagerAgent requesting iterative tasks with {self.model_id}")
            response_content = await self.chat(messages, model_id="deepseek-v4-flash", max_tokens=1000)
            tasks = self._format_json_response(response_content)
            
            if not isinstance(tasks, list) or not tasks:
                # Fallback task
                tasks = [
                    {
                        "id": "t1",
                        "title": "Implement changes",
                        "description": f"Implement user request: {prompt}",
                        "category": "frontend",
                        "skill_required": "implement",
                        "acceptance_criteria": "Changes applied"
                    },
                    {
                        "id": "t2",
                        "title": "Runner: Install Dependencies & Start Servers",
                        "description": "Runner starts backend and frontend dev servers.",
                        "category": "runner",
                        "skill_required": "runner",
                        "acceptance_criteria": "Preview loads on port 5173"
                    }
                ]
                
            print(f"DEBUG: ManagerAgent generated {len(tasks)} iterative tasks.")
            
            analysis = {
                "analysis": f"I've analyzed your request and divided it into {len(tasks)} tasks. Sending directly to the Builder to implement the changes.",
                "is_context_missing": False,
                "missing_details": [],
                "next_agent": "builder",
                "confidence": 0.9
            }
            
            state["leader_analysis"] = analysis
            state["intent_confidence"] = 0.9
            state["tasks"] = tasks

            # Merge new tasks into existing plan instead of replacing
            existing_plan = state.get("plan", [])
            current_idx = state.get("current_task_index", 0)
            if existing_plan and current_idx < len(existing_plan):
                # Insert change tasks at current position, keep remaining original tasks
                before = existing_plan[:current_idx]
                after = existing_plan[current_idx + 1:]  # skip the current (partially done) task
                merged = before + tasks + after
                state["plan"] = merged
                state["current_task_index"] = current_idx
                print(f"DEBUG: ManagerAgent merged {len(tasks)} change tasks into existing plan ({len(merged)} total, index={current_idx})", flush=True)
            else:
                state["plan"] = tasks
                state["current_task_index"] = 0

            state["next_agent"] = "builder"
            state["status"] = "tasks_ready"
            return state

        # === NORMAL FIRST-TIME PATH: Analyze the prompt ===
        system_prompt = """
        You are the Grizon Lead Project Architect (Manager Agent).
        Your goal is to ensure the user's request is technically complete enough to create a high-fidelity plan.

        SYSTEM DIRECTIVES & PLATFORM BOUNDARIES (STRICT):
        - Target Platform is ALWAYS a Web Application (React Web App). NEVER ask or list missing details about platform choice (mobile, desktop, React Native, Electron, iOS, Android).
        - Tech Stack is FIXED (React + Express + Supabase + Tailwind CSS). NEVER ask or list missing details about tech stack or framework choices.

        PRODUCTION-READY REASONING:
        1. ANALYZE: Look at the current prompt and history carefully. Count the words — if under 10 words, it is ALMOST ALWAYS vague.
        2. CONTEXT CHECK: Do we know SPECIFICALLY what to build? "ecommerce store" is NOT enough — which products? what features? who is the customer? what's the brand vibe?
        3. TECH STACK & PLATFORM: Default to Web App (React/Node/Express/Supabase) — do NOT ask platform or stack questions.
        4. DECISION — BE AGGRESSIVE ABOUT ASKING:
           - ONE-LINE or SHORT prompts (under ~15 words): Almost always set is_context_missing = true. The user said WHAT but not HOW or FOR WHOM.
           - Vague nouns without specifics: "ecommerce store", "portfolio", "dashboard", "blog", "social media app" → ALWAYS missing context. Ask what products, what sections, what data, what actions.
           - "Clone X": Even clones need specifics — which features of X? What's different about this version? What branding?
           - ONLY set is_context_missing = false when the prompt has: (a) clear project type, (b) at least 2-3 specific features or pages mentioned, (c) a sense of purpose or audience.
        5. MISSING DETAILS TO ALWAYS CHECK (ask about any that are absent):
           - Purpose / who is this for? (e.g., "for my restaurant", "for SaaS product")
           - Core features / pages (e.g., "product listing, cart, checkout", "landing page, dashboard, settings")
           - Visual style or brand direction (the Questions Agent handles color palette, but you should note if branding is unclear)
           - Content scope (how many pages? how much content?)
           - Any unique or distinguishing requirements (what makes this different from a generic template?)

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
        import time as _t
        _t0 = _t.time()
        response_content = await self.chat(messages, model_id="deepseek-v4-flash", max_tokens=600)
        print(f"DEBUG: ManagerAgent LLM call took {_t.time()-_t0:.1f}s", flush=True)
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

        # Python pre-filter: drop missing details already covered by approved decisions.
        # If nothing genuinely remains, skip the Questions agent entirely -> planner.
        missing = analysis.get("missing_details") or []
        if isinstance(missing, list):
            approved = [str(k).lower() for k in (active_decisions or {}).keys()]
            if approved:
                missing = [m for m in missing if not any(k in str(m).lower() for k in approved)]
            missing = [m for m in missing if str(m).strip()]
            analysis["missing_details"] = missing
        wants_questions = analysis.get("next_agent") == "questions" and bool(missing)

        # Force planner if we've been in questions for too long
        if current_rounds >= 2 or not wants_questions:
            state["next_agent"] = "planner"
            state["status"] = "ready_to_plan"
        else:
            state["next_agent"] = "questions"
            state["status"] = "needs_clarification"

        print(f"{LOG} → next_agent='{state['next_agent']}' | status='{state['status']}' | confidence={state.get('intent_confidence', 'N/A')}", flush=True)
        return state
