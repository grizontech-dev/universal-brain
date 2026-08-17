from typing import Any, Dict, List
import json
import os
from Brain.shared.agent import BaseAgent
from langchain_core.messages import SystemMessage, HumanMessage
from Brain.modules.connectors.supabase.service import SupabaseOAuthService

LOG = "[PLANNER]"

_STOPWORDS = {
    "make", "build", "create", "develop", "design", "app", "application",
    "website", "web", "platform", "please", "want", "need", "would", "like",
    "i", "me", "my", "we", "our", "a", "an", "the", "for", "with", "using",
    "tool", "simple", "basic", "project", "software", "system", "new", "from",
    "that", "this", "should", "can", "will", "have", "has", "one", "also",
    "about", "and", "are", "your", "you", "their", "help", "start", "get",
}

def _topic_fallback(prompt: str, current_plan: dict) -> dict:
    """Deterministic CRUD-based fallback built from the prompt's subject — no LLM call.
    Generic by design: extracts the main subject from the request and derives
    standard CRUD pages, so it scales to any domain without a keyword map."""
    raw = (str(prompt or "") + " " + str(current_plan.get("project_name", ""))).lower()
    name = current_plan.get("project_name") if isinstance(current_plan, dict) else None
    if not name or name in ("New Project", "Project"):
        words = [w for w in raw.split() if len(w) > 3 and w.isalnum() and w not in _STOPWORDS]
        subject = " ".join(words[:3]).title() if words else "App"
        name = f"{subject} App"
    else:
        subject = name

    slug = name.lower().replace(" ", "-")
    pages = [
        (f"{subject} Dashboard", f"/{slug}/dashboard", ["StatsCard", "QuickActions", "OverviewChart"]),
        (f"{subject} List", f"/{slug}/list", ["DataTable", "SearchBar", "FilterBar"]),
        (f"{subject} Manage", f"/{slug}/manage", ["ItemForm", "ItemList"]),
        ("Settings", "/settings", ["ProfileForm", "PreferencesForm"]),
    ]
    arch_pages = [{"name": p[0], "route": p[1], "components": p[2]} for p in pages]
    lines = [
        f"## Overview\nPlan for **{name}** created with default assumptions based on your request.",
        "\n## Architecture\n- **Frontend:** React + Tailwind\n- **Backend:** Node.js + Express\n- **Database:** Company-owned Supabase via Python Backend Proxy\n- **Data Model:** Shared Table + JSONB Data Matrix Pattern",
        "\n## Key Pages & Components\n" + "\n".join(f"- {p[0]} (`{p[1]}`): {', '.join(p[2])}" for p in pages),
        "\n## Implementation Steps\n- Build database schema\n- Build backend API routes for CRUD operations\n- Build frontend pages and wire into App.jsx\n- Runner: install dependencies and start servers",
    ]
    return {
        "project_name": name,
        "markdown_plan": "\n".join(lines),
        "tech_stack": ["React", "Tailwind", "Node", "Express", "Python Proxy", "Supabase"],
        "stack": {"frontend": "React", "backend": "Express", "db": "Supabase", "auth": "JWT", "styling": "Tailwind"},
        "architecture": {"pages": arch_pages, "components": ["Navbar", "Footer"],
                         "tables": [], "api_routes": [], "dependencies": ["react-router-dom"]},
        "status": "proposed",
    }

class PlannerAgent(BaseAgent):
    def __init__(self):
        super().__init__(
            name="Planner",
            description="Creates the technical architecture and project plan.",
            model_id="llama-4-scout-17b-16e-instruct"
        )
        self.supabase_service = SupabaseOAuthService()

    def _resolve_supabase_source(self, state: Dict[str, Any], prompt: str) -> str:
        request_text = f"{prompt} {state.get('content', '')} {json.dumps(state.get('project_plan', {}), default=str)}".lower()
        if "supabase" not in request_text and "database" not in request_text:
            return "not_requested"

        user_id = state.get("user_id")
        if not user_id:
            return "company_fallback"

        try:
            connector = self.supabase_service.get_connection(user_id)
        except Exception:
            connector = None

        if connector and connector.config and connector.isActive:
            config = connector.config or {}
            if config.get("access_token") or config.get("url") or config.get("anon_key"):
                return "user_connector"
        return "company_fallback"

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

        supabase_source = self._resolve_supabase_source(state, prompt)
        if supabase_source != "not_requested":
            memory_context = state.setdefault("memory_context", {})
            decisions = memory_context.setdefault("decisions", {})
            decisions["supabase_source"] = supabase_source
            decisions["supabase_mode"] = "connected-user" if supabase_source == "user_connector" else "company-fallback"
            state.setdefault("active_decisions", {})["supabase_source"] = supabase_source
            state["active_decisions"]["supabase_mode"] = "connected-user" if supabase_source == "user_connector" else "company-fallback"

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

        # SkillMemory — best performing agents (only when genuinely relevant)
        skills_context = ""
        if best_skills:
            skills_lines = [
                f"  {s['name']}: {s['uses']} uses, avg score {s['score']:.0f}"
                for s in best_skills[:3]
                if s.get('uses', 0) > 0
            ]
            if skills_lines:
                skills_context = "[Best Performing Agents]\n" + "\n".join(skills_lines)

        # LongTermMemory — similar past projects (only above similarity threshold)
        similar_context = ""
        if similar_projects:
            similar_lines = [
                f"  {s.get('content', '')[:100]}... (similarity: {s.get('similarity', 0):.2f})"
                for s in similar_projects
                if s.get('similarity', 0) >= 0.5
            ][:3]
            if similar_lines:
                similar_context = "[Similar Past Projects]\n" + "\n".join(similar_lines)

        # Build a clean context summary from history
        context_summary = self._build_context_summary(history, prompt)

        system_prompt = """You are the Strategic Planner Agent for Grizon AI. Your job is to read the user's request carefully and produce a complete, accurate technical plan.

ABSOLUTE RULE: Every page, route, table, and component you plan MUST directly come from something the user asked for. Do NOT add generic pages (Hero, Features, Landing, Contact) unless the user explicitly requested them. Do NOT invent features. Do NOT pad the plan with filler.

═══ OUTPUT FORMAT ═══
Return ONLY valid JSON — no markdown fences, no extra text. Structure:
{
  "project_name": "<descriptive name matching the user's actual project>",
  "markdown_plan": "<Complete Markdown — MUST contain ALL sections below with 3-8 bullets each: ## Overview, ## Architecture, ## Frontend Stack, ## Data Models, ## API Design, ## Key Pages & Components, ## Components to Build, ## Implementation Steps, ## Data Storage. One line per bullet. Cover every feature the user asked for.>",
  "tech_stack": ["React", "Express", "Supabase", "Tailwind CSS"],
  "stack": {"frontend": "React", "backend": "Express", "db": "Supabase", "auth": "JWT", "styling": "Tailwind CSS"},
  "architecture": {
    "pages": [
      {"name": "<PascalCase component name>", "route": "<exact route path>", "components": ["<Component1>", "<Component2>"]}
    ],
    "components": ["<SharedComponent1>", "<SharedComponent2>"],
    "tables": [
      {"name": "<resource_name>", "columns": ["id", "<col1>", "<col2>", "created_at"]}
    ],
    "api_routes": [
      {"path": "/api/<resource>", "method": "GET"},
      {"path": "/api/<resource>/:id", "method": "GET"},
      {"path": "/api/<resource>", "method": "POST"},
      {"path": "/api/<resource>/:id", "method": "PUT"},
      {"path": "/api/<resource>/:id", "method": "DELETE"}
    ],
    "dependencies": ["react-router-dom"]
  },
  "status": "proposed"
}

═══ PLANNING RULES ═══

PAGES — derive from the user's actual app:
- Every distinct screen the user needs = its own page entry
- Auth always needs two pages: Login (/login) and Register (/register) — if auth was mentioned
- Every primary resource needs at minimum: a list page and a detail/form page
- Route params: use /:id for detail pages, /create for create forms
- Each page MUST list its own specific components (2-5), NOT generic ones
- ADMIN CMS (CRITICAL): If the application manages dynamic data (e.g. Ecommerce products, Blog posts, YouTube videos), you MUST automatically include an Admin Dashboard/CMS (e.g. /admin/dashboard, /admin/products) for managing this data, even if the user didn't explicitly ask for it.

TABLES — derive from the user's data model:
- One table per primary resource the user mentioned
- Columns MUST be real domain fields (not just id/created_at)
- Use snake_case for column names
- auth_users schema_name for user authentication rows (no physical users table)

API ROUTES — derive from the user's features:
- Cover the full CRUD surface for each resource (GET list, GET by id, POST, PUT, DELETE)
- Auth routes: /api/auth/login (POST), /api/auth/register (POST) — only if auth was requested
- Resource-specific operations: /api/videos/feed, /api/messages/unread, etc. — only if needed
- Use plural noun paths: /api/videos not /api/video

COMPLETENESS — scale to the user's request:
- Simple request (todo app) → 3-4 pages, 2-3 tables, 8-10 routes
- Medium request (blog, shop) → 5-6 pages, 3-4 tables, 12-16 routes
- Complex request (clone, SaaS) → 6-8 pages, 4-6 tables, 16-24 routes

PLATFORM:
- Always React + Vite SPA. Never mobile, desktop, or native apps.
- All styling: Tailwind CSS. No custom CSS files.
- Backend: Express + Supabase (company-owned, JSONB pattern).

ANTI-HALLUCINATION:
- If the user asked for a todo app, do NOT add a dashboard with analytics
- If the user did not mention payments, do NOT add a payments page
- If the user said "simple", keep it simple — 3-4 pages maximum
- project_name must reflect the user's actual project, not "Web App" or "Platform"
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

        response_content = await self.chat(messages, timeout=90, max_tokens=2000)
        print(f"{LOG} 📄 Planner raw response length: {len(response_content)}", flush=True)
        print(f"{LOG} ─ HEAD: {response_content[:2000]}", flush=True)
        print(f"{LOG} ─ TAIL: {response_content[-1000:]}", flush=True)
        plan = self._format_json_response(response_content)

        # Accept only complete plans — if required fields are missing, treat as
        # failure so the light retry path runs instead of using partial output.
        if isinstance(plan, dict) and not plan.get("error"):
            required = ["project_name", "markdown_plan", "tech_stack", "stack", "architecture", "status"]
            missing = [k for k in required if k not in plan]
            if missing:
                print(f"{LOG} ⚠ Full structured call returned JSON but missing fields: {missing}. Retrying with light prompt...", flush=True)
                plan = {"error": f"missing required fields: {missing}"}

        # If the full structured call failed/timed out, retry once with a lighter
        # prompt (markdown only) so the user ALWAYS gets a real plan instead of
        # the generic fallback.
        if not isinstance(plan, dict) or plan.get("error"):
            fail_reason = plan.get("error") if isinstance(plan, dict) else f"not a dict ({str(plan)[:200]})"
            print(f"{LOG} ⚠ Full structured call failed. Reason: {fail_reason}. Retrying with light prompt...", flush=True)
            light_prompt = """
            You are the Strategic Planner Agent for Grizon AI.

            Create a complete implementation plan based STRICTLY on the user's request and Q&A answers.
            Do NOT invent features the user never mentioned. Small request = small plan.

            Return ONLY valid JSON:
            {
              "project_name": "Name of the actual project",
              "markdown_plan": "COMPLETE Markdown plan with sections: Overview, Architecture, Frontend Stack, Data Models, Key Pages & Components, Components to Build, Implementation Steps. Use ## headers and tight bullet points.",
              "tech_stack": ["React", "Express", "Supabase"],
              "status": "proposed"
            }
            """
            light_messages = [
                SystemMessage(content=light_prompt),
                HumanMessage(content=f"Project Context (including Q&A answers):\n{context_summary}"),
            ]
            if current_plan:
                light_messages.append(SystemMessage(content=f"Current Plan to Update: {json.dumps(current_plan)[:1000]}"))
                if feedback:
                    light_messages.append(HumanMessage(content=f"User Feedback on Plan: {feedback}"))
            print(f"{LOG} Retrying planner with light prompt...", flush=True)
            response_content = await self.chat(light_messages, timeout=45, max_tokens=1000)
            print(f"{LOG} 📄 Planner LIGHT retry raw response length: {len(response_content)}", flush=True)
            print(f"{LOG} ─ HEAD: {response_content[:2000]}", flush=True)
            print(f"{LOG} ─ TAIL: {response_content[-1000:]}", flush=True)
            plan = self._format_json_response(response_content)

        if not isinstance(plan, dict) or plan.get("error"):
            light_reason = plan.get("error") if isinstance(plan, dict) else f"not a dict ({str(plan)[:200]})"
            print(f"{LOG} ⚠ Light retry also failed ({light_reason}). Using topic-based fallback.", flush=True)
            plan = _topic_fallback(prompt, current_plan)

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

        # Ensure project_plan is always stored as dict, never as a JSON string
        if isinstance(plan, str):
            try:
                import json as _j
                plan = _j.loads(plan)
            except Exception:
                plan = {"markdown_plan": plan, "project_name": "Project"}
        state["project_plan"] = plan
        state["project_report"] = report
        state["status"] = "plan_proposed"
        state["next_agent"] = None

        return state
