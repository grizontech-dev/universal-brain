import os
import json
import asyncio
import uuid
from datetime import datetime


def _sanitize_for_json(obj):
    if isinstance(obj, (str, int, float, bool)) or obj is None:
        return obj
    if isinstance(obj, dict):
        return {k: _sanitize_for_json(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_sanitize_for_json(i) for i in obj]
    return str(obj)
from typing import TypedDict, List, Dict, Any, Optional, AsyncGenerator
from langgraph.graph import StateGraph, END
from langchain_openai import ChatOpenAI
from Brain.modules.conversations.service import conversation_service
from Brain.agents.manager.manager_agent import ManagerAgent
from Brain.agents.questions.questions_agent import QuestionsAgent
from Brain.agents.planner.planner_agent import PlannerAgent
from Brain.agents.todo.todo_agent import TodoAgent
from Brain.agents.builder.builder_agent import BuilderAgent
from Brain.agents.runner.runner_agent import RunnerAgent
from Brain.services.workspace_manager import workspace_manager
from Brain.services.sandbox_mcp_service import (
    get_sandbox_mcp_service,
    RUNTIME_SANDBOX_MCP,
)
from Brain.services.template_service import (
    apply_templates_to_workspace,
    get_bootstrap_ops,
    normalize_framework,
)
from Brain.services.websocket_manager import ws_manager
from Brain.services.build_resume import (
    compute_resume_index,
    latest_todo_list_from_messages,
    get_resume_payload,
)
from Brain.memory.gateway import MemoryGateway
from Brain.memory.models import Project
from Brain.modules.conversations.models import BrainProject
from Brain.config.database import SessionLocal
from dotenv import load_dotenv

load_dotenv()

class BrainState(TypedDict):
    user_id: str
    conversation_id: str
    content: str
    repo_url: Optional[str]
    intent_confidence: float
    plan: List[Dict[str, Any]] # Atomic tasks
    project_plan: Dict[str, Any] # High-level roadmap
    project_report: str
    questions_data: Dict[str, Any]
    status: str
    messages: List[Any]
    leader_analysis: Dict[str, Any]
    plan_approved: bool
    plan_feedback: Optional[str]
    current_task_index: int
    executed_tasks: List[Dict[str, Any]]
    current_job_id: Optional[str]
    model_id: str
    temperature: float
    question_rounds: int
    framework: str
    report: Optional[str]
    sandbox_job: Optional[Dict[str, Any]]
    execute_sandbox: Optional[Dict[str, Any]]
    resume_build: Optional[bool]
    memory_gateway: Optional[MemoryGateway]
    memory_context: Optional[Dict[str, Any]]
    next_agent: Optional[str]


class BrainChatService:
    def __init__(self):
        self.workflow = self._create_workflow()
        self.STOP_REGISTRY = set()
        self.STOP_EVENTS: Dict[str, asyncio.Event] = {}  # Per-conversation stop signal
        self.ACTIVE_BUILDS: Dict[str, Any] = {}

    def is_build_active(self, conversation_id: str) -> bool:
        """True if a background builder is currently running for this conversation."""
        if conversation_id in self.STOP_REGISTRY:
            return False
        task = self.ACTIVE_BUILDS.get(conversation_id)
        return bool(task and not task.done())

    def was_stopped_by_user(self, conversation_id: str) -> bool:
        """True if the user explicitly stopped this build (in STOP_REGISTRY)."""
        return conversation_id in self.STOP_REGISTRY

    def _register_build(self, conversation_id: str, task: Any):
        self.ACTIVE_BUILDS[conversation_id] = task

        def _on_done(_t: Any):
            if self.ACTIVE_BUILDS.get(conversation_id) is _t:
                self.ACTIVE_BUILDS.pop(conversation_id, None)

        task.add_done_callback(_on_done)

    def _create_workflow(self):
        graph = StateGraph(BrainState)

        # 1. Register Nodes
        graph.add_node("analyze_ingress", self.node_manager)
        graph.add_node("recursive_clarify", self.node_clarifier)
        graph.add_node("strategic_plan", self.node_planner)
        graph.add_node("create_tasks", self.node_todo)
        graph.add_node("init_sandbox", self.node_init_sandbox)

        # 2. Entry Point
        graph.set_entry_point("analyze_ingress")

        # 3. Transitions
        graph.add_conditional_edges(
            "analyze_ingress",
            self.route_after_ingress,
            {
                "clarify": "recursive_clarify",
                "plan": "strategic_plan",
                "taskify": "create_tasks",
                "resume": "init_sandbox",
            }
        )

        graph.add_conditional_edges(
            "recursive_clarify",
            self.route_after_clarify,
            {
                "plan": "strategic_plan",
                "done": END,
            }
        )
        graph.add_edge("strategic_plan", END)
        graph.add_edge("create_tasks", "init_sandbox")
        graph.add_edge("init_sandbox", END)

        return graph.compile()

    # --- Routing Logic ---

    def route_builder(self, state: BrainState):
        status = state.get("status")
        index = state.get("current_task_index", 0)
        print(f"DEBUG: Router - Status: {status}, Task Index: {index}")

        if status == "error":
            return "END"
        if status == "building_complete":
            return "runner"
        return "builder"

    def route_after_ingress(self, state: BrainState) -> str:
        if state.get("resume_build") and state.get("plan") and state.get("plan_approved"):
            return "resume"
        status = state.get("status")
        if status == "needs_clarification":
            return "clarify"
        if state.get("next_agent") == "builder":
            return "resume"
        if state.get("plan_approved"):
            return "taskify"
        return "plan"

    def route_after_clarify(self, state: BrainState) -> str:
        """After recursive_clarify: if no more questions needed, go to planner; otherwise END."""
        next_agent = state.get("next_agent", "")
        qd = state.get("questions_data") or {}
        has_questions = bool(qd.get("questions"))
        if next_agent == "planner" and not has_questions:
            return "plan"
        return "done"

    def should_continue_building(self, state: BrainState):
        tasks = state.get("plan", [])
        index = state.get("current_task_index", 0)
        print(f"DEBUG: Router check - Task Index: {index}/{len(tasks)}")

        if index < len(tasks):
            return "continue"
        return "complete"

    # --- Nodes ---

    async def node_manager(self, state: BrainState) -> Dict[str, Any]:
        print("DEBUG: NODE [analyze_ingress] started", flush=True)

        # Stop check before manager agent
        conv_id = state.get("conversation_id", "")
        if conv_id in self.STOP_REGISTRY:
            print(f"[CHAT-SERVICE] STOPPED before analyze_ingress", flush=True)
            state["status"] = "stopped"
            return state

        if state.get("resume_build"):
            # Only auto-approve if plan was ACTUALLY approved before stopping
            if state.get("plan_approved"):
                return {"status": "plan_approved", "plan_approved": True, "resume_build": True}
            # Plan not approved — fall through to normal manager flow (will route to plan review)

        content = state.get("content", "").lower()
        if "approve" in content or "✅ plan approved" in content:
            return {"status": "plan_approved", "plan_approved": True}

        # If there's an existing plan and it hasn't been approved, treat this input as feedback
        pp = state.get("project_plan")
        if isinstance(pp, str):
            try:
                import json as _json
                pp = _json.loads(pp)
                state["project_plan"] = pp
            except Exception:
                pp = {}
        # Check if plan was ever approved in the past
        was_ever_approved = False
        for m in state.get("messages", []):
            if isinstance(m, dict):
                metadata = m.get("metadata") or m.get("extra_metadata") or {}
                if metadata.get("planApproved") or metadata.get("plan_approved") or m.get("sandboxJob") or m.get("sandbox_job"):
                    was_ever_approved = True
                    break

        if isinstance(pp, dict) and pp and state.get("plan_approved") is False and not was_ever_approved:
            thoughts = f"The user provided feedback on the plan: '{state.get('content', '')}'. Updating the requirements and calling the **Planner Agent** to revise the technical roadmap."
            return {
                "status": "ready_to_plan",
                "plan_feedback": state["content"],
                "leader_analysis": {"analysis": thoughts},
                "thoughts": thoughts
            }

        # If this is a follow-up AND build was already running (has completed tasks), auto-approve
        # But if user is requesting plan changes (no completed tasks yet), DON'T auto-approve
        if was_ever_approved:
            _has_completed_tasks = any(
                (m.get("metadata") or {}).get("agentStep") in ("create_tasks", "execute_sandbox")
                for m in state.get("messages", [])
                if isinstance(m, dict)
            )
            if _has_completed_tasks:
                state["plan_approved"] = True
            # else: plan was approved before but user is requesting changes — don't auto-approve

        agent = ManagerAgent()
        result = await agent.execute(state)
        print(f"DEBUG: NODE [analyze_ingress] complete | next_agent={result.get('next_agent')} | status={result.get('status')}", flush=True)
        return result

    async def node_clarifier(self, state: BrainState) -> Dict[str, Any]:
        print("DEBUG: NODE [recursive_clarify] started", flush=True)

        # Stop check before clarifier agent
        conv_id = state.get("conversation_id", "")
        if conv_id in self.STOP_REGISTRY:
            print(f"[CHAT-SERVICE] STOPPED before recursive_clarify", flush=True)
            state["status"] = "stopped"
            return state

        leader_analysis = state.get("leader_analysis", {})
        if isinstance(leader_analysis, dict) and leader_analysis.get("questions"):
            print("DEBUG: NODE [recursive_clarify] single-pass fast path", flush=True)
            questions_data = {
                "preamble": leader_analysis.get("preamble", "To proceed, I need a couple of quick details:"),
                "questions": leader_analysis["questions"]
            }
            state["questions_data"] = questions_data
            state["report"] = f"__CLARIFY__:{json.dumps(questions_data)}"
            state["question_rounds"] = state.get("question_rounds", 0) + 1
            return state

        agent = QuestionsAgent()
        state = await agent.execute(state)
        qd = state.get("questions_data")
        if qd:
            state["report"] = f"__CLARIFY__:{json.dumps(qd)}"
            state["question_rounds"] = state.get("question_rounds", 0) + 1
        else:
            # No more questions needed — enough context gathered
            # Force route to planner regardless of current_rounds
            state["report"] = ""
            state["next_agent"] = "planner"
            state["status"] = "ready_to_plan"
            state["leader_analysis"] = {
                "analysis": "All questions answered. Sufficient context gathered — proceeding to planning.",
                "is_context_missing": False,
                "missing_details": [],
                "next_agent": "planner",
                "confidence": 0.95
            }
        print(f"DEBUG: NODE [recursive_clarify] complete | questions_count={len(state.get('questions_data', {}).get('questions', [])) if isinstance(state.get('questions_data'), dict) else 0}", flush=True)
        return state

    async def node_planner(self, state: BrainState) -> Dict[str, Any]:
        print("DEBUG: NODE [strategic_plan] started", flush=True)

        # Stop check before planner agent
        conv_id = state.get("conversation_id", "")
        if conv_id in self.STOP_REGISTRY:
            print(f"[CHAT-SERVICE] STOPPED before strategic_plan", flush=True)
            state["status"] = "stopped"
            return state

        agent = PlannerAgent()
        state = await agent.execute(state)

        # Stop check after planner agent — if stopped during LLM, discard result
        if state.get("status") == "stopped" or conv_id in self.STOP_REGISTRY:
            print(f"[CHAT-SERVICE] STOPPED after strategic_plan — discarding plan", flush=True)
            state["status"] = "stopped"
            return state

        state["report"] = state.get("project_report")

        # Safety: ensure project_plan is always a dict
        pp = state.get("project_plan")
        if isinstance(pp, str):
            print(f"[CHAT-SERVICE] WARN: planner returned project_plan as str, parsing...", flush=True)
            try:
                import json as _json
                state["project_plan"] = _json.loads(pp)
            except Exception:
                state["project_plan"] = {"markdown_plan": pp, "project_name": "Project"}

        plan = state.get("project_plan", {})
        if not isinstance(plan, dict):
            plan = {"project_name": "Project"}
            state["project_plan"] = plan

        print(f"DEBUG: NODE [strategic_plan] complete | plan_name='{plan.get('project_name', 'N/A')}' | has_markdown={bool(plan.get('markdown_plan'))}", flush=True)
        return state

    async def node_todo(self, state: BrainState) -> Dict[str, Any]:
        print("DEBUG: NODE [create_tasks] started", flush=True)

        # Stop check before expensive LLM task generation
        conv_id = state.get("conversation_id", "")
        if conv_id in self.STOP_REGISTRY:
            print(f"[CHAT-SERVICE] STOPPED before create_tasks", flush=True)
            state["status"] = "stopped"
            return state

        # Safety: ensure project_plan is a dict, not a string
        pp = state.get("project_plan")
        if isinstance(pp, str):
            print(f"[CHAT-SERVICE] WARN: project_plan is str, attempting parse: {pp[:200]}", flush=True)
            try:
                import json as _json
                state["project_plan"] = _json.loads(pp)
            except Exception:
                state["project_plan"] = {"markdown_plan": pp, "project_name": "Project"}
            print(f"[CHAT-SERVICE] Fixed project_plan to dict: {type(state['project_plan']).__name__}", flush=True)

        agent = TodoAgent()
        state = await agent.execute(state)
        # TodoAgent returns tasks in state['tasks'], but Builder expects state['plan']
        state["plan"] = state.get("tasks", [])
        state["report"] = f"✅ I've broken down the project into {len(state['plan'])} executable tasks. Starting the build process now..."
        print(f"DEBUG: NODE [create_tasks] complete | plan_len={len(state['plan'])} | type(plan)={type(state['plan']).__name__}", flush=True)
        print(f"DEBUG: NODE [create_tasks] state keys: {list(state.keys())}", flush=True)
        return state

    async def node_init_sandbox(self, state: BrainState) -> Dict[str, Any]:
        """Initializes the sandbox MCP workspace with graceful fallback."""
        print(f"DEBUG: NODE [init_sandbox] started | conv={state.get('conversation_id')}", flush=True)
        sandbox_mcp = get_sandbox_mcp_service()
        sandbox_available = False
        try:
            await sandbox_mcp.initialize()
            sandbox_mcp.start_background_cleanup()
            sandbox_available = True
        except Exception as e:
            print(f"WARNING: Sandbox MCP unavailable ({e}). Proceeding with local workspace only.", flush=True)

        if not state.get("current_job_id"):
            print(f"DEBUG: Creating workspace for conversation {state['conversation_id']}")
            cid = workspace_manager.create_workspace(name=state["conversation_id"])
            state["current_job_id"] = cid
            if isinstance(cid, str) and cid.startswith("error:"):
                print(f"ERROR: Workspace creation failed: {cid}")
                return {
                    "status": "error",
                    "error_msg": cid,
                    "report": f"Workspace error: {cid}"
                }

        job_id = state["current_job_id"]
        framework = normalize_framework(state.get("framework"))
        user_id = state.get("user_id")

        if state.get("resume_build"):
            payload = get_resume_payload(
                job_id,
                framework=framework,
                todos=state.get("plan", []),
                user_id=user_id,
            )
            bootstrap_ops = payload.get("workspace_ops") or []
            progress_msg = f"[TEMPLATE] Restored {len(bootstrap_ops)} files from workspace"
        else:
            from Brain.agents.planner.planner_agent import _is_frontend_only_request
            is_frontend_only = _is_frontend_only_request(state.get("content", ""), state.get("messages", []))
            
            # Fallback to state if somehow it was set but the prompt doesn't match
            if not is_frontend_only:
                is_frontend_only = state.get("active_decisions", {}).get("frontend_only", False)
            if not is_frontend_only and state.get("memory_context"):
                is_frontend_only = state["memory_context"].get("decisions", {}).get("frontend_only", False)

            bootstrap_ops = apply_templates_to_workspace(job_id, framework, user_id=user_id, include_backend=not is_frontend_only)
            if is_frontend_only:
                progress_msg = f"[TEMPLATE] Loaded {framework} frontend template"
            else:
                progress_msg = f"[TEMPLATE] Loaded express, supabase, and {framework} frontend template"

        runtime = RUNTIME_SANDBOX_MCP if sandbox_available else "local"
        sandbox_job = {
            "job_id": job_id,
            "runtime": runtime,
            "framework": framework,
            "await_preview": sandbox_available,
            "sync_url": f"{os.getenv('WS_BASE_URL', 'ws://localhost:8001')}/brain/sandbox/sync/{job_id}",
        }

        if sandbox_available:
            sandbox_mcp.record_activity(str(job_id))

        from Brain.agents.planner.planner_agent import _is_frontend_only_request
        is_frontend_only_ui = _is_frontend_only_request(state.get("content", ""), state.get("messages", []))
        if not is_frontend_only_ui:
            is_frontend_only_ui = state.get("active_decisions", {}).get("frontend_only", False) or state.get("memory_context", {}).get("decisions", {}).get("frontend_only", False)

        template_activities = []
        if not is_frontend_only_ui:
            template_activities.extend([
                {
                    "id": "tpl-express",
                    "type": "template",
                    "label": "Read express-template -> backend/",
                    "status": "done",
                    "timestamp": int(__import__("time").time() * 1000),
                },
                {
                    "id": "tpl-supabase",
                    "type": "template",
                    "label": "Read supabase-template -> backend/supabase/",
                    "status": "done",
                    "timestamp": int(__import__("time").time() * 1000),
                }
            ])
        template_activities.append(
            {
                "id": "tpl-frontend",
                "type": "template",
                "label": f"Loaded {framework} frontend template",
                "status": "done",
                "timestamp": int(__import__("time").time() * 1000),
            }
        )

        sandbox_status = "building" if sandbox_available else "building_local"
        report_msg = f"Sandbox workspace ready ({framework})."
        if sandbox_available:
            if is_frontend_only_ui:
                report_msg += " Frontend template loaded."
            else:
                report_msg += " Express + Supabase + frontend template loaded."
        else:
            report_msg += " Running in local mode (remote sandbox unavailable)."

        print(f"DEBUG: NODE [init_sandbox] complete - Job: {job_id}, framework: {framework}, sandbox_available={sandbox_available}")
        return {
            "current_job_id": job_id,
            "framework": framework,
            "sandbox_job": sandbox_job,
            "execute_sandbox": {
                "sandbox_job": sandbox_job,
                "workspace_ops": bootstrap_ops,
                "activities": template_activities,
                "plan": state.get("plan", []),
                "status": sandbox_status,
                "progress_msg": f"[TEMPLATE] Bootstrapped {framework} stack" + (" (local mode)" if not sandbox_available else ""),
            },
            "status": sandbox_status,
            "report": report_msg,
        }

    # --- Stream Method ---

    def _node_to_workflow_state(self, node_name: str, state: Dict[str, Any]) -> tuple:
        mapping = {
            "analyze_ingress": ("planning", "LeaderAgent"),
            "recursive_clarify": ("clarifying", "QuestionsAgent"),
            "strategic_plan": ("planning", "PlannerAgent"),
            "create_tasks": ("todo_generation", "TodoAgent"),
            "init_sandbox": ("building", "BuilderAgent"),
        }
        return mapping.get(node_name, (state.get("status", "unknown"), node_name))

    def _save_phase_message(self, conv_id: str, state: Dict[str, Any], node_name: str, credits_deducted: int = 0, elapsed_seconds: int = 0):
        """Save a phase message to the conversation DB."""
        report = state.get("report") or state.get("progress_msg") or ""
        leader_analysis = state.get("leader_analysis") or {}
        thoughts = state.get("thoughts") or leader_analysis.get("analysis") or leader_analysis.get("report") or ""
        todo_list = state.get("plan")
        sandbox_job = state.get("sandbox_job")
        metadata = {
            "planContent": json.dumps(state.get("project_plan")) if isinstance(state.get("project_plan"), dict) else state.get("project_plan"),
            "agentStep": node_name,
            "questions_data": state.get("questions_data"),
            "planApproved": state.get("plan_approved", False),
            "thoughts": thoughts,
            "current_task_index": state.get("current_task_index", 0),
            "durationSeconds": elapsed_seconds,
        }
        conversation_service.save_message(
            conv_id, "ASSISTANT", report,
            todo_list=todo_list if isinstance(todo_list, list) else None,
            sandbox_job=sandbox_job,
            metadata=metadata,
            credits_deducted=credits_deducted
        )

        mg: MemoryGateway = state.get("memory_gateway")
        if mg:
            try:
                asyncio.create_task(
                    mg.short_term.append("assistant", report or "", node_name)
                )
            except RuntimeError:
                pass

        # Update session workflow state based on node
        if mg:
            wf_state, agent = self._node_to_workflow_state(node_name, state)
            try:
                asyncio.create_task(
                    mg.session.update_workflow_state(wf_state, agent)
                )
            except RuntimeError:
                pass

            # Log execution for every agent phase (not builder — that's per-todo)
            if node_name not in ("execute_sandbox", "init_sandbox"):
                try:
                    task_label = {
                        "analyze_ingress": "Analyze user intent",
                        "recursive_clarify": "Ask clarifying questions",
                        "strategic_plan": "Generate strategic plan",
                        "create_tasks": "Break plan into tasks",
                    }.get(node_name, f"Phase: {node_name}")
                    log = mg.execution.start_task(
                        mg.project_id, task_label, agent or "unknown"
                    )
                    mg.execution.complete_task(log.id)
                except Exception:
                    pass

        # Store decisions in memory when plan is approved
        if mg and node_name == "strategic_plan" and state.get("plan_approved"):
            project_plan = state.get("project_plan") or {}
            plan_json = project_plan if isinstance(project_plan, dict) else {}
            tech_stack = plan_json.get("tech_stack", []) or []
            plan_content = plan_json.get("markdown_plan", "") or ""

            fp = plan_json.get("frontend") or plan_json.get("framework") or state.get("framework", "react")
            decisions = {
                "frontend": fp,
                "backend": plan_json.get("backend") or "node",
                "database": plan_json.get("database") or "supabase",
                "theme": plan_json.get("theme") or "dark",
                "auth": plan_json.get("auth") or "jwt",
                "css": plan_json.get("css") or plan_json.get("css_framework") or "tailwind",
                "api_style": "rest",
            }
            # Prefer the structured stack object when present (planner v2)
            stack_obj = plan_json.get("stack")
            if isinstance(stack_obj, dict) and any(stack_obj.values()):
                if stack_obj.get("frontend"): decisions["frontend"] = stack_obj["frontend"]
                if stack_obj.get("backend"): decisions["backend"] = stack_obj["backend"]
                if stack_obj.get("db"): decisions["database"] = stack_obj["db"]
                if stack_obj.get("auth"): decisions["auth"] = stack_obj["auth"]
                if stack_obj.get("styling"): decisions["css"] = stack_obj["styling"]
            for t in tech_stack:
                tl = t.lower()
                if "react" in tl: decisions["frontend"] = "React"
                elif "vue" in tl: decisions["frontend"] = "Vue"
                elif "angular" in tl: decisions["frontend"] = "Angular"
                elif "express" in tl or "fastify" in tl: decisions["backend"] = t
                elif "supabase" in tl: decisions["database"] = "Supabase"
                elif "postgres" in tl: decisions["database"] = "PostgreSQL"
                elif "mongodb" in tl: decisions["database"] = "MongoDB"
                elif "tailwind" in tl: decisions["css"] = "Tailwind"
                elif "jwt" in tl: decisions["auth"] = "JWT"
                elif "oauth" in tl: decisions["auth"] = "OAuth"
            mg.decisions.store_approved_decisions(mg.project_id, decisions)

            # Store plan in long-term memory
            plan_text = json.dumps(todo_list) if todo_list else report
            mg.long_term.store(mg.project_id, "plan", plan_text, {"conv_id": conv_id})



    async def process_chat_stream(self, request: Dict[str, Any]) -> AsyncGenerator[str, None]:
        import asyncio
        import time as _t
        _t_begin = _t.time()
        from Brain.utils.token_counter import token_counter_context, calculate_credits
        from Brain.modules.conversations.service import conversation_service
        initial_state = self._prepare_initial_state(request)

        conv_id, _ = conversation_service.ensure_brain_persistence(initial_state)
        print(f"[CHAT-SERVICE] TIMING: persistence done in {_t.time()-_t_begin:.1f}s", flush=True)
        initial_state["conversation_id"] = conv_id
        if conv_id in self.STOP_REGISTRY:
            self.STOP_REGISTRY.remove(conv_id)
        initial_state["messages"] = conversation_service.get_messages(conv_id)

        # Generate title for new conversation based on first message
        is_new = not request.get("conversation_id") or request.get("conversation_id") == "new"
        if is_new:
            async def _bg_title_gen():
                try:
                    from Brain.services.provider_router import ProviderRouter
                    from langchain_core.messages import SystemMessage, HumanMessage
                    prompt = initial_state.get("content") or ""
                    _model_id = initial_state.get("model_id", os.getenv("DEFAULT_CHEAP_MODEL", "deepseek-chat"))
                    _llm = ProviderRouter.get_model(_model_id, temperature=0.3)
                    _msgs = [
                        SystemMessage(content="Generate a concise title (max 50 chars) for this project request. Return ONLY the title text, no quotes, no punctuation at the end."),
                        HumanMessage(content=prompt[:300]),
                    ]
                    _resp = await _llm.ainvoke(_msgs)
                    title = (_resp.content or "").strip().strip('"').strip("'")[:60]
                    if title:
                        conversation_service.update_titles(conv_id, title)
                        print(f"DEBUG: Generated title for new conversation {conv_id}: {title}")
                except Exception as e:
                    print(f"ERROR: Failed to generate title for new conversation: {e}")

            asyncio.create_task(_bg_title_gen())

        mg: MemoryGateway = initial_state.get("memory_gateway")
        if mg:
            initial_state["memory_context"] = await mg.build_agent_context("Leader")
            print(f"[CHAT-SERVICE] TIMING: memory_context built in {_t.time()-_t_begin:.1f}s", flush=True)
            # Release pooled DB connections immediately — sessions are reusable after close(),
            # and holding ~9 connections for the whole build exhausts the pool on hosted.
            try:
                mg.close_all()
            except Exception as _close_err:
                print(f"[CHAT-SERVICE] WARN: memory close_all failed: {_close_err}", flush=True)

        # Initialize session on start
        if mg:
            try:
                asyncio.create_task(mg.session.set("started_at", datetime.utcnow().isoformat()))
                asyncio.create_task(mg.session.set("project_id", mg.project_id))
                asyncio.create_task(mg.session.update_workflow_state("starting", "LeaderAgent"))
            except RuntimeError:
                pass

        ctx = token_counter_context()
        tokens_data = ctx.__enter__()
        deducted_credits = 0

        state = initial_state
        # SAVE plan before Phase 1 — LangGraph may overwrite it during state updates
        _saved_plan = list(state.get("plan", []))
        _saved_plan_approved = state.get("plan_approved", False)
        try:
            # Phase 1: LangGraph workflow up to init_sandbox
            try:
                _iterator = self.workflow.astream(initial_state).__aiter__()
                while True:
                    try:
                        import asyncio as _asyncio
                        _task = _asyncio.create_task(_iterator.__anext__())
                        while not _task.done():
                            _done, _ = await _asyncio.wait([_task], timeout=15.0)
                            if not _done:
                                yield ": keep-alive\n\n"
                        event = _task.result()
                        _event_elapsed = _t.time() - _t_begin
                        print(f"[CHAT-SERVICE] TIMING: workflow event at +{_event_elapsed:.1f}s", flush=True)
                    except StopAsyncIteration:
                        break
                    if initial_state["conversation_id"] in self.STOP_REGISTRY:
                        # Persist stopped state so resume works after reload
                        try:
                            _conv_id = initial_state["conversation_id"]
                            conversation_service.save_message(
                                _conv_id, "ASSISTANT",
                                "Build interrupted by user. Press Continue to resume from where it stopped.",
                                todo_list=_saved_plan or [],
                                sandbox_job=initial_state.get("sandbox_job"),
                                metadata={
                                    "agentStep": "stopped",
                                    "planApproved": _saved_plan_approved,
                                    "current_task_index": initial_state.get("current_task_index", 0),
                                    "durationSeconds": round(_t.time() - _t_begin),
                                },
                            )
                            print(f"[CHAT-SERVICE] Phase-1 STOP: Persisted stopped state for conv {_conv_id}", flush=True)
                        except Exception as _stop_err:
                            print(f"[CHAT-SERVICE] Phase-1 STOP: Failed to persist: {_stop_err}", flush=True)
                        yield "data: " + json.dumps({"status": "stopped"}) + "\n\n"
                        break

                    # Safety: ensure event is a dict before processing
                    if not isinstance(event, dict):
                        print(f"[CHAT-SERVICE] WARN: event is not a dict: {type(event).__name__} = {str(event)[:200]}", flush=True)
                        continue

                    yield f"data: {json.dumps(_sanitize_for_json(event))}\n\n"

                    for node_name, node_data in event.items():
                        # Progressive credit deduction check
                        current_tokens = tokens_data["total_tokens"]
                        target_credits = calculate_credits(current_tokens)
                        if target_credits > deducted_credits:
                            credits_to_deduct = target_credits - deducted_credits
                            user_id = initial_state.get("user_id")
                            success = conversation_service.deduct_credits(
                                user_id=user_id,
                                amount=credits_to_deduct,
                                reason=f"Brain multi-step workflow phase: {node_name}",
                                reference_id=conv_id
                            )
                            if success:
                                deducted_credits = target_credits
                        if isinstance(node_data, str):
                            print(f"[CHAT-SERVICE] WARN: node_data is str for '{node_name}': {node_data[:200]}", flush=True)
                            initial_state["report"] = node_data
                            node_data = {"report": node_data}
                        elif not isinstance(node_data, dict):
                            print(f"[CHAT-SERVICE] WARN: unexpected node_data type for '{node_name}': {type(node_data).__name__}", flush=True)
                            node_data = {}
                        print(f"[CHAT-SERVICE] TIMING: node '{node_name}' completed at +{_t.time()-_t_begin:.1f}s", flush=True)
                        initial_state.update(node_data)
                        # SAVE plan after every node update — plan is created by create_tasks node
                        if initial_state.get("plan"):
                            _saved_plan = list(initial_state["plan"])
                            _saved_plan_approved = initial_state.get("plan_approved", False)
                        report = node_data.get("report") or node_data.get("progress_msg")
                        if node_name == "init_sandbox":
                            self._save_phase_message(conv_id, initial_state, node_name, deducted_credits, round(_t.time() - _t_begin))

                        if report or node_name in ("recursive_clarify", "strategic_plan"):
                            # Skip saving empty recursive_clarify messages (no questions → empty report)
                            _should_save = not (node_name == "recursive_clarify" and not report)

                            if _should_save:
                                if node_name == "strategic_plan":
                                    leader_analysis = initial_state.get("leader_analysis") or {}
                                    thoughts = initial_state.get("thoughts") or leader_analysis.get("analysis") or leader_analysis.get("report") or ""
                                    if not thoughts:
                                        thoughts = "Analyzing requirements and calling **Planner Agent** to create the technical roadmap."
                                elif initial_state.get("next_agent") == "questions" or initial_state.get("status") == "needs_clarification":
                                    leader_analysis = initial_state.get("leader_analysis") or {}
                                    thoughts = initial_state.get("thoughts") or leader_analysis.get("analysis") or leader_analysis.get("report") or ""
                                    if not thoughts:
                                        thoughts = "Calling Questions Agent to gather missing context..."
                                else:
                                    thoughts = ""

                                todo_list = initial_state.get("plan")
                                sandbox_job = initial_state.get("sandbox_job")
                                leader_analysis = initial_state.get("leader_analysis") or {}
                                elapsed_seconds = round(_t.time() - _t_begin)
                                metadata = {
                                    "planContent": json.dumps(initial_state.get("project_plan")) if isinstance(initial_state.get("project_plan"), dict) else initial_state.get("project_plan"),
                                    "agentStep": node_name,
                                    "questions_data": initial_state.get("questions_data"),
                                    "planApproved": initial_state.get("plan_approved", False),
                                    "thoughts": thoughts,
                                    "current_task_index": initial_state.get("current_task_index", 0),
                                    "durationSeconds": elapsed_seconds,
                                }
                                conversation_service.save_message(
                                    conv_id, "ASSISTANT", report or "",
                                    todo_list=todo_list if isinstance(todo_list, list) else None,
                                    sandbox_job=sandbox_job,
                                    metadata=metadata,
                                    credits_deducted=deducted_credits
                                )
                        if mg:
                            try:
                                asyncio.create_task(
                                    mg.short_term.append("assistant", report or "", node_name)
                                )
                            except RuntimeError:
                                pass
            except Exception as phase1_err:
                print(f"[CHAT-SERVICE] ═══════════════════════════════════════════════════════════════", flush=True)
                print(f"[CHAT-SERVICE] ✖ Phase 1 error: {type(phase1_err).__name__}: {phase1_err}", flush=True)
                import traceback
                traceback.print_exc()
                print(f"[CHAT-SERVICE] ═══════════════════════════════════════════════════════════════", flush=True)
                # CRITICAL FIX: Send error event to frontend so UI doesn't stay blank
                yield f"data: {json.dumps({'error': f'Phase 1 error: {type(phase1_err).__name__}: {str(phase1_err)[:300]}'})}\n\n"
                if mg:
                    try:
                        asyncio.create_task(
                            mg.session.update_workflow_state("error", str(phase1_err)[:200])
                        )
                    except RuntimeError:
                        pass
                    mg.errors.record_error(str(phase1_err), state.get("framework", "unknown"), "runtime", {
                        "description": str(phase1_err)
                    })

            print(f"[CHAT-SERVICE] ═══ PHASE 1 COMPLETE ═══ plan_len={len(state.get('plan', []))} plan_approved={state.get('plan_approved')}", flush=True)

            # Phase 2: Run builder in background task (survives client disconnect)
            plan = state.get("plan", [])
            # RESTORE plan if LangGraph lost it during state updates
            if not plan and _saved_plan:
                print(f"[CHAT-SERVICE] RESTORE: Plan was lost during Phase 1, restoring {len(_saved_plan)} tasks from pre-phase snapshot", flush=True)
                plan = _saved_plan
                state["plan"] = plan
                state["plan_approved"] = _saved_plan_approved
            # Also try loading from conversation messages if still empty
            if not plan:
                try:
                    conv_id = state.get("conversation_id")
                    if conv_id:
                        msgs = conversation_service.get_messages(conv_id)
                        for m in reversed(msgs):
                            tl = m.get("todoList") or (m.get("metadata", {}) or {}).get("plan")
                            if isinstance(tl, list) and len(tl) > 0:
                                print(f"[CHAT-SERVICE] RESTORE: Loaded {len(tl)} tasks from conversation message", flush=True)
                                plan = tl
                                state["plan"] = plan
                                state["plan_approved"] = True
                                break
                except Exception as restore_err:
                    print(f"[CHAT-SERVICE] RESTORE failed: {restore_err}", flush=True)
            task_log_ids = {}
            print(f"[CHAT-SERVICE] ═══════════════════════════════════════════════════════════════", flush=True)
            print(f"[CHAT-SERVICE] Phase 2 DEBUG: plan_type={type(plan).__name__} plan_len={len(plan)} plan_approved={state.get('plan_approved')} plan_approved_raw={state.get('plan_approved', 'MISSING')}", flush=True)
            print(f"[CHAT-SERVICE] Phase 2 DEBUG: _saved_plan_len={len(_saved_plan)} _saved_plan_approved={_saved_plan_approved}", flush=True)
            print(f"[CHAT-SERVICE] Phase 2 DEBUG: plan_truthy={bool(plan)} approved_truthy={bool(state.get('plan_approved', False))}", flush=True)
            print(f"[CHAT-SERVICE] Phase 2: Building | plan_approved={state.get('plan_approved')} | tasks={len(plan)}", flush=True)
            for i, t in enumerate(plan):
                cat = t.get("category", "?")
                title = t.get("title") or t.get("task") or f"Task {i+1}"
                print(f"[CHAT-SERVICE]   [{i+1}/{len(plan)}] {cat}: {title}", flush=True)
            print(f"[CHAT-SERVICE] ═══════════════════════════════════════════════════════════════", flush=True)
            if plan and state.get("plan_approved", False):
                # Inject company Supabase credentials into backend/.env BEFORE
                # the builder runs, so its deploy archive includes them.
                # Skip this for frontend-only projects.
                from Brain.agents.planner.planner_agent import _is_frontend_only_request
                if not _is_frontend_only_request(state.get("content", ""), state.get("messages", [])):
                    try:
                        from Brain.services.template_service import inject_company_supabase_to_workspace
                        inject_company_supabase_to_workspace(conv_id, user_id=state.get("user_id"))
                    except Exception as e:
                        print(f"[CHAT-SERVICE] Failed to inject Supabase credentials: {e}")

                # Run builder in background task to survive client disconnect
                _builder_task = asyncio.create_task(
                    self._run_builder_background(state, plan, conv_id, mg)
                )
                self._register_build(conv_id, _builder_task)
                print(f"[CHAT-SERVICE] Builder started as background task for {len(plan)} tasks", flush=True)
                if mg:
                    try:
                        asyncio.create_task(
                            mg.session.update_workflow_state("building", "BuilderAgent")
                        )
                    except RuntimeError:
                        pass

                # Background task handles everything - no foreground loop needed
                # The background task sends updates via websocket (ws_manager)
                yield "data: " + json.dumps({"status": "building", "plan": _sanitize_for_json(plan)}) + "\n\n"

                # Await builder completion. The builder itself runs the runner
                # (deploy) AFTER all tasks are written — deploying here would
                # archive only the scaffold and reset the builder's workspace.
                while not _builder_task.done():
                    _done, _ = await asyncio.wait([_builder_task], timeout=15.0)
                    if not _done:
                        yield ": keep-alive\n\n"
                if _builder_task.cancelled():
                    print(f"[CHAT-SERVICE] WARN: Builder task cancelled for {conv_id}", flush=True)
                if mg:
                    try:
                        asyncio.create_task(
                            mg.session.update_workflow_state("deploying", "RunnerAgent")
                        )
                    except RuntimeError:
                        pass

                if conv_id in self.STOP_REGISTRY:
                    # Final deduction check on stop
                    current_tokens = tokens_data["total_tokens"]
                    target_credits = calculate_credits(current_tokens)
                    if target_credits > deducted_credits:
                        credits_to_deduct = target_credits - deducted_credits
                        user_id = state.get("user_id")
                        success = conversation_service.deduct_credits(
                            user_id=user_id,
                            amount=credits_to_deduct,
                            reason="Brain execution stopped",
                            reference_id=conv_id
                        )
                        if success:
                            deducted_credits = target_credits

                    print(f"[Brain] Execution stopped by user. Bypassing Phase 3 (Runner). Index: {state.get('current_task_index', 0)}")
                    # Note: message already saved by BG-TASK stop handler
                    yield "data: " + json.dumps({"status": "stopped"}) + "\n\n"
                    return

                # Phase 3: Runner — the builder already ran RunnerAgent after
                # writing all files, so its workspace is complete. Just report
                # its final state to the client (no second race-y deploy).
                print(f"[CHAT-SERVICE] ═══════════════════════════════════════════════════════════════", flush=True)
                print(f"[CHAT-SERVICE] Phase 3: reporting builder result (deploy already triggered)", flush=True)

                print(f"[CHAT-SERVICE] \n-------------------------------------------------------------", flush=True)
                tasks = state.get("plan", plan)
                sandbox_job = state.get("sandbox_job")
                runner_exe = state.get("execute_sandbox") or {}
                for t in tasks:
                    if t.get("status") == "failed":
                        continue
                    t["status"] = "completed"

                # Log runner execution
                if mg:
                    runner_log = mg.execution.start_task(
                        mg.project_id, "Runner: Start dev servers & finalize", "RunnerAgent"
                    )
                    mg.execution.complete_task(runner_log.id)

                runner_status = state.get("status", "deploying")
                final_payload = {
                    "execute_sandbox": {
                        "sandbox_job": sandbox_job,
                        "plan": tasks,
                        "status": runner_status,
                        "workspace_ops": runner_exe.get("workspace_ops", []),
                        "progress_msg": runner_exe.get("progress_msg"),
                    },
                    "plan": tasks,
                    "status": runner_status,
                    "report": state.get("run_report"),
                }
                yield f"data: {json.dumps({'final_report': _sanitize_for_json(final_payload)})}\n\n"

                # Final deduction check on runner completion
                current_tokens = tokens_data["total_tokens"]
                target_credits = calculate_credits(current_tokens)
                if target_credits > deducted_credits:
                    credits_to_deduct = target_credits - deducted_credits
                    user_id = state.get("user_id")
                    success = conversation_service.deduct_credits(
                        user_id=user_id,
                        amount=credits_to_deduct,
                        reason="Brain workflow completion",
                        reference_id=conv_id
                    )
                    if success:
                        deducted_credits = target_credits

                report = state.get("run_report") or ""
                # Note: final message is saved by the background builder task
                # itself (common path for connected + disconnected clients).

        except Exception as e:
            # Final deduction check on error
            try:
                current_tokens = tokens_data["total_tokens"]
                target_credits = calculate_credits(current_tokens)
                if target_credits > deducted_credits:
                    credits_to_deduct = target_credits - deducted_credits
                    user_id = state.get("user_id") if state else initial_state.get("user_id")
                    conversation_service.deduct_credits(
                        user_id=user_id,
                        amount=credits_to_deduct,
                        reason="Brain execution error final deduction",
                        reference_id=conv_id
                    )
            except Exception as deduct_err:
                print(f"ERROR: Failed to deduct credits on exception: {deduct_err}")

            print(f"ERROR in stream: {e}")
            import traceback
            print(f"[CHAT-SERVICE] ═══════════════════════════════════════════════════════════════", flush=True)
            print(f"[CHAT-SERVICE] ✖ STREAM ERROR: {type(e).__name__}: {e}", flush=True)
            traceback.print_exc()
            print(f"[CHAT-SERVICE] ═══════════════════════════════════════════════════════════════", flush=True)
            if mg:
                try:
                    asyncio.create_task(
                        mg.session.update_workflow_state("error", "")
                    )
                except RuntimeError:
                    pass
                mg.errors.record_error(str(e), state.get("framework", "unknown"), "runtime", {
                    "description": str(e)
                })
            import traceback
            traceback.print_exc()
            yield f"data: {json.dumps({'error': str(e)})}\n\n"
        finally:
            ctx.__exit__(None, None, None)
            if mg:
                mg.close_all()
            yield "event: end\ndata: {}\n\n"

    def _get_or_create_project_id(self, conv_id: str, request_project_id: Optional[str] = None) -> str:
        if request_project_id:
            if conv_id and conv_id != "new":
                try:
                    uuid.UUID(conv_id)
                    db = SessionLocal()
                    bp = db.query(BrainProject).filter(BrainProject.conversationId == conv_id).first()
                    if not bp:
                        try:
                            bp = BrainProject(
                                id=request_project_id,
                                conversationId=conv_id,
                                status="ACTIVE",
                            )
                            db.add(bp)
                            db.commit()
                        except Exception as e:
                            print(f"[CHAT-SERVICE] _get_or_create_project_id FK error (skipping): {e}", flush=True)
                            db.rollback()
                    db.close()
                except (ValueError, AttributeError) as e:
                    print(f"[CHAT-SERVICE] _get_or_create_project_id error: {e}", flush=True)
            return request_project_id
        if conv_id and conv_id != "new":
            try:
                uuid.UUID(conv_id)
                _db = SessionLocal()
                try:
                    bp = _db.query(BrainProject).filter(BrainProject.conversationId == conv_id).first()
                    if bp:
                        return str(bp.id)
                finally:
                    _db.close()
            except (ValueError, AttributeError):
                pass
        return str(uuid.uuid4())

    def _prepare_initial_state(self, request: Dict[str, Any]) -> BrainState:
        conv_id = request.get("conversation_id") or "new"
        resume_build = bool(request.get("resume_build"))
        plan: List[Dict[str, Any]] = []
        current_index = 0
        _loaded_messages: List[Dict[str, Any]] = []

        if resume_build and conv_id and conv_id != "new":
            # Clear STOP_REGISTRY and STOP_EVENT so builder loop can run again
            self.STOP_REGISTRY.discard(conv_id)
            self.STOP_EVENTS.pop(str(conv_id), None)
            messages = conversation_service.get_messages(conv_id)
            _loaded_messages = messages  # Keep reference for state
            plan = latest_todo_list_from_messages(messages)
            current_index, _ = compute_resume_index(plan)

            # Restore original user content (first human message) for sub-agent context
            original_content = ""
            for msg in messages:
                if msg.get("role") in ("human", "user") and msg.get("content"):
                    original_content = msg.get("content", "")
                    break
            # Restore project_plan from conversation metadata if available
            original_plan = {}
            for msg in reversed(messages):
                meta = msg.get("metadata") or {}
                plan_content = meta.get("planContent")
                if plan_content:
                    if isinstance(plan_content, dict):
                        original_plan = plan_content
                    elif isinstance(plan_content, str):
                        try:
                            original_plan = json.loads(plan_content)
                        except Exception:
                            original_plan = {}
                    break
        else:
            original_content = request.get("content") or ""
            original_plan = request.get("approved_plan") or {}
            # For follow-up messages on existing conversations, load existing plan from DB
            if conv_id and conv_id != "new":
                try:
                    _existing_msgs = conversation_service.get_messages(conv_id)
                    # Load existing todoList (plan with task statuses)
                    _existing_plan = latest_todo_list_from_messages(_existing_msgs)
                    if _existing_plan:
                        plan = _existing_plan
                        current_index, _ = compute_resume_index(plan)
                    # Load existing project_plan (architecture/spec)
                    for _msg in reversed(_existing_msgs):
                        _meta = _msg.get("metadata") or {}
                        if isinstance(_meta, str):
                            continue
                        _pp = _meta.get("planContent")
                        if _pp:
                            if isinstance(_pp, dict):
                                original_plan = _pp
                            elif isinstance(_pp, str):
                                try:
                                    original_plan = json.loads(_pp)
                                except Exception:
                                    original_plan = {}
                            break
                except Exception:
                    pass

        project_id = self._get_or_create_project_id(conv_id, request.get("project_id"))
        session_id = conv_id if conv_id != "new" else str(uuid.uuid4())
        mg = MemoryGateway(project_id=project_id, session_id=session_id)

        # Check if plan was actually approved before stopping
        _was_plan_approved = False
        if resume_build and conv_id and conv_id != "new":
            try:
                _check_msgs = conversation_service.get_messages(conv_id)
                for _cm in reversed(_check_msgs):
                    _cm_meta = _cm.get("metadata") or {}
                    if isinstance(_cm_meta, str):
                        continue
                    # Only "create_tasks" or "execute_sandbox" with actual task progress means plan was approved
                    # "stopped" does NOT mean approved — it means interrupted
                    _step = _cm_meta.get("agentStep")
                    _task_idx = _cm_meta.get("current_task_index", 0)
                    if _cm_meta.get("planApproved") and _step in ("create_tasks", "execute_sandbox"):
                        # Plan was approved AND tasks actually ran (index > 0 means at least one task completed)
                        if _step == "execute_sandbox" or (_step == "create_tasks" and _task_idx > 0):
                            _was_plan_approved = True
                            break
                        # create_tasks with index=0 means plan was just created but user never saw build start
                        # Don't treat as approved — let them review the plan
            except Exception:
                pass

        return {
            "user_id": request["user_id"],
            "conversation_id": conv_id,
            "content": original_content,
            "repo_url": request.get("repo_url"),
            "intent_confidence": 0.0,
            "plan": plan,
            "project_plan": original_plan,
            "project_report": "",
            "questions_data": {},
            "status": "starting",
            "messages": _loaded_messages,
            "leader_analysis": {},
            "plan_approved": bool(request.get("plan_approved")) or (resume_build and len(plan) > 0 and _was_plan_approved),
            "plan_feedback": None,
            "current_task_index": current_index,
            "executed_tasks": [],
            "current_job_id": conv_id if conv_id != "new" else request.get("current_job_id"),
            "model_id": request.get("model_id", os.getenv("DEFAULT_CHEAP_MODEL", "deepseek-chat")),
            "temperature": request.get("temperature", 0.3),
            "question_rounds": request.get("question_rounds", 0),
            "framework": normalize_framework(request.get("framework")),
            "resume_build": resume_build,
            "memory_gateway": mg,
            "memory_context": {},
        }

    async def process_chat(self, request: Dict[str, Any]) -> Dict[str, Any]:
        initial_state = self._prepare_initial_state(request)
        mg: MemoryGateway = initial_state.get("memory_gateway")
        if mg:
            initial_state["memory_context"] = await mg.build_agent_context("Leader")

        from Brain.utils.token_counter import token_counter_context, calculate_credits
        from Brain.modules.conversations.service import conversation_service

        try:
            with token_counter_context() as tokens_data:
                result = await self.workflow.ainvoke(initial_state)

                # Deduct credits spent during sync chat execution
                current_tokens = tokens_data["total_tokens"]
                credits_to_deduct = calculate_credits(current_tokens)
                if credits_to_deduct > 0:
                    user_id = initial_state.get("user_id")
                    conv_id = result.get("conversation_id")
                    conversation_service.deduct_credits(
                        user_id=user_id,
                        amount=credits_to_deduct,
                        reason="Brain chat execution",
                        reference_id=conv_id
                    )
                return result
        finally:
            if mg:
                mg.close_all()

    async def _run_builder_background(self, state, plan, conv_id, mg):
        """Phase 2: Run builder loop in background task (survives client disconnect)."""
        import asyncio
        import time as _bg_time
        _bg_start_time = _bg_time.time()
        # Register a per-conversation asyncio.Event for immediate stop signaling
        stop_event = asyncio.Event()
        self.STOP_EVENTS[str(conv_id)] = stop_event
        print(f"[CHAT-SERVICE] BG-TASK: Builder background task started | {len(plan)} tasks", flush=True)
        try:
            agent = BuilderAgent()
            last_completed_index = -1
            retry_count = {}
            MAX_RETRIES_PER_TASK = 1
            MAX_TOTAL_ITERATIONS = len(plan) * 3
            iteration_count = 0
            task_log_ids = {}

            while True:
                # --- Cooperative stop check (mid-task) ---
                if str(conv_id) in self.STOP_REGISTRY:
                    print(f"[CHAT-SERVICE] BG-TASK: STOP detected at task {state.get('current_task_index', 0)}/{len(plan)}", flush=True)
                    # Persist the stopped state FIRST so frontend sees it on reload
                    try:
                        conversation_service.save_message(
                            conv_id, "ASSISTANT",
                            "Build interrupted by user. Press Continue to resume from where it stopped.",
                            todo_list=list(plan),
                            sandbox_job=state.get("sandbox_job"),
                            metadata={
                                "agentStep": "stopped",
                                "planApproved": True,
                                "current_task_index": state.get("current_task_index", 0),
                                "durationSeconds": round(_bg_time.time() - _bg_start_time),
                            },
                        )
                        print(f"[CHAT-SERVICE] BG-TASK: Persisted stopped state at index {state.get('current_task_index', 0)}", flush=True)
                    except Exception as save_err:
                        print(f"[CHAT-SERVICE] BG-TASK: Failed to persist stopped state: {save_err}", flush=True)
                    # THEN broadcast WebSocket so frontend updates in real-time
                    try:
                        await ws_manager.broadcast_to_sandbox(str(conv_id), {
                            "type": "stopped",
                            "plan": plan,
                            "current_task_index": state.get("current_task_index", 0),
                        })
                    except Exception:
                        pass
                    return

                iteration_count += 1
                if iteration_count > MAX_TOTAL_ITERATIONS:
                    print(f"[CHAT-SERVICE] BG-TASK: SAFETY: Hit max iterations ({MAX_TOTAL_ITERATIONS}). Force completing.", flush=True)
                    for i in range(state.get("current_task_index", 0), len(plan)):
                        if plan[i].get("status") not in ("completed", "failed"):
                            plan[i]["status"] = "failed"
                            plan[i]["result"] = "Task skipped: global iteration limit reached"
                    state["current_task_index"] = len(plan)
                    # Notify via websocket so frontend knows build is done
                    try:
                        await ws_manager.broadcast_to_sandbox(str(conv_id), {
                            "type": "build_error",
                            "error": "Build exceeded maximum iterations. Some tasks were skipped.",
                            "plan": plan,
                        })
                    except Exception:
                        pass
                    break

                index = state.get("current_task_index", 0)
                if index >= len(plan):
                    break

                if index <= last_completed_index:
                    retries = retry_count.get(index, 0)
                    if retries >= MAX_RETRIES_PER_TASK:
                        print(f"[CHAT-SERVICE] BG-TASK: Task {index} failed after {MAX_RETRIES_PER_TASK} retries. Skipping.", flush=True)
                        if index < len(state.get("plan", [])):
                            state["plan"][index]["status"] = "failed"
                            state["plan"][index]["result"] = "Task failed after retries."
                        state["current_task_index"] = index + 1
                        retry_count[index] = 0
                        # Notify frontend via websocket about the failed task
                        try:
                            await ws_manager.broadcast_to_sandbox(str(conv_id), {
                                "type": "task_failed",
                                "task_index": index,
                                "reason": "Task failed after maximum retries",
                                "plan": plan,
                            })
                        except Exception:
                            pass
                        continue
                    else:
                        retry_count[index] = retries + 1
                        print(f"[CHAT-SERVICE] BG-TASK: Task {index} did not advance. Retry {retries + 1}/{MAX_RETRIES_PER_TASK}.", flush=True)

                current_task = plan[index] if index < len(plan) else {}
                print(f"[CHAT-SERVICE] BG-TASK: Executing task {index+1}/{len(plan)}: {current_task.get('title', 'N/A')} ({current_task.get('category', '?')})", flush=True)

                try:
                    async for ev in agent.execute(state):
                        # --- Cooperative stop check after each yield from builder ---
                        if str(conv_id) in self.STOP_REGISTRY:
                            print(f"[CHAT-SERVICE] BG-TASK: STOP detected during task {index+1} execution", flush=True)
                            # Persist FIRST
                            try:
                                conversation_service.save_message(
                                    conv_id, "ASSISTANT",
                                    "Build interrupted by user. Press Continue to resume from where it stopped.",
                                    todo_list=list(plan),
                                    sandbox_job=state.get("sandbox_job"),
                                    metadata={
                                        "agentStep": "stopped",
                                        "planApproved": True,
                                        "current_task_index": state.get("current_task_index", 0),
                                        "durationSeconds": round(_bg_time.time() - _bg_start_time),
                                    },
                                )
                            except Exception:
                                pass
                            # THEN broadcast
                            try:
                                await ws_manager.broadcast_to_sandbox(str(conv_id), {
                                    "type": "stopped",
                                    "plan": plan,
                                    "current_task_index": state.get("current_task_index", 0),
                                })
                            except Exception:
                                pass
                            return
                        if isinstance(ev, dict):
                            state.update(ev)
                        else:
                            state = ev
                except Exception as build_err:
                    print(f"[CHAT-SERVICE] BG-TASK: Builder error for task {index+1}: {type(build_err).__name__}: {build_err}", flush=True)
                    import traceback
                    traceback.print_exc()
                    if index < len(state.get("plan", [])):
                        state["plan"][index]["status"] = "failed"
                        state["plan"][index]["result"] = f"Builder error: {build_err}"
                    state["current_task_index"] = index + 1
                    # Notify frontend via websocket about the failed task
                    try:
                        await ws_manager.broadcast_to_sandbox(str(conv_id), {
                            "type": "task_failed",
                            "task_index": index,
                            "reason": f"{type(build_err).__name__}: {str(build_err)[:200]}",
                            "plan": plan,
                        })
                    except Exception:
                        pass

                last_completed_index = max(last_completed_index, state.get("current_task_index", 0) - 1)

                # --- Stop check after task completes ---
                if str(conv_id) in self.STOP_REGISTRY:
                    print(f"[CHAT-SERVICE] BG-TASK: STOP detected after task {index} completed", flush=True)
                    # Persist FIRST
                    try:
                        conversation_service.save_message(
                            conv_id, "ASSISTANT",
                            "Build interrupted by user. Press Continue to resume from where it stopped.",
                            todo_list=list(plan),
                            sandbox_job=state.get("sandbox_job"),
                            metadata={
                                "agentStep": "stopped",
                                "planApproved": True,
                                "current_task_index": state.get("current_task_index", 0),
                                "durationSeconds": round(_bg_time.time() - _bg_start_time),
                            },
                        )
                    except Exception:
                        pass
                    # THEN broadcast
                    try:
                        await ws_manager.broadcast_to_sandbox(str(conv_id), {
                            "type": "stopped",
                            "plan": plan,
                            "current_task_index": state.get("current_task_index", 0),
                        })
                    except Exception:
                        pass
                    return

                # Persist per-task progress so polling-based UIs advance too
                # (WebSocket missing/broken → 5s poll of /brain/conversations/{id}
                # only sees DB messages; init_sandbox index=0 stays stuck otherwise).
                new_index = state.get("current_task_index", 0)
                if new_index > index:
                    try:
                        # Extract file list from executed_tasks for left-side narration
                        executed_tasks = state.get("executed_tasks", [])
                        latest_task = executed_tasks[-1] if executed_tasks else {}
                        task_output = latest_task.get("output", "")

                        # Get detailed file saves from mcp_tools accumulator
                        from Brain.agents.builder.mcp_tools import get_task_file_saves
                        file_saves = get_task_file_saves()

                        files_str = ""
                        if file_saves:
                            # Build detailed file list: "Created a.js (+45 lines), Edited b.js (+12, -3 lines)"
                            parts = []
                            for fs in file_saves:
                                detail = f"{fs['action']} {fs['path']}"
                                if fs['linesAdded'] or fs['linesRemoved']:
                                    detail += f" (+{fs['linesAdded']}, -{fs['linesRemoved']})"
                                parts.append(detail)
                            files_str = "\n" + "\n".join(f"  {p}" for p in parts)
                        elif "Files saved:" in task_output:
                            files_section = task_output.split("Files saved:")[1].split("\n")[0].strip()
                            if files_section:
                                files_str = f"\n  {files_section}"

                        task_title = plan[index].get("title", f"Task {index + 1}")
                        task_status = plan[index].get("status", "completed")

                        if task_status == "failed":
                            result_msg = plan[index].get("result", "Unknown error")
                            msg_content = f"❌ Task {index + 1}/{len(plan)}: {task_title} — FAILED: {result_msg[:120]}"
                        else:
                            msg_content = f"✅ Task {index + 1}/{len(plan)}: {task_title}{files_str}\n→ Moving to task {new_index + 1}/{len(plan)}."

                        # NOTE: todo_list included for progress tracking (right-side task list),
                        # but frontend should only render the task-list widget in the original
                        # plan message (agentStep="create_tasks"), not in every per-task entry.
                        conversation_service.save_message(
                            conv_id, "ASSISTANT", msg_content,
                            todo_list=list(plan),
                            metadata={"agentStep": "execute_sandbox", "planApproved": True, "current_task_index": new_index},
                        )
                        print(f"[CHAT-SERVICE] BG-TASK: Saved progress msg for task {new_index}/{len(plan)}", flush=True)
                    except Exception as save_progress_err:
                        print(f"[CHAT-SERVICE] BG-TASK: progress save error: {save_progress_err}", flush=True)

                if mg:
                    try:
                        asyncio.create_task(
                            mg.short_term.append("assistant", f"Task {index+1} completed", "builder")
                        )
                    except RuntimeError:
                        pass

            # Execute Validation Gate if not already completed
            if state.get("status") not in ("validation_passed", "validation_failed"):
                # Stop check before validation gate
                if str(conv_id) in self.STOP_REGISTRY:
                    print(f"[CHAT-SERVICE] BG-TASK: STOP detected before Validation Gate", flush=True)
                    try:
                        conversation_service.save_message(
                            conv_id, "ASSISTANT",
                            "Build interrupted by user. Press Continue to resume from where it stopped.",
                            todo_list=list(plan),
                            sandbox_job=state.get("sandbox_job"),
                            metadata={
                                "agentStep": "stopped",
                                "planApproved": True,
                                "current_task_index": state.get("current_task_index", 0),
                                "durationSeconds": round(_bg_time.time() - _bg_start_time),
                            },
                        )
                    except Exception:
                        pass
                    try:
                        await ws_manager.broadcast_to_sandbox(str(conv_id), {
                            "type": "stopped",
                            "plan": plan,
                            "current_task_index": state.get("current_task_index", 0),
                        })
                    except Exception:
                        pass
                    return

                print(f"[CHAT-SERVICE] BG-TASK: All tasks finished — executing Validation Gate", flush=True)
                from Brain.agents.builder.validation_gate import ValidationGate
                val_gate = ValidationGate(agent.llm, conv_id, user_id=state.get("user_id"))
                val_res = await val_gate.run_validation_and_repair(state)
                if val_res.get("passed"):
                    state["status"] = "validation_passed"
                else:
                    state["status"] = "validation_failed"
                    attempts_used = val_res.get("attempts", "?")
                    state["run_report"] = f"Build validation failed after {attempts_used} repair attempts. Errors: {val_res.get('errors')}"

            # Check if validation passed before triggering Runner phase
            if state.get("status") == "validation_failed":
                print(f"[CHAT-SERVICE] BG-TASK: Build Validation FAILED — proceeding to runner/sandbox anyway so user can view and follow up", flush=True)
                report = state.get("run_report") or "Build validation failed after repair attempts. Proceeding to sandbox for review."
                conversation_service.save_message(
                    conv_id, "ASSISTANT", report,
                    todo_list=list(plan),
                    sandbox_job=state.get("sandbox_job"),
                    metadata={"agentStep": "validation_failed", "planApproved": True, "current_task_index": len(plan)}
                )

            # Mark all remaining tasks as completed
            for t in plan:
                if t.get("status") not in ("completed", "failed"):
                    t["status"] = "completed"

            # Runner phase
            # Stop check before runner
            if str(conv_id) in self.STOP_REGISTRY:
                print(f"[CHAT-SERVICE] BG-TASK: STOP detected before Runner", flush=True)
                try:
                    conversation_service.save_message(
                        conv_id, "ASSISTANT",
                        "Build interrupted by user. Press Continue to resume from where it stopped.",
                        todo_list=list(plan),
                        sandbox_job=state.get("sandbox_job"),
                        metadata={
                            "agentStep": "stopped",
                            "planApproved": True,
                            "current_task_index": state.get("current_task_index", 0),
                            "durationSeconds": round(_bg_time.time() - _bg_start_time),
                        },
                    )
                except Exception:
                    pass
                try:
                    await ws_manager.broadcast_to_sandbox(str(conv_id), {
                        "type": "stopped",
                        "plan": plan,
                        "current_task_index": state.get("current_task_index", 0),
                    })
                except Exception:
                    pass
                return

            print(f"[CHAT-SERVICE] BG-TASK: All tasks & validation passed — running runner", flush=True)
            runner = RunnerAgent()
            runner_state = state
            async for ev in runner.execute(state):
                if isinstance(ev, dict):
                    runner_state = ev

            tasks = runner_state.get("plan", plan)
            for t in tasks:
                if t.get("status") == "failed":
                    continue
                t["status"] = "completed"

            report = runner_state.get("run_report") or "Build complete."
            conversation_service.save_message(
                conv_id, "ASSISTANT", report,
                todo_list=list(tasks),
                sandbox_job=state.get("sandbox_job"),
                metadata={"agentStep": "final_report", "planApproved": True, "current_task_index": len(tasks)}
            )

            print(f"[CHAT-SERVICE] BG-TASK: BUILD COMPLETE for {conv_id}", flush=True)

        except Exception as e:
            print(f"[CHAT-SERVICE] BG-TASK: FATAL ERROR: {type(e).__name__}: {e}", flush=True)
            import traceback
            traceback.print_exc()
        finally:
            # Cleanup: remove the stop event for this conversation
            self.STOP_EVENTS.pop(str(conv_id), None)

    def stop_execution(self, conversation_id: str):
        """Stops an active conversation execution. Kills sandbox only if no tunnel URL (still deploying)."""
        self.STOP_REGISTRY.add(conversation_id)
        # Signal the event so any awaiting coroutine wakes up immediately
        evt = self.STOP_EVENTS.get(conversation_id)
        if evt:
            evt.set()

        # Kill the sandbox ONLY if it has no tunnel URL (still building/deploying)
        try:
            self._kill_sandbox_on_stop(conversation_id)
        except Exception as e:
            print(f"[CHAT-SERVICE] WARN: Failed to kill sandbox on stop for {conversation_id}: {e}", flush=True)

        return {"status": "stopping", "conversation_id": conversation_id}

    def _kill_sandbox_on_stop(self, conversation_id: str):
        """Kill the sandbox only if it's still deploying (no tunnel URL yet)."""
        import asyncio

        # Retrieve sandbox_job from conversation messages
        messages = conversation_service.get_messages(str(conversation_id))
        sandbox_job = None
        for m in reversed(messages):
            sj = m.get("sandboxJob")
            if sj and isinstance(sj, dict) and sj.get("job_id"):
                sandbox_job = sj
                break

        if not sandbox_job:
            print(f"[CHAT-SERVICE] No sandbox_job found for {conversation_id}, nothing to kill", flush=True)
            return

        session_id = sandbox_job.get("job_id")
        if not session_id:
            return

        # If tunnel URL exists → sandbox is live and running → DON'T kill it
        tunnel_url = sandbox_job.get("tunnel_url") or sandbox_job.get("stream_url")
        if tunnel_url:
            print(f"[CHAT-SERVICE] Sandbox has live tunnel URL ({session_id}), NOT killing — letting it finish", flush=True)
            return

        # Also check the in-memory tunnel store as a fallback
        sandbox_mcp = get_sandbox_mcp_service()
        existing_tunnel = sandbox_mcp.get_tunnel_url(str(session_id))
        if existing_tunnel:
            print(f"[CHAT-SERVICE] Sandbox has live tunnel in memory ({session_id}), NOT killing", flush=True)
            return

        # No tunnel URL → still deploying → kill it
        print(f"[CHAT-SERVICE] Sandbox has NO tunnel URL ({session_id}), killing deployment", flush=True)

        async def _do_delete():
            try:
                await sandbox_mcp.initialize()
                result = await sandbox_mcp.delete_sandbox(str(session_id))
                print(f"[CHAT-SERVICE] Sandbox killed on stop: {session_id} | {result}", flush=True)
            except Exception as e:
                print(f"[CHAT-SERVICE] WARN: Sandbox delete failed for {session_id}: {e}", flush=True)

        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                loop.create_task(_do_delete())
            else:
                loop.run_until_complete(_do_delete())
        except RuntimeError:
            asyncio.ensure_future(_do_delete())

    def get_sandbox_files(self, conversation_id: str, user_id: str = None):
        """Returns the file tree for a given conversation workspace (disk mirror)."""
        host_path = workspace_manager.resolve_workspace_path(conversation_id, user_id=user_id)
        if not host_path:
            return []
        sandbox_path = host_path
        print(f"DEBUG: get_sandbox_files searching in: {sandbox_path}")

        if not os.path.exists(sandbox_path):
            print(f"DEBUG: get_sandbox_files - path NOT FOUND: {sandbox_path}")
            return []

        def build_tree(current_path, rel_path="", depth=0):
            if depth > 10: return []
            tree = []
            try:
                for item in os.listdir(current_path):
                    if item in ["node_modules", ".git", "__pycache__", ".next", "dist", "build"]:
                        continue

                    full_path = os.path.join(current_path, item)
                    if os.path.islink(full_path): continue

                    item_rel_path = os.path.join(rel_path, item).replace("\\", "/")

                    if os.path.isdir(full_path):
                        tree.append({
                            "name": item,
                            "type": "folder",
                            "path": item_rel_path,
                            "children": build_tree(full_path, item_rel_path, depth + 1)
                        })
                    else:
                        tree.append({
                            "name": item,
                            "type": "file",
                            "path": item_rel_path
                        })
            except Exception as e:
                print(f"Error building tree for {current_path}: {e}")
            return tree

        return build_tree(sandbox_path)

_brain_chat_service = None
def get_brain_chat_service():
    global _brain_chat_service
    if _brain_chat_service is None:
        _brain_chat_service = BrainChatService()
    return _brain_chat_service
