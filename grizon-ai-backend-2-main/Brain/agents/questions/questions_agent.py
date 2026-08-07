from typing import Any, Dict, List
import re
from Brain.shared.agent import BaseAgent
from langchain_core.messages import SystemMessage, HumanMessage

LOG = "[QUESTIONS]"

PREAMBLES = [
    "I just need one quick clarification before I create the perfect plan.",
    "A couple of quick questions before I generate the architecture.",
    "A few important details are still missing - let's wrap these up.",
]

MAX_QUESTIONS = 5
MAX_RECENT_USER_MESSAGES = 5

# Color palettes like Lovable.dev - user picks one, frontend uses those exact colors
COLOR_PALETTES = [
    # DARK THEMES
    {
        "id": "midnight-blue",
        "name": "Midnight Blue",
        "theme": "dark",
        "colors": ["#0f172a", "#3b82f6", "#60a5fa", "#f8fafc", "#1e293b"],
        "description": "Deep navy + electric blue + clean white"
    },
    {
        "id": "dark-coral",
        "name": "Dark Coral",
        "theme": "dark",
        "colors": ["#1a1a2e", "#e94560", "#ff6b6b", "#feca57", "#16213e"],
        "description": "Dark base + coral red + warm yellow"
    },
    # LIGHT THEME
    {
        "id": "clean-light",
        "name": "Clean Light",
        "theme": "light",
        "colors": ["#ffffff", "#6366f1", "#818cf8", "#1e293b", "#f1f5f9"],
        "description": "White base + indigo accent + soft gray"
    },
]

COLOR_PALETTE_QUESTION = {
    "id": "q_color_palette",
    "text": "What color direction appeals to you?",
    "type": "single",
    "options": [f"{p['name']} - {p['description']}" for p in COLOR_PALETTES],
    "allowAll": False,
    "category": "design",
    "palettes": COLOR_PALETTES,
    "allowCustom": True,
    "customPlaceholder": "Write your own color scheme... (e.g., 'neon green and black' or 'pastel pink and white')"
}


class QuestionsAgent(BaseAgent):
    def __init__(self):
        super().__init__(
            name="Questions",
            description="Asks follow-up questions to gather missing context.",
            model_id="deepseek-v4-flash"
        )

    def _filter_missing(self, missing: List[str], approved_keys: List[str]) -> List[str]:
        """Pre-filter missing details against already-approved decisions (Python, no LLM).

        Only suppresses a missing detail when an approved decision covers the SAME
        decision dimension (word-boundary token match), e.g. a decision key
        "auth" -> "JWT" does NOT suppress "Which authentication features...".
        """
        if not isinstance(missing, list):
            missing = [str(missing)]
        missing = [str(m).strip() for m in missing if str(m).strip()]
        if approved_keys:
            tokens = set()
            for k in approved_keys:
                for tok in re.split(r"[._\- ]+", k.lower()):
                    if len(tok) >= 4:
                        tokens.add(tok)
            if tokens:
                missing = [
                    m for m in missing
                    if not any(re.search(rf"\b{re.escape(tok)}\b", m.lower()) for tok in tokens)
                ]
        return missing[:MAX_QUESTIONS]

    async def execute(self, state: Dict[str, Any]) -> Dict[str, Any]:
        prompt = state.get("content", "")
        analysis = state.get("leader_analysis", {})
        if isinstance(analysis, str):
            analysis = {"missing_details": [analysis]}

        memory_context = state.get("memory_context", {})
        active_decisions = memory_context.get("decisions", {})
        approved_keys = [str(k) for k in (active_decisions or {}).keys()]

        missing = self._filter_missing(analysis.get("missing_details", []), approved_keys)
        print(f"{LOG} ═══ EXECUTE ═══ prompt='{prompt[:150]}' | missing_count={len(missing)}", flush=True)

        # If nothing meaningful remains, skip questions entirely -> planner.
        if not missing:
            print(f"{LOG} No missing details remain after filtering - routing to planner", flush=True)
            state["leader_analysis"] = {"analysis": "Context is sufficient - proceeding to planning."}
            state["next_agent"] = "planner"
            state["status"] = "ready_to_plan"
            state["questions_data"] = None
            return state

        # Compact context: only recent USER messages, truncated. Assistant outputs are irrelevant here.
        history = state.get("messages", [])
        user_msgs = [
            str(m.get("content", "")).strip()
            for m in history
            if m.get("role", "USER") == "USER" and str(m.get("content", "")).strip()
        ][-MAX_RECENT_USER_MESSAGES:]
        user_msgs = [m[:300] + ("..." if len(m) > 300 else "") for m in user_msgs]
        context_summary = "Recent user messages:\n" + "\n".join(f"- {m}" for m in user_msgs) if user_msgs else f"User request: {prompt[:300]}"

        system_prompt = """
You are the Questions Agent. Phrase the missing details below as clear, concise questions.

RULES:
1. Do NOT ask about anything the user already provided or decided.
2. Max 5 questions, one per missing detail.
3. Each question needs 2-5 concrete options. If more than one option can be selected, set "type": "multi", otherwise "single".
4. No preamble, no fluff - only the questions.

Return ONLY JSON:
{"questions": [{"id": "q1", "text": "Question text", "type": "single", "options": ["A", "B", "C"]}]}
"""

        messages = [
            SystemMessage(content=system_prompt),
            HumanMessage(content=f"Missing details to clarify:\n- " + "\n- ".join(missing) + f"\n\n{context_summary}"),
        ]

        print(f"DEBUG: QuestionsAgent requesting chat with model {self.model_id} | msgs={len(messages)}")
        import time as _t
        _t0 = _t.time()
        response_content = await self.chat(messages, model_id="deepseek-v4-flash", timeout=30, max_tokens=350)
        print(f"DEBUG: QuestionsAgent LLM call took {_t.time()-_t0:.1f}s", flush=True)
        print(f"DEBUG: QuestionsAgent raw response: {response_content[:200]}...")
        questions_data = self._format_json_response(response_content)

        questions = questions_data.get("questions") if isinstance(questions_data, dict) else None
        normalized: List[Dict[str, Any]] = []
        if isinstance(questions, list):
            for i, q in enumerate(questions):
                if not isinstance(q, dict):
                    continue
                text = str(q.get("text", "")).strip()
                if not text:
                    continue
                opts = q.get("options")
                if not isinstance(opts, list):
                    opts = []
                opts = [str(o).strip() for o in opts if str(o).strip()][:6]
                q_type = str(q.get("type", "single")).lower()
                if q_type not in ("single", "multi"):
                    q_type = "single"
                normalized.append({
                    "id": str(q.get("id", f"q{i+1}")),
                    "text": text,
                    "options": opts or ["Yes", "No"],
                    "type": q_type,
                    "allowAll": q_type == "multi",
                    "category": "general",
                })

        # Fallback grounded in the actual missing details (never generic/unrelated).
        if not normalized:
            print(f"{LOG} LLM produced no usable questions - building fallback from missing details", flush=True)
            normalized = [
                {
                    "id": f"q{i+1}",
                    "text": f"Please clarify: {detail}",
                    "options": ["Standard/default", "Custom", "Not needed"],
                    "type": "single",
                    "allowAll": False,
                    "category": "general",
                }
                for i, detail in enumerate(missing[:MAX_QUESTIONS])
            ]

        normalized = normalized[:MAX_QUESTIONS]

        # ALWAYS append color palette question (like Lovable)
        normalized.append(COLOR_PALETTE_QUESTION)

        round_num = state.get("question_rounds", 0)
        state["questions_data"] = {
            "preamble": PREAMBLES[min(round_num, len(PREAMBLES) - 1)],
            "questions": normalized,
        }
        state["status"] = "awaiting_user_answers"
        state["next_agent"] = None  # Wait for user input

        # Increment the round counter
        state["question_rounds"] = round_num + 1

        return state
