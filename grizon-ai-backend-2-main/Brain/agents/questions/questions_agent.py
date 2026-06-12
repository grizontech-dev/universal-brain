from typing import Any, Dict, List
import json
from Brain.shared.agent import BaseAgent
from langchain_core.messages import SystemMessage, HumanMessage

class QuestionsAgent(BaseAgent):
    def __init__(self):
        super().__init__(
            name="Questions",
            description="Asks follow-up questions to gather missing context.",
            model_id="gpt-4o-mini"
        )

    async def execute(self, state: Dict[str, Any]) -> Dict[str, Any]:
        """
        Generates contextual questions based on leader analysis.
        """
        prompt = state.get("content", "")
        analysis = state.get("leader_analysis", {})
        if isinstance(analysis, str):
            analysis = {"missing_details": [analysis]}
        
        missing = analysis.get("missing_details", [])
        history = state.get("messages", [])
        if not isinstance(missing, list):
            missing = [str(missing)]

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

        system_prompt = """
        You are the Questions Agent, a Senior Technical Architect. 
        Your goal is to gather ONLY the truly essential context missing for a production build.
        
        You are the Questions Agent, a Senior Technical Architect. 
        Your goal is to gather ONLY the truly essential context missing for a production build.
        
        STRICT RULES:
        1. **NO REDUNDANCY**: Check the User Prompt and History. If the user said "Node.js" or "Express", NEVER ask "What backend framework will you use?".
        2. **SEMANTIC MATCHING**: If the user gave a broad answer like "All of the above", "Standard", or "Everything", mark all related technical requirements as RESOLVED. 
        3. **DONT BE PEDANTIC**: If you have enough info to make a professional decision (e.g., they want "Real-time sync", you can assume WebSocket or Supabase), DO NOT ASK.
        4. **MOMENTUM**: If you have 80% of the project vision, do not ask more questions. Let the Planner handle the rest.
        5. **NO SILLY QUESTIONS**: Only ask questions that are unique to their business logic, not generic tech stack questions that you can infer.

        Respond ONLY in JSON format:
        {
          "preamble": "A conversational, friendly explanation of why we need this context. (e.g., 'I see you want to build a Twitter clone! To ensure we architect it perfectly, I just need to clarify a few quick details.')",
          "questions": [
            {
              "id": "unique_id",
              "text": "Clear, non-redundant technical question",
              "options": ["Option 1", "Option 2"],
              "category": "frontend|backend|database"
            }
          ]
        }
        """

        messages = [
            SystemMessage(content=system_prompt),
        ]
        if session_context:
            messages.append(SystemMessage(content=session_context))
        
        # Add history for context
        if history:
            for msg in history:
                role = msg.get("role", "USER")
                content = str(msg.get("content", "")) # Guard: Force string
                if role == "USER":
                    messages.append(HumanMessage(content=content))
                else:
                    messages.append(SystemMessage(content=f"Assistant: {content}"))
        
        messages.append(HumanMessage(content=f"Current Task: {prompt}\nRemaining Missing Context to Address: {', '.join(missing)}"))

        print(f"DEBUG: QuestionsAgent requesting chat with model {self.model_id}")
        response_content = await self.chat(messages)
        print(f"DEBUG: QuestionsAgent raw response: {response_content[:200]}...")
        questions_data = self._format_json_response(response_content)
        print(f"DEBUG: QuestionsAgent parsed data: {json.dumps(questions_data)[:200]}...")

        if not isinstance(questions_data, dict) or questions_data.get("error"):
            questions_data = {
                "preamble": "To proceed, I need a couple of quick details:",
                "questions": [
                    {
                        "id": "q1",
                        "text": "What is the primary goal of this project?",
                        "options": ["Lead generation", "Portfolio/brand", "Sales", "Other"],
                        "category": "frontend"
                    }
                ]
            }
        elif not questions_data.get("questions"):
            questions_data["preamble"] = questions_data.get("preamble") or "To proceed, I need a couple of quick details:"
            questions_data["questions"] = [
                {
                    "id": "q1",
                    "text": "What is the primary goal of this project?",
                    "options": ["Lead generation", "Portfolio/brand", "Sales", "Other"],
                    "category": "frontend"
                }
            ]

        state["questions_data"] = questions_data
        state["status"] = "awaiting_user_answers"
        state["next_agent"] = None # Wait for user input
        
        # Increment the round counter
        state["question_rounds"] = state.get("question_rounds", 0) + 1
        
        return state
