from typing import Any, Dict, List
import json
import os

from Brain.shared.agent import BaseAgent
from Brain.shared.db_storage_mode import resolve_db_storage_mode
from langchain_core.messages import SystemMessage, HumanMessage
from Brain.modules.connectors.supabase.service import SupabaseOAuthService


LOG = "[PLANNER]"


def _is_frontend_only_request(prompt: str, history: list = None) -> bool:
    """
    Determine whether the user wants a frontend/UI-only project.

    Frontend features such as login, signup, logout, dashboard,
    profile, settings, and admin panel do NOT imply backend work.

    Backend is required only when the user explicitly asks for backend,
    APIs, database, persistence, real authentication, OAuth, JWT, etc.
    """

    text = str(prompt or "").lower()

    if history:
        user_msgs = [
            str(msg.get("content", "")).lower()
            for msg in history
            if msg.get("role", "").upper() == "USER"
        ]

        if user_msgs:
            text = " ".join(user_msgs) + " " + text

    # ---------------------------------------------------------
    # EXPLICIT FRONTEND INTENT
    # ---------------------------------------------------------

    frontend_markers = [
        "frontend",
        "front-end",
        "frontend only",
        "front-end only",
        "frontend-only",
        "front-end-only",
        "ui only",
        "ui-only",
        "ui",
        "website",
        "web page",
        "webpage",
        "landing page",
        "website design",
        "website ui",
        "website frontend",
        "build the frontend",
        "create the frontend",
        "build frontend",
        "create frontend",
        "frontend for",
        "frontend website",
        "react website",
        "react frontend",
        "vite frontend",
        "build ui",
        "create ui",
        "build the ui",
        "create the ui",
    ]

    # ---------------------------------------------------------
    # EXPLICIT BACKEND INTENT
    # ---------------------------------------------------------

    backend_markers = [
        "backend",
        "back-end",
        "server",
        "api server",
        "rest api",
        "graphql",
        "database",
        "postgres",
        "postgresql",
        "mysql",
        "mongodb",
        "supabase database",
        "connect to supabase",
        "store data",
        "persist data",
        "persistent data",
        "database schema",
        "database tables",
        "migrations",
        "migration",
        "jwt authentication",
        "jwt auth",
        "oauth integration",
        "oauth authentication",
        "real authentication",
        "implement authentication",
        "authentication backend",
        "backend authentication",
        "real login",
        "real signup",
        "real sign in",
        "real signin",
        "api integration",
        "backend api",
        "create api",
        "build api",
        "api endpoint",
        "api endpoints",
        "crud api",
    ]

    has_frontend_intent = any(
        marker in text for marker in frontend_markers
    )

    has_explicit_backend_intent = any(
        marker in text for marker in backend_markers
    )

    # ---------------------------------------------------------
    # IMPORTANT:
    # Explicit backend request always wins.
    #
    # Example:
    # "Create a React frontend with FastAPI backend"
    # -> False
    #
    # "Create frontend with Supabase database"
    # -> False
    # ---------------------------------------------------------

    if has_explicit_backend_intent:
        return False

    if has_frontend_intent:
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


def _topic_fallback(
    prompt: str,
    current_plan: dict,
    frontend_only: bool = False,
) -> dict:
    """
    Deterministic fallback.

    For frontend-only requests, this fallback MUST NEVER introduce
    backend, database, Supabase, JWT, API, or server architecture.

    For full-stack requests, preserve the existing generic CRUD fallback.
    """

    current_plan = current_plan if isinstance(current_plan, dict) else {}

    raw = (
        str(prompt or "")
        + " "
        + str(current_plan.get("project_name", ""))
    ).lower()

    name = current_plan.get("project_name")

    if not name or name in ("New Project", "Project"):
        words = [
            w
            for w in raw.split()
            if len(w) > 3
            and w.replace("-", "").isalnum()
            and w not in _STOPWORDS
        ]

        subject = (
            " ".join(words[:3]).title()
            if words
            else "App"
        )

        name = f"{subject} App"
    else:
        subject = name

    # =========================================================
    # FRONTEND-ONLY FALLBACK
    # =========================================================

    if frontend_only:
        return {
            "project_name": name,
            "markdown_plan": (
                f"## Overview\n"
                f"- Frontend-only implementation for **{name}**.\n"
                f"- Build only the UI and client-side interactions requested by the user.\n"
                f"- Preserve all explicitly requested pages and features.\n\n"

                f"## Architecture\n"
                f"- React + Vite single-page application.\n"
                f"- Tailwind CSS for styling.\n"
                f"- React Router for requested routes.\n"
                f"- Mock/local state for frontend interactions.\n"
                f"- No backend, database, or API.\n\n"

                f"## Frontend Stack\n"
                f"- React\n"
                f"- Vite\n"
                f"- Tailwind CSS\n"
                f"- React Router\n\n"

                f"## Key Pages & Components\n"
                f"- Build every page explicitly requested by the user.\n"
                f"- Build components required by those pages.\n"
                f"- Preserve requested login, signup, dashboard, profile, settings, "
                f"admin, or landing-page UI when requested.\n\n"

                f"## Components to Build\n"
                f"- Shared navigation and layout components as required.\n"
                f"- Page-specific components based on the requested UI.\n\n"

                f"## Implementation Steps\n"
                f"- Create the React + Vite frontend.\n"
                f"- Configure Tailwind CSS.\n"
                f"- Create all requested pages and routes.\n"
                f"- Use mock/local state for UI interactions.\n"
                f"- Start the frontend preview in the sandbox.\n"
            ),
            "tech_stack": [
                "React",
                "Vite",
                "Tailwind CSS",
                "React Router",
            ],
            "stack": {
                "frontend": "React",
                "backend": "None",
                "db": "None",
                "auth": "Mock/UI only",
                "styling": "Tailwind CSS",
            },
            "architecture": {
                "pages": [],
                "components": [],
                "tables": [],
                "api_routes": [],
                "dependencies": [
                    "react-router-dom"
                ],
            },
            "status": "proposed",
        }

    # =========================================================
    # EXISTING FULL-STACK FALLBACK
    # =========================================================

    slug = name.lower().replace(" ", "-")

    pages = [
        (
            f"{subject} Dashboard",
            f"/{slug}/dashboard",
            [
                "StatsCard",
                "QuickActions",
                "OverviewChart",
            ],
        ),
        (
            f"{subject} List",
            f"/{slug}/list",
            [
                "DataTable",
                "SearchBar",
                "FilterBar",
            ],
        ),
        (
            f"{subject} Manage",
            f"/{slug}/manage",
            [
                "ItemForm",
                "ItemList",
            ],
        ),
        (
            "Settings",
            "/settings",
            [
                "ProfileForm",
                "PreferencesForm",
            ],
        ),
    ]

    arch_pages = [
        {
            "name": p[0],
            "route": p[1],
            "components": p[2],
        }
        for p in pages
    ]

    lines = [
        (
            f"## Overview\n"
            f"Plan for **{name}** created with default assumptions "
            f"based on your request."
        ),
        (
            "\n## Architecture\n"
            "- **Frontend:** React + Tailwind\n"
            "- **Backend:** Node.js + Express\n"
            "- **Database:** Supabase PostgreSQL\n"
            "- **Data Model:** Relational Tables"
        ),
        (
            "\n## Key Pages & Components\n"
            + "\n".join(
                f"- {p[0]} (`{p[1]}`): {', '.join(p[2])}"
                for p in pages
            )
        ),
        (
            "\n## Implementation Steps\n"
            "- Build database schema\n"
            "- Build backend API routes for CRUD operations\n"
            "- Build frontend pages and wire into App.jsx\n"
            "- Runner: install dependencies and start servers"
        ),
    ]

    return {
        "project_name": name,
        "markdown_plan": "\n".join(lines),
        "tech_stack": [
            "React",
            "Tailwind",
            "Node",
            "Express",
            "Python Proxy",
            "Supabase",
        ],
        "stack": {
            "frontend": "React",
            "backend": "Express",
            "db": "Supabase",
            "auth": "JWT",
            "styling": "Tailwind",
        },
        "architecture": {
            "pages": arch_pages,
            "components": [
                "Navbar",
                "Footer",
            ],
            "tables": [],
            "api_routes": [],
            "dependencies": [
                "react-router-dom"
            ],
        },
        "status": "proposed",
    }


class PlannerAgent(BaseAgent):

    def __init__(self):
        super().__init__(
            name="Planner",
            description="Creates the technical architecture and project plan.",
            model_id="llama-4-scout-17b-16e-instruct",
        )

        self.supabase_service = SupabaseOAuthService()

    # =========================================================
    # SUPABASE SOURCE
    # =========================================================

    def _resolve_supabase_source(
        self,
        state: Dict[str, Any],
        prompt: str,
    ) -> str:

        request_text = (
            f"{prompt} "
            f"{state.get('content', '')} "
            f"{json.dumps(state.get('project_plan', {}), default=str)}"
        ).lower()

        db_intent_markers = (
            "supabase",
            "database",
            "db",
            "postgres",
            "postgresql",
            "sql",
            "schema",
            "table",
            "tables",
            "jwt",
            "api",
            "crud",
            "persist",
            "store data",
        )

        if not any(
            marker in request_text
            for marker in db_intent_markers
        ):
            return "not_requested"

        user_id = state.get("user_id")

        if not user_id:
            return "company_fallback"

        try:
            connector = self.supabase_service.get_connection(user_id)
        except Exception:
            connector = None

        if (
            connector
            and connector.config
            and connector.isActive
        ):
            config = connector.config or {}

            if (
                config.get("access_token")
                or config.get("url")
                or config.get("anon_key")
            ):
                return "user_connector"

        return "company_fallback"

    # =========================================================
    # CONTEXT
    # =========================================================

    def _build_context_summary(
        self,
        history: List[dict],
        prompt: str,
    ) -> str:
        """
        Extract a clean summary of what the user wants
        from conversation history.
        """

        context_lines = []

        for msg in history:

            role = msg.get(
                "role",
                "USER",
            ).upper()

            content = str(
                msg.get(
                    "content",
                    "",
                )
            )

            if content.startswith(
                "__CLARIFY__:"
            ):
                continue

            if role == "USER" and content.strip():

                context_lines.append(
                    f"User: {content.strip()}"
                )

            elif (
                role == "ASSISTANT"
                and content.strip()
                and not content.startswith("{")
            ):

                context_lines.append(
                    f"Context: {content.strip()[:200]}"
                )

        context_lines.append(
            f"Final Request: {prompt}"
        )

        return "\n".join(
            context_lines[-10:]
        )

    # =========================================================
    # EXECUTE
    # =========================================================

    async def execute(
        self,
        state: Dict[str, Any],
    ) -> Dict[str, Any]:

        prompt = state.get(
            "content",
            "",
        )

        print(
            f"{LOG} ═══ EXECUTE ═══ "
            f"prompt='{prompt[:200]}' "
            f"| has_feedback="
            f"{bool(state.get('plan_feedback'))}",
            flush=True,
        )

        history = state.get(
            "messages",
            []
        )

        feedback = state.get(
            "plan_feedback",
            ""
        )

        # =====================================================
        # DETECT FRONTEND-ONLY
        # =====================================================

        frontend_only = _is_frontend_only_request(
            prompt,
            history,
        )

        # Never reuse an old full-stack plan for frontend-only.
        current_plan = (
            {}
            if frontend_only
            else state.get(
                "project_plan",
                {}
            )
        )

        if frontend_only:

            state["project_plan"] = {}

            print(
                f"{LOG} Frontend-only request detected — "
                f"cleared stale project plan and kept "
                f"architecture frontend-only",
                flush=True,
            )

        # =====================================================
        # SUPABASE
        # =====================================================

        # CRITICAL:
        # A frontend-only request must NEVER resolve Supabase.
        #
        # This prevents:
        #
        # Login
        # Signup
        # Admin
        # Profile
        #
        # from accidentally causing a Supabase connector lookup.

        supabase_source = (
            "not_requested"
            if frontend_only
            else self._resolve_supabase_source(
                state,
                prompt,
            )
        )

        if supabase_source != "not_requested":

            memory_context = state.setdefault(
                "memory_context",
                {}
            )

            decisions = memory_context.setdefault(
                "decisions",
                {}
            )

            decisions[
                "supabase_source"
            ] = supabase_source

            decisions[
                "supabase_mode"
            ] = (
                "connected-user"
                if supabase_source == "user_connector"
                else "company-fallback"
            )

            state.setdefault(
                "active_decisions",
                {}
            )[
                "supabase_source"
            ] = supabase_source

            state[
                "active_decisions"
            ][
                "supabase_mode"
            ] = (
                "connected-user"
                if supabase_source == "user_connector"
                else "company-fallback"
            )

        # =====================================================
        # FRONTEND DECISION
        # =====================================================

        if frontend_only:

            memory_context = state.setdefault(
                "memory_context",
                {}
            )

            decisions = memory_context.setdefault(
                "decisions",
                {}
            )

            decisions[
                "frontend_only"
            ] = True

            state.setdefault(
                "active_decisions",
                {}
            )[
                "frontend_only"
            ] = True

        # =====================================================
        # DATABASE STORAGE MODE
        # =====================================================

        db_storage_mode = resolve_db_storage_mode(
            state
        )

        state.setdefault(
            "active_decisions",
            {}
        )[
            "db_storage_mode"
        ] = db_storage_mode

        print(
            f"{LOG} DB mode selected: "
            f"{db_storage_mode} "
            f"| supabase_source="
            f"{supabase_source} "
            f"| supabase_mode="
            f"{state.get('active_decisions', {}).get('supabase_mode', 'n/a')}",
            flush=True,
        )

        # =====================================================
        # MEMORY
        # =====================================================

        memory_context = state.get(
            "memory_context",
            {}
        )

        session_state = memory_context.get(
            "session_state",
            {}
        )

        active_decisions = memory_context.get(
            "decisions",
            {}
        )

        architecture_patterns = memory_context.get(
            "architecture_patterns",
            []
        )

        best_skills = memory_context.get(
            "best_skills",
            []
        )

        similar_projects = memory_context.get(
            "similar_projects",
            []
        )

        wf_state = session_state.get(
            "workflow_state",
            ""
        )

        cur_agent = session_state.get(
            "current_agent",
            ""
        )

        task_idx = session_state.get(
            "task_index",
            ""
        )

        total_tk = session_state.get(
            "total_tasks",
            ""
        )

        session_summary_parts = []

        if wf_state:
            session_summary_parts.append(
                f"Phase: {wf_state}"
            )

        if cur_agent:
            session_summary_parts.append(
                f"Active Agent: {cur_agent}"
            )

        if task_idx or total_tk:
            session_summary_parts.append(
                f"Task: {task_idx}/{total_tk}"
            )

        session_context = (
            f"[Session] "
            f"{' | '.join(session_summary_parts)}"
            if session_summary_parts
            else ""
        )

        # =====================================================
        # DECISIONS CONTEXT
        # =====================================================

        decisions_context = ""

        if active_decisions:

            decisions_lines = [
                f"  {k}: {v}"
                for k, v in active_decisions.items()
            ]

            decisions_context = (
                "[Approved Decisions - MUST FOLLOW]\n"
                + "\n".join(decisions_lines)
            )

        # =====================================================
        # ARCHITECTURE MEMORY
        # =====================================================

        arch_context = ""

        if architecture_patterns:

            arch_lines = [
                (
                    f"  {p['pattern']}: "
                    f"used {p['uses']}x, "
                    f"{p['success_rate'] * 100:.0f}% success"
                )
                for p in architecture_patterns
            ]

            arch_context = (
                "[Proven Architecture Patterns]\n"
                + "\n".join(arch_lines)
            )

        # =====================================================
        # SKILL MEMORY
        # =====================================================

        skills_context = ""

        if best_skills:

            skills_lines = [
                (
                    f"  {s['name']}: "
                    f"{s['uses']} uses, "
                    f"avg score {s['score']:.0f}"
                )
                for s in best_skills[:3]
                if s.get("uses", 0) > 0
            ]

            if skills_lines:

                skills_context = (
                    "[Best Performing Agents]\n"
                    + "\n".join(skills_lines)
                )

        # =====================================================
        # SIMILAR PROJECTS
        # =====================================================

        similar_context = ""

        if similar_projects:

            similar_lines = [
                (
                    f"  {s.get('content', '')[:100]}..."
                    f" (similarity: "
                    f"{s.get('similarity', 0):.2f})"
                )
                for s in similar_projects
                if s.get(
                    "similarity",
                    0
                ) >= 0.5
            ][:3]

            if similar_lines:

                similar_context = (
                    "[Similar Past Projects]\n"
                    + "\n".join(similar_lines)
                )

        # =====================================================
        # CONTEXT SUMMARY
        # =====================================================

        context_summary = self._build_context_summary(
            history,
            prompt,
        )

        # =====================================================
        # DB RULE
        # =====================================================

        db_rule = (
            "- Database: Physical relational PostgreSQL "
            "tables in public schema "
            "(e.g., CREATE TABLE public.<resource>)."
            if db_storage_mode == "physical"
            else
            "- Database: Company-owned Supabase using "
            "shared JSONB data matrix pattern."
        )

        # =====================================================
        # FRONTEND / FULL-STACK CONFIGURATION
        # =====================================================

        if frontend_only:

            markdown_structure = (
                "## Overview, "
                "## Architecture, "
                "## Frontend Stack, "
                "## Key Pages & Components, "
                "## Components to Build, "
                "## Implementation Steps"
            )

            json_stack = (
                '{"frontend": "React", '
                '"backend": "None", '
                '"db": "None", '
                '"auth": "Mock/UI only", '
                '"styling": "Tailwind CSS"}'
            )

            architecture_tables = (
                '"tables": [],'
            )

            architecture_api = (
                '"api_routes": [],'
            )

            # IMPORTANT:
            # Use this instead of db_rule in the frontend prompt.
            db_rule_text = (
                "- Database: None. "
                "This is a frontend-only scope."
            )

            frontend_rule = """
CRITICAL FRONTEND-ONLY RULE:

The user requested a frontend/UI-only project.

You MUST:

- Build ONLY the frontend/UI.
- Preserve EVERY page and feature explicitly requested by the user.
- Treat login, signup/register, signin, logout, dashboard, profile,
  settings, and admin panel as frontend UI features.
- Authentication must be mock/UI authentication unless the user
  explicitly requests real authentication.
- Use mock data, client-side state, or localStorage when interaction
  or persistence is needed for the frontend preview.
- Use React + Vite + Tailwind CSS.
- Use React Router for multiple requested pages.
- Keep the project runnable entirely from the frontend.

You MUST NOT plan or create:

- backend
- server
- API routes
- REST API
- GraphQL
- database
- Supabase
- PostgreSQL
- SQL
- database tables
- migrations
- OAuth
- JWT
- real authentication
- backend models
- backend services
- Docker backend services
- backend infrastructure

IMPORTANT:

- Do NOT replace requested pages with a generic landing page.
- Do NOT remove requested pages.
- Do NOT invent backend requirements.
- Do NOT interpret "login", "signup", "logout", or "admin panel"
  as requiring a backend.
- Mock the interactions in the frontend when necessary.

architecture.tables MUST be [].

architecture.api_routes MUST be [].

stack.backend MUST be "None".

stack.db MUST be "None".

stack.auth MUST be "Mock/UI only".
"""

        else:

            markdown_structure = (
                "## Overview, "
                "## Architecture, "
                "## Frontend Stack, "
                "## Data Models, "
                "## API Design, "
                "## Key Pages & Components, "
                "## Components to Build, "
                "## Implementation Steps, "
                "## Data Storage"
            )

            json_stack = (
                '{"frontend": "React", '
                '"backend": "Express", '
                '"db": "Supabase", '
                '"auth": "JWT", '
                '"styling": "Tailwind CSS"}'
            )

            architecture_tables = (
                '"tables": ['
                '{"name": "<resource_name>", '
                '"columns": ["id", "<col1>", "created_at"]}'
                '],'
            )

            architecture_api = (
                '"api_routes": ['
                '{"path": "/api/<resource>", '
                '"method": "GET"}'
                '],'
            )

            db_rule_text = db_rule

            frontend_rule = ""

        # =====================================================
        # SYSTEM PROMPT
        # =====================================================

        system_prompt = f"""
You are the Strategic Planner Agent for Grizon AI.

Your job is to read the user's request carefully and produce
a complete, accurate technical plan.

ABSOLUTE RULE:

Every page, route, table, and component you plan MUST directly
come from something the user asked for.

Do NOT add generic pages such as Hero, Features, Landing,
Contact, Analytics, etc. unless the user explicitly requested them.

Do NOT invent features.

Do NOT pad the plan with filler.

{frontend_rule}

═══ OUTPUT FORMAT ═══

Return ONLY valid JSON.

No markdown fences.

No extra text.

Structure:

{{
  "project_name": "<descriptive name matching the user's actual project>",

  "markdown_plan":
    "<Complete Markdown — MUST contain ALL sections below.
     Cover every feature the user asked for.
     One line per bullet.>",

  "tech_stack":
    ["React", "Tailwind CSS"],

  "stack":
    {json_stack},

  "architecture":
  {{
    "pages":
    [
      {{
        "name": "<PascalCase component name>",
        "route": "<exact route path>",
        "components":
          ["<Component1>", "<Component2>"]
      }}
    ],

    "components":
      ["<SharedComponent1>", "<SharedComponent2>"],

    {architecture_tables}

    {architecture_api}

    "dependencies":
      ["react-router-dom"]
  }},

  "status": "proposed"
}}

═══ PLANNING RULES ═══

PAGES — derive from the user's actual app:

- Every distinct screen the user needs = its own page entry.
- If the user explicitly requests login, signin, signup, register,
  or logout UI, create the corresponding frontend page/component.
- Do NOT automatically create auth pages that the user did not request.
- Auth UI does NOT imply a backend.
- Preserve every page explicitly requested by the user.
- Do NOT replace requested pages with a generic landing page.
- Every page MUST list its own specific components.
- Use 2-5 relevant components per page.
- Route params should use /:id when detail pages are explicitly needed.
- Use /create only when a create form is actually requested.

ADMIN PANEL:

- Only include an Admin Panel if the user explicitly requests one.
- In frontend-only scope, the Admin Panel is UI-only.
- Do NOT invent admin authentication.
- Do NOT invent database users.
- Do NOT invent seeded credentials.
- Do NOT invent admin APIs.
- Do NOT invent backend authorization.

{f'''
TABLES — derive from the user's data model:

- One table per primary resource the user mentioned.
- Columns MUST be real domain fields.
- Use snake_case for column names.
- auth_users table or resource for user authentication rows.

API ROUTES — derive from the user's features:

- Cover the full CRUD surface for each resource.
- GET list.
- GET by id.
- POST.
- PUT.
- DELETE.
- Auth routes only if real authentication was requested.
- Resource-specific operations only when needed.
- Use plural noun paths such as /api/videos.
'''
if not frontend_only
else
'''
TABLES:

- NO TABLES.
- Frontend-only project.

API ROUTES:

- NO API ROUTES.
- Frontend-only project.
'''
}

COMPLETENESS — scale to the user's request:
- Simple request (todo app) → 3-4 pages, 2-3 tables, 8-10 routes
- Medium request (blog, shop) → 5-6 pages, 3-4 tables, 12-16 routes
- Complex request (clone, SaaS) → 6-8 pages, 4-6 tables, 16-24 routes

For frontend-only requests:
- Scale only according to the pages/features explicitly requested.
- Do NOT add backend work to make the project appear more complete.

PLATFORM:

- Always React + Vite SPA.
- Never mobile, desktop, or native apps.
- All styling: Tailwind CSS.
- No custom CSS files.

{db_rule_text}

ANTI-HALLUCINATION:

- If the user asked for a todo app, do NOT add dashboard analytics
  unless requested.
- If the user did not mention payments, do NOT add payments.
- If the user said "simple", keep it simple.
- project_name must reflect the user's actual project.
- Never invent backend requirements for a frontend-only request.
"""

        # =====================================================
        # MESSAGES
        # =====================================================

        messages = [
            SystemMessage(
                content=system_prompt
            )
        ]

        if session_context:

            messages.append(
                SystemMessage(
                    content=session_context
                )
            )

        if decisions_context:

            messages.append(
                SystemMessage(
                    content=decisions_context
                )
            )

        if arch_context:

            messages.append(
                SystemMessage(
                    content=arch_context
                )
            )

        if skills_context:

            messages.append(
                SystemMessage(
                    content=skills_context
                )
            )

        if similar_context:

            messages.append(
                SystemMessage(
                    content=similar_context
                )
            )

        messages.append(
            HumanMessage(
                content=(
                    "Project Context "
                    "(including Q&A answers):\n"
                    f"{context_summary}"
                )
            )
        )

        if current_plan and not frontend_only:

            messages.append(
                SystemMessage(
                    content=(
                        "Current Plan to Update: "
                        f"{json.dumps(current_plan)[:1000]}"
                    )
                )
            )

            if feedback:

                messages.append(
                    HumanMessage(
                        content=(
                            "User Feedback on Plan: "
                            f"{feedback}"
                        )
                    )
                )

        # =====================================================
        # MAIN LLM CALL
        # =====================================================

        response_content = await self.chat(
            messages,
            timeout=90,
            max_tokens=2000,
        )

        print(
            f"{LOG} 📄 Planner raw response length: "
            f"{len(response_content)}",
            flush=True,
        )

        print(
            f"{LOG} ─ HEAD: "
            f"{response_content[:2000]}",
            flush=True,
        )

        print(
            f"{LOG} ─ TAIL: "
            f"{response_content[-1000:]}",
            flush=True,
        )

        plan = self._format_json_response(
            response_content
        )

        # =====================================================
        # VALIDATE STRUCTURED RESPONSE
        # =====================================================

        if (
            isinstance(plan, dict)
            and not plan.get("error")
        ):

            required = [
                "project_name",
                "markdown_plan",
                "tech_stack",
                "stack",
                "architecture",
                "status",
            ]

            missing = [
                k
                for k in required
                if k not in plan
            ]

            if missing:

                print(
                    f"{LOG} ⚠ Full structured call "
                    f"returned JSON but missing fields: "
                    f"{missing}. "
                    f"Retrying with light prompt...",
                    flush=True,
                )

                plan = {
                    "error":
                        f"missing required fields: {missing}"
                }

        # =====================================================
        # LIGHT RETRY
        # =====================================================

        if (
            not isinstance(plan, dict)
            or plan.get("error")
        ):

            fail_reason = (
                plan.get("error")
                if isinstance(plan, dict)
                else
                f"not a dict ({str(plan)[:200]})"
            )

            print(
                f"{LOG} ⚠ Full structured call failed. "
                f"Reason: {fail_reason}. "
                f"Retrying with light prompt...",
                flush=True,
            )

            if frontend_only:

                light_prompt = """
You are the Strategic Planner Agent for Grizon AI.

The user explicitly requested a FRONTEND-ONLY project.

Create a complete frontend implementation plan based STRICTLY
on the user's request and Q&A answers.

IMPORTANT:

- Preserve EVERY page and feature explicitly requested.
- Login, signin, signup, register, logout, dashboard, profile,
  settings, and admin panel are UI features only.
- Authentication must be mock/UI only.
- Use React + Vite + Tailwind CSS.
- Use React Router where required.
- Use mock data, local state, or localStorage for frontend interactions.

DO NOT include:

- backend
- Express
- Node server
- API
- REST API
- GraphQL
- database
- Supabase
- PostgreSQL
- SQL
- database tables
- migrations
- OAuth
- JWT
- real authentication
- backend models
- backend services
- Docker backend services

Do NOT replace requested pages with a generic Landing Page.

Return ONLY valid JSON:

{
  "project_name": "Name of actual project",

  "markdown_plan":
    "Complete frontend plan with sections:
     Overview, Architecture, Frontend Stack,
     Key Pages & Components, Components to Build,
     Implementation Steps.",

  "tech_stack":
    [
      "React",
      "Vite",
      "Tailwind CSS",
      "React Router"
    ],

  "stack":
    {
      "frontend": "React",
      "backend": "None",
      "db": "None",
      "auth": "Mock/UI only",
      "styling": "Tailwind CSS"
    },

  "architecture":
    {
      "pages": [],
      "components": [],
      "tables": [],
      "api_routes": [],
      "dependencies": ["react-router-dom"]
    },

  "status": "proposed"
}
"""

            else:

                light_prompt = """
You are the Strategic Planner Agent for Grizon AI.

Create a complete implementation plan based STRICTLY
on the user's request and Q&A answers.

Do NOT invent features the user never mentioned.

Small request = small plan.

Return ONLY valid JSON:

{
  "project_name": "Name of the actual project",
  "markdown_plan":
    "COMPLETE Markdown plan with sections:
     Overview, Architecture, Frontend Stack,
     Data Models, Key Pages & Components,
     Components to Build, Implementation Steps.",
  "tech_stack": ["React", "Express", "Supabase"],
  "status": "proposed"
}
"""

            light_messages = [
                SystemMessage(
                    content=light_prompt
                ),
                HumanMessage(
                    content=(
                        "Project Context "
                        "(including Q&A answers):\n"
                        f"{context_summary}"
                    )
                ),
            ]

            if current_plan:

                light_messages.append(
                    SystemMessage(
                        content=(
                            "Current Plan to Update: "
                            f"{json.dumps(current_plan)[:1000]}"
                        )
                    )
                )

                if feedback:

                    light_messages.append(
                        HumanMessage(
                            content=(
                                "User Feedback on Plan: "
                                f"{feedback}"
                            )
                        )
                    )

            print(
                f"{LOG} Retrying planner with light prompt...",
                flush=True,
            )

            response_content = await self.chat(
                light_messages,
                timeout=45,
                max_tokens=1000,
            )

            print(
                f"{LOG} 📄 Planner LIGHT retry raw response "
                f"length: {len(response_content)}",
                flush=True,
            )

            print(
                f"{LOG} ─ HEAD: "
                f"{response_content[:2000]}",
                flush=True,
            )

            print(
                f"{LOG} ─ TAIL: "
                f"{response_content[-1000:]}",
                flush=True,
            )

            plan = self._format_json_response(
                response_content
            )

        # =====================================================
        # DETERMINISTIC FALLBACK
        # =====================================================

        if (
            not isinstance(plan, dict)
            or plan.get("error")
        ):

            light_reason = (
                plan.get("error")
                if isinstance(plan, dict)
                else
                f"not a dict ({str(plan)[:200]})"
            )

            print(
                f"{LOG} ⚠ Light retry also failed "
                f"({light_reason}). "
                f"Using topic-based fallback.",
                flush=True,
            )

            plan = _topic_fallback(
                prompt,
                current_plan,
                frontend_only,
            )

        # =====================================================
        # FRONTEND-ONLY FINAL SANITIZATION
        # =====================================================

        if frontend_only and isinstance(plan, dict):

            architecture = plan.get(
                "architecture"
            )

            if not isinstance(
                architecture,
                dict,
            ):

                architecture = {}

                plan[
                    "architecture"
                ] = architecture

            # -------------------------------------------------
            # PRESERVE LLM-GENERATED PAGES
            # -------------------------------------------------

            if not isinstance(
                architecture.get("pages"),
                list,
            ):

                architecture[
                    "pages"
                ] = []

            if not isinstance(
                architecture.get("components"),
                list,
            ):

                architecture[
                    "components"
                ] = []

            # -------------------------------------------------
            # ABSOLUTELY NO BACKEND ARCHITECTURE
            # -------------------------------------------------

            architecture[
                "tables"
            ] = []

            architecture[
                "api_routes"
            ] = []

            if not isinstance(
                architecture.get(
                    "dependencies"
                ),
                list,
            ):

                architecture[
                    "dependencies"
                ] = [
                    "react-router-dom"
                ]

            # -------------------------------------------------
            # FORCE FRONTEND STACK
            # -------------------------------------------------

            plan[
                "tech_stack"
            ] = [
                "React",
                "Vite",
                "Tailwind CSS",
                "React Router",
            ]

            plan[
                "stack"
            ] = {
                "frontend": "React",
                "backend": "None",
                "db": "None",
                "auth": "Mock/UI only",
                "styling": "Tailwind CSS",
            }

            plan[
                "status"
            ] = "proposed"

            print(
                f"{LOG} ✓ Frontend-only safety gate applied: "
                f"pages={len(architecture.get('pages', []))}, "
                f"components={len(architecture.get('components', []))}, "
                f"tables=0, api_routes=0, backend=None, db=None",
                flush=True,
            )

        # =====================================================
        # NORMALIZE ARCHITECTURE
        # =====================================================

        if not isinstance(
            plan,
            dict,
        ):

            plan = {
                "project_name":
                    "Frontend App"
                    if frontend_only
                    else "Project",

                "markdown_plan":
                    str(plan),
            }

        if not isinstance(
            plan.get("architecture"),
            dict,
        ):

            plan[
                "architecture"
            ] = {}

        # =====================================================
        # NORMALIZE STACK
        # =====================================================

        if not isinstance(
            plan.get("stack"),
            dict,
        ):

            stack_map = {}

            for t in (
                plan.get("tech_stack")
                or []
            ):

                tl = str(t).lower()

                if "react" in tl:
                    stack_map[
                        "frontend"
                    ] = t

                elif "vue" in tl:
                    stack_map[
                        "frontend"
                    ] = t

                elif "angular" in tl:
                    stack_map[
                        "frontend"
                    ] = t

                elif "next" in tl:
                    stack_map[
                        "frontend"
                    ] = t

                elif "express" in tl:
                    stack_map[
                        "backend"
                    ] = t

                elif "supabase" in tl:
                    stack_map[
                        "db"
                    ] = t

                elif "postgres" in tl:
                    stack_map[
                        "db"
                    ] = t

                elif "tailwind" in tl:
                    stack_map[
                        "styling"
                    ] = t

                elif "jwt" in tl:
                    stack_map[
                        "auth"
                    ] = t

            if frontend_only:

                plan[
                    "stack"
                ] = {
                    "frontend": "React",
                    "backend": "None",
                    "db": "None",
                    "auth": "Mock/UI only",
                    "styling": "Tailwind CSS",
                }

            else:

                plan[
                    "stack"
                ] = (
                    stack_map
                    or {
                        "frontend": "React",
                        "backend": "Express",
                        "db": "Supabase",
                        "styling": "Tailwind",
                    }
                )

        # =====================================================
        # FINAL FRONTEND SAFETY CHECK
        # =====================================================

        # This is intentionally AFTER stack normalization.
        # Even if the LLM returned backend technologies,
        # frontend-only requests are forced back to a frontend-only
        # architecture before TodoAgent receives the plan.

        if frontend_only:

            architecture = plan.setdefault(
                "architecture",
                {},
            )

            architecture[
                "tables"
            ] = []

            architecture[
                "api_routes"
            ] = []

            if not isinstance(
                architecture.get("pages"),
                list,
            ):

                architecture[
                    "pages"
                ] = []

            if not isinstance(
                architecture.get("components"),
                list,
            ):

                architecture[
                    "components"
                ] = []

            if not isinstance(
                architecture.get("dependencies"),
                list,
            ):

                architecture[
                    "dependencies"
                ] = [
                    "react-router-dom"
                ]

            plan[
                "tech_stack"
            ] = [
                "React",
                "Vite",
                "Tailwind CSS",
                "React Router",
            ]

            plan[
                "stack"
            ] = {
                "frontend": "React",
                "backend": "None",
                "db": "None",
                "auth": "Mock/UI only",
                "styling": "Tailwind CSS",
            }

        # =====================================================
        # MARKDOWN FALLBACK
        # =====================================================

        if not plan.get(
            "markdown_plan"
        ):

            if frontend_only:

                plan[
                    "markdown_plan"
                ] = (
                    "## Overview\n"
                    "Frontend-only project.\n\n"
                    "## Architecture\n"
                    "- React + Vite.\n"
                    "- Tailwind CSS.\n"
                    "- No backend.\n"
                    "- No database.\n"
                    "- No API.\n\n"
                    "## Frontend Stack\n"
                    "- React\n"
                    "- Vite\n"
                    "- Tailwind CSS\n"
                    "- React Router\n\n"
                    "## Key Pages & Components\n"
                    "- Build the pages explicitly requested by the user.\n\n"
                    "## Components to Build\n"
                    "- Build components required by the requested UI.\n\n"
                    "## Implementation Steps\n"
                    "- Build the frontend.\n"
                    "- Implement requested routes.\n"
                    "- Use mock/local state where needed.\n"
                    "- Run the frontend preview.\n"
                )

            else:

                plan[
                    "markdown_plan"
                ] = (
                    "## Overview\n"
                    "Plan created successfully.\n\n"
                    "## Details\n"
                    + str(
                        plan.get(
                            "summary_points",
                            "No detailed plan available.",
                        )
                    )
                )

        # =====================================================
        # REPORT
        # =====================================================

        report = (
            f"## "
            f"{plan.get('project_name', 'New Project')}"
            f" - Implementation Plan\n"
            f"{plan.get('summary', '')}"
        )

        # =====================================================
        # STRING PLAN NORMALIZATION
        # =====================================================

        if isinstance(
            plan,
            str,
        ):

            try:

                import json as _j

                plan = _j.loads(
                    plan
                )

            except Exception:

                plan = {
                    "markdown_plan": plan,
                    "project_name":
                        "Project",
                }

        # =====================================================
        # FINAL STATE
        # =====================================================

        state[
            "project_plan"
        ] = plan

        state[
            "project_report"
        ] = report

        state[
            "status"
        ] = "plan_proposed"

        state[
            "next_agent"
        ] = None

        return state