from typing import Any, Dict, List
import json
import os
from Brain.shared.agent import BaseAgent
from Brain.shared.db_storage_mode import resolve_db_storage_mode
from langchain_core.messages import SystemMessage, HumanMessage
from Brain.modules.connectors.supabase.service import SupabaseOAuthService

LOG = "[PLANNER]"


def _is_frontend_only_request(prompt: str, history: list = None) -> bool:
    """Landing pages and frontend-only prompts should not auto-create backend or database work."""
    text = str(prompt or "").lower()
    if history:
        for msg in history:
            if msg.get("role", "").upper() == "USER":
                text += " " + str(msg.get("content", "")).lower()
                
    strong_frontend_markers = [
        "landing page", "homepage", "hero section", "marketing page", "portfolio page",
        "frontend only", "front-end only", "ui only", "design only", "no backend",
        "no database", "static website", "single page website", "splash page", "promo page",
        "frontend", "front-end", "ui design", "website design",
    ]
    backend_markers = [
        "backend", "api", "database", "supabase", "postgres", "auth", "login system",
        "crud", "rest api", "server", "models", "schema", "db", "signup", "login",
        "user accounts", "payments", "stripe", "data storage", "user authentication",
        "manage users", "fetch data", "store data", "save data", "admin panel",
    ]
    if any(marker in text for marker in backend_markers):
        return False
    weak_frontend_markers = [
        "landing", "webpage", "one page website", "website ui", "responsive website",
        "static page", "blog website", "business website", "website", "page with",
        "portfolio", "landing page", "about section", "features section",
        "testimonial", "pricing section",
    ]
    if any(marker in text for marker in strong_frontend_markers):
        return True
    if any(marker in text for marker in weak_frontend_markers):
        return True
    return False


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
        words = [w for w in raw.split() if len(w) > 3 and w.replace("-", "").isalnum() and w not in _STOPWORDS]
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
        "\n## Architecture\n- **Frontend:** React + Tailwind\n- **Backend:** Node.js + Express\n- **Database:** Supabase PostgreSQL\n- **Data Model:** Relational Tables",
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
        db_intent_markers = (
            "supabase", "database", "db", "postgres", "sql", "schema", "table", "tables",
            "auth", "login", "register", "signup", "signin", "jwt", "api", "crud",
        )
        if not any(marker in request_text for marker in db_intent_markers):
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
        return "\n".join(context_lines[-10:])

    async def execute(self, state: Dict[str, Any]) -> Dict[str, Any]:
        """
        Creates or updates a comprehensive project plan based on user prompt and Q&A answers.
        """
        prompt = state.get("content", "")
        print(f"{LOG} ═══ EXECUTE ═══ prompt='{prompt[:200]}' | has_feedback={bool(state.get('plan_feedback'))}", flush=True)
        history = state.get("messages", [])
        feedback = state.get("plan_feedback", "")
        frontend_only = _is_frontend_only_request(prompt, history)
        current_plan = {} if frontend_only else state.get("project_plan", {})
        if frontend_only:
            state["project_plan"] = {}
            print(f"{LOG} Frontend-only request detected — cleared stale project plan and kept architecture frontend-only", flush=True)

        supabase_source = self._resolve_supabase_source(state, prompt)
        if supabase_source != "not_requested":
            memory_context = state.setdefault("memory_context", {})
            decisions = memory_context.setdefault("decisions", {})
            decisions["supabase_source"] = supabase_source
            decisions["supabase_mode"] = "connected-user" if supabase_source == "user_connector" else "company-fallback"
            state.setdefault("active_decisions", {})["supabase_source"] = supabase_source
            state["active_decisions"]["supabase_mode"] = "connected-user" if supabase_source == "user_connector" else "company-fallback"
        if frontend_only:
            memory_context = state.setdefault("memory_context", {})
            decisions = memory_context.setdefault("decisions", {})
            decisions["frontend_only"] = True
            state.setdefault("active_decisions", {})["frontend_only"] = True

        db_storage_mode = resolve_db_storage_mode(state)
        state.setdefault("active_decisions", {})["db_storage_mode"] = db_storage_mode
        print(
            f"{LOG} DB mode selected: {db_storage_mode} "
            f"| supabase_source={supabase_source} "
            f"| supabase_mode={state.get('active_decisions', {}).get('supabase_mode', 'n/a')}",
            flush=True,
        )

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
            skills_lines = [
                f"  {s['name']}: {s['uses']} uses, avg score {s['score']:.0f}"
                for s in best_skills[:3]
                if s.get('uses', 0) > 0
            ]
            if skills_lines:
                skills_context = "[Best Performing Agents]\n" + "\n".join(skills_lines)

        # LongTermMemory — similar past projects
        similar_context = ""
        if similar_projects:
            similar_lines = [
                f"  {s.get('content', '')[:100]}... (similarity: {s.get('similarity', 0):.2f})"
                for s in similar_projects
                if s.get('similarity', 0) >= 0.5
            ][:3]
            if similar_lines:
                similar_context = "[Similar Past Projects]\n" + "\n".join(similar_lines)

        # Build clean context summary
        context_summary = self._build_context_summary(history, prompt)

        db_rule = (
            "- Database: Physical relational PostgreSQL tables in public schema (e.g., CREATE TABLE public.<resource>)."
            if db_storage_mode == "physical"
            else "- Database: Company-owned Supabase using shared JSONB data matrix pattern."
        )

        if frontend_only:
            markdown_structure = "## Overview, ## Architecture, ## Frontend Stack, ## Key Pages & Components, ## Components to Build, ## Implementation Steps"
            json_stack = '{"frontend": "React", "styling": "Tailwind CSS"}'
            architecture_tables = '"tables": [],'
            architecture_api = '"api_routes": [],'
            db_rule_text = "- No database required for this frontend-only scope."
            frontend_rule = "CRITICAL RULE: The user specifically requested a frontend-only/UI-only build. DO NOT include any backend, database, models, or API layers in your plan. Treat this as a pure frontend React app."
        else:
            markdown_structure = "## Overview, ## Architecture, ## Frontend Stack, ## Data Models, ## API Design, ## Key Pages & Components, ## Components to Build, ## Implementation Steps, ## Data Storage"
            json_stack = '{"frontend": "React", "backend": "Express", "db": "Supabase", "auth": "JWT", "styling": "Tailwind CSS"}'
            architecture_tables = '"tables": [{"name": "<resource_name>", "columns": ["id", "<col1>", "created_at"]}],'
            architecture_api = '"api_routes": [{"path": "/api/<resource>", "method": "GET"}],'
            db_rule_text = db_rule
            frontend_rule = ""

        system_prompt = f"""You are the Strategic Planner Agent for Grizon AI. Your job is to read the user's request carefully and produce a complete, accurate technical plan.

ABSOLUTE RULE: Every page, route, table, and component you plan MUST directly come from something the user asked for. Do NOT add generic pages (Hero, Features, Landing, Contact) unless the user explicitly requested them. Do NOT invent features. Do NOT pad the plan with filler.
{frontend_rule}

═══ OUTPUT FORMAT ═══
Return ONLY valid JSON — no markdown fences, no extra text. Structure:
{{
  "project_name": "<descriptive name matching the user's actual project>",
  "markdown_plan": "<Complete Markdown — MUST contain ALL sections below with 3-8 bullets each: {markdown_structure}. One line per bullet. Cover every feature the user asked for.>",
  "tech_stack": ["React", "Tailwind CSS"],
  "stack": {json_stack},
  "architecture": {{
    "pages": [
      {{"name": "<PascalCase component name>", "route": "<exact route path>", "components": ["<Component1>", "<Component2>"]}}
    ],
    "components": ["<SharedComponent1>", "<SharedComponent2>"],
    {architecture_tables}
    {architecture_api}
    "dependencies": ["react-router-dom"]
  }},
  "status": "proposed"
}}

═══ PLANNING RULES ═══

PAGES — derive from the user's actual app:
- Every distinct screen the user needs = its own page entry
- Auth always needs two pages: Login (/login) and Register (/register) — if auth was mentioned
- Every primary resource needs at minimum: a list page and a detail/form page
- Route params: use /:id for detail pages, /create for create forms
- Each page MUST list its own specific components (2-5), NOT generic ones
- ADMIN CMS & LOGIN (CRITICAL): If the application manages dynamic data (e.g. Ecommerce products, Blog posts, YouTube videos), you MUST automatically include an Admin Panel. The entry route must be `/admin` (a secure login gate). Successful login must redirect to `/admin/dashboard` (the admin panel). Use default credentials: Email: `admin@grizonai.com`, Password: `admin123` (DatabaseAgent must seed this user, and FrontendAgent must build the login screen matching this logic).

{f'''
TABLES — derive from the user's data model:
- One table per primary resource the user mentioned
- Columns MUST be real domain fields (not just id/created_at)
- Use snake_case for column names
- auth_users table or resource for user authentication rows

API ROUTES — derive from the user's features:
- Cover the full CRUD surface for each resource (GET list, GET by id, POST, PUT, DELETE)
- Auth routes: /api/auth/login (POST), /api/auth/register (POST) — only if auth was requested
- Resource-specific operations: /api/videos/feed, /api/messages/unread, etc. — only if needed
- Use plural noun paths: /api/videos not /api/video''' if not frontend_only else '- NO TABLES OR API ROUTES REQUIRED for frontend-only scope.'}

COMPLETENESS — scale to the user's request:
- Simple request (todo app) → 3-4 pages, 2-3 tables, 8-10 routes
- Medium request (blog, shop) → 5-6 pages, 3-4 tables, 12-16 routes
- Complex request (clone, SaaS) → 6-8 pages, 4-6 tables, 16-24 routes

PLATFORM:
- Always React + Vite SPA. Never mobile, desktop, or native apps.
- All styling: Tailwind CSS. No custom CSS files.
{db_rule}

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

        messages.append(HumanMessage(content=f"Project Context (including Q&A answers):\n{context_summary}"))

        if current_plan and not frontend_only:
            messages.append(SystemMessage(content=f"Current Plan to Update: {json.dumps(current_plan)[:1000]}"))
            if feedback:
                messages.append(HumanMessage(content=f"User Feedback on Plan: {feedback}"))

        response_content = await self.chat(messages, timeout=90, max_tokens=2000)
        print(f"{LOG} 📄 Planner raw response length: {len(response_content)}", flush=True)
        print(f"{LOG} ─ HEAD: {response_content[:2000]}", flush=True)
        print(f"{LOG} ─ TAIL: {response_content[-1000:]}", flush=True)
        plan = self._format_json_response(response_content)

        if isinstance(plan, dict) and not plan.get("error"):
            required = ["project_name", "markdown_plan", "tech_stack", "stack", "architecture", "status"]
            missing = [k for k in required if k not in plan]
            if missing:
                print(f"{LOG} ⚠ Full structured call returned JSON but missing fields: {missing}. Retrying with light prompt...", flush=True)
                plan = {"error": f"missing required fields: {missing}"}

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

        if frontend_only and isinstance(plan, dict):
            plan["architecture"] = {
                "pages": [{"name": "Landing Page", "route": "/", "components": ["HeroSection", "FeatureGrid", "Testimonials", "CTASection"]}],
                "components": ["NavBar", "HeroSection", "FeatureGrid", "Testimonials", "CTASection", "Footer"],
                "tables": [],
                "api_routes": [],
                "dependencies": ["react-router-dom"],
            }
            plan["tech_stack"] = ["React", "Tailwind CSS"]
            plan["stack"] = {"frontend": "React", "backend": "None", "db": "None", "auth": "None", "styling": "Tailwind CSS"}
            plan["status"] = "proposed"

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

        if not plan.get("markdown_plan"):
            plan["markdown_plan"] = "## Overview\nPlan created successfully.\n\n## Details\n" + str(plan.get("summary_points", "No detailed plan available."))

        report = f"## {plan.get('project_name', 'New Project')} - Implementation Plan\n{plan.get('summary', '')}"

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