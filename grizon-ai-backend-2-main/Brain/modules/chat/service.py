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
from Brain.services.workspace_manager import workspace_manager, RUNTIME_WEBCONTAINER
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

class BrainChatService:
    def __init__(self):
        self.workflow = self._create_workflow()
        self.STOP_REGISTRY = set()

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
        
        graph.add_edge("recursive_clarify", END)
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
        if state.get("resume_build") and state.get("plan"):
            return "resume"
        status = state.get("status")
        if status == "needs_clarification":
            return "clarify"
        if state.get("plan_approved"):
            return "taskify"
        return "plan"

    def should_continue_building(self, state: BrainState):
        tasks = state.get("plan", [])
        index = state.get("current_task_index", 0)
        print(f"DEBUG: Router check - Task Index: {index}/{len(tasks)}")
        
        if index < len(tasks):
            return "continue"
        return "complete"

    # --- Nodes ---

    async def node_manager(self, state: BrainState) -> Dict[str, Any]:
        if state.get("resume_build"):
            return {"status": "plan_approved", "plan_approved": True, "resume_build": True}

        content = state.get("content", "").lower()
        if "approve" in content or "✅ plan approved" in content:
            return {"status": "plan_approved", "plan_approved": True}
        
        # If there's an existing plan and it hasn't been approved, treat this input as feedback
        if state.get("project_plan") and state.get("plan_approved") is False:
            thoughts = f"The user provided feedback on the plan: '{state.get('content', '')}'. Updating the requirements and calling the **Planner Agent** to revise the technical roadmap."
            return {
                "status": "ready_to_plan", 
                "plan_feedback": state["content"],
                "leader_analysis": {"analysis": thoughts},
                "thoughts": thoughts
            }

        agent = ManagerAgent()
        result = await agent.execute(state)
        print("DEBUG: NODE [analyze_ingress] complete")
        return result

    async def node_clarifier(self, state: BrainState) -> Dict[str, Any]:
        print("DEBUG: NODE [recursive_clarify] started")
        agent = QuestionsAgent()
        state = await agent.execute(state)
        state["report"] = f"__CLARIFY__:{json.dumps(state.get('questions_data'))}"
        print("DEBUG: NODE [recursive_clarify] complete")
        return state

    async def node_planner(self, state: BrainState) -> Dict[str, Any]:
        print("DEBUG: NODE [strategic_plan] started")
        agent = PlannerAgent()
        state = await agent.execute(state)
        state["report"] = state.get("project_report")
        print("DEBUG: NODE [strategic_plan] complete")
        return state

    async def node_todo(self, state: BrainState) -> Dict[str, Any]:
        print("DEBUG: NODE [create_tasks] started")
        agent = TodoAgent()
        state = await agent.execute(state)
        # TodoAgent returns tasks in state['tasks'], but Builder expects state['plan']
        state["plan"] = state.get("tasks", [])
        state["report"] = f"✅ I've broken down the project into {len(state['plan'])} executable tasks. Starting the build process now..."
        print("DEBUG: NODE [create_tasks] complete")
        return state

    async def node_init_sandbox(self, state: BrainState) -> Dict[str, Any]:
        """Initializes the WebContainer workspace (browser runtime)."""
        print("DEBUG: NODE [init_sandbox] started")
        if not state.get("current_job_id"):
            print(f"DEBUG: Creating workspace for conversation {state['conversation_id']}")
            cid = workspace_manager.create_workspace(name=state["conversation_id"])
            state["current_job_id"] = cid
            if isinstance(cid, str) and cid.startswith("error:"):
                print(f"ERROR: Workspace creation failed: {cid}")
                return {
                    "status": "error",
                    "error_msg": cid,
                    "report": f"❌ Workspace error: {cid}"
                }

        job_id = state["current_job_id"]
        framework = normalize_framework(state.get("framework"))

        if state.get("resume_build"):
            payload = get_resume_payload(
                job_id,
                framework=framework,
                todos=state.get("plan", []),
            )
            bootstrap_ops = payload.get("workspace_ops") or []
            progress_msg = f"[TEMPLATE] Restored {len(bootstrap_ops)} files from workspace"
        else:
            bootstrap_ops = apply_templates_to_workspace(job_id, framework)
            progress_msg = f"[TEMPLATE] Loaded express, supabase, and {framework} frontend template"

        sandbox_job = {
            "job_id": job_id,
            "runtime": RUNTIME_WEBCONTAINER,
            "framework": framework,
            "sync_url": f"ws://localhost:8001/brain/sandbox/sync/{job_id}",
            "await_preview": True,
        }

        template_activities = [
            {
                "id": "tpl-express",
                "type": "template",
                "label": "Read express-template → backend/",
                "status": "done",
                "timestamp": int(__import__("time").time() * 1000),
            },
            {
                "id": "tpl-supabase",
                "type": "template",
                "label": "Read supabase-template → backend/supabase/",
                "status": "done",
                "timestamp": int(__import__("time").time() * 1000),
            },
            {
                "id": "tpl-frontend",
                "type": "template",
                "label": f"Loaded {framework} frontend template",
                "status": "done",
                "timestamp": int(__import__("time").time() * 1000),
            },
            {
                "id": "tpl-sync",
                "type": "sync",
                "label": "Syncing project files to WebContainer",
                "status": "running",
                "timestamp": int(__import__("time").time() * 1000),
            },
        ]

        print(f"DEBUG: NODE [init_sandbox] complete - Job: {job_id}, framework: {framework}")
        return {
            "current_job_id": job_id,
            "framework": framework,
            "sandbox_job": sandbox_job,
            "execute_sandbox": {
                "sandbox_job": sandbox_job,
                "workspace_ops": bootstrap_ops,
                "activities": template_activities,
                "plan": state.get("plan", []),
                "status": "building",
                "progress_msg": f"[TEMPLATE] Bootstrapped {framework} stack",
            },
            "status": "building",
            "report": f"🚀 WebContainer ready ({framework}). Express + Supabase + frontend template loaded.",
        }

    async def node_execute_sandbox(self, state: BrainState) -> Dict[str, Any]:
        """Executes the next task in the build plan."""
        print("DEBUG: NODE [execute_sandbox] started")
        tasks = state.get("plan", [])
        index = state.get("current_task_index", 0)
        sandbox_job = state.get("sandbox_job")
        
        if index >= len(tasks):
            return {"status": "building_complete"}

        agent = BuilderAgent()
        print(f"DEBUG: Starting agent.execute for Task {index+1}/{len(tasks)}")
        
        last_event = {}
        accumulated_ops: List[Dict[str, Any]] = []
        accumulated_activities: List[Dict[str, Any]] = []
        async for event in agent.execute(state):
            if isinstance(event, dict):
                if event.get("execute_sandbox"):
                    exe = event["execute_sandbox"]
                    if exe.get("workspace_ops"):
                        accumulated_ops.extend(exe["workspace_ops"])
                    if exe.get("activities"):
                        accumulated_activities.extend(exe["activities"])
                    last_event = event
                else:
                    last_event = event
            else:
                state = event

        # Final state after one task execution
        tasks = state.get("plan", [])
        index = state.get("current_task_index", 0)
        
        # index = next task to run (builder increments after each task)
        for i, task in enumerate(tasks):
            if task.get("status") == "failed":
                continue
            if index >= len(tasks):
                if task.get("category") == "runner":
                    task["status"] = "pending"
                else:
                    task["status"] = "completed"
            elif i < index:
                task["status"] = "completed"
            elif i == index:
                task["status"] = "executing"
            else:
                task["status"] = "pending"
            
        exe_payload = last_event.get("execute_sandbox", {})
        if sandbox_job:
            exe_payload["sandbox_job"] = sandbox_job
        if accumulated_ops:
            exe_payload["workspace_ops"] = accumulated_ops
        if accumulated_activities:
            exe_payload["activities"] = accumulated_activities
        exe_payload["plan"] = tasks

        return {
            "plan": tasks,
            "current_task_index": index,
            "executed_tasks": state.get("executed_tasks", []),
            "status": state.get("status"),
            "current_job_id": state.get("current_job_id"),
            "sandbox_job": sandbox_job,
            "execute_sandbox": exe_payload
        }

    async def node_runner(self, state: BrainState) -> Dict[str, Any]:
        print("DEBUG: NODE [runner] started")
        agent = RunnerAgent()
        state = await agent.execute(state)
        
        sandbox_job = state.get("sandbox_job")
        runner_exe = state.get("execute_sandbox") or {}

        tasks = list(state.get("plan", []))
        for t in tasks:
            if t.get("status") == "failed":
                continue
            t["status"] = "completed"

        return {
            "status": "complete",
            "report": state.get("run_report"),
            "plan": tasks,
            "current_task_index": len(tasks),
            "execute_sandbox": {
                "sandbox_job": sandbox_job,
                "plan": tasks,
                "status": "complete",
                "workspace_ops": runner_exe.get("workspace_ops", []),
                "progress_msg": runner_exe.get("progress_msg"),
            },
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

    def _save_phase_message(self, conv_id: str, state: Dict[str, Any], node_name: str):
        """Save a phase message to the conversation DB."""
        report = state.get("report") or state.get("progress_msg") or ""
        leader_analysis = state.get("leader_analysis") or {}
        thoughts = state.get("thoughts") or leader_analysis.get("analysis") or leader_analysis.get("report") or ""
        todo_list = state.get("plan")
        sandbox_job = state.get("sandbox_job")
        metadata = {
            "planContent": state.get("project_plan"),
            "agentStep": node_name,
            "questions_data": state.get("questions_data"),
            "planApproved": state.get("plan_approved", False),
            "thoughts": thoughts
        }
        conversation_service.save_message(
            conv_id, "ASSISTANT", report,
            todo_list=todo_list if isinstance(todo_list, list) else None,
            sandbox_job=sandbox_job,
            metadata=metadata
        )

        mg: MemoryGateway = state.get("memory_gateway")
        if mg:
            import asyncio
            try:
                asyncio.get_event_loop().create_task(
                    mg.short_term.append("assistant", report or "", node_name)
                )
            except RuntimeError:
                pass

        # Update session workflow state based on node
        if mg:
            wf_state, agent = self._node_to_workflow_state(node_name, state)
            try:
                asyncio.get_event_loop().create_task(
                    mg.session.update_workflow_state(wf_state, agent)
                )
            except RuntimeError:
                pass

        # Store decisions in memory when plan is approved
        if mg and node_name == "strategic_plan" and state.get("plan_approved"):
            project_plan = state.get("project_plan") or {}
            fp = project_plan.get("frontend") or project_plan.get("framework") or state.get("framework", "react")
            decisions = {
                "frontend": fp,
                "backend": project_plan.get("backend") or "node",
                "database": project_plan.get("database") or "supabase",
            }
            mg.decisions.store_approved_decisions(mg.project_id, decisions)

            # Store plan in long-term memory
            plan_text = json.dumps(todo_list) if todo_list else report
            mg.long_term.store(mg.project_id, "plan", plan_text, {"conv_id": conv_id})



    async def process_chat_stream(self, request: Dict[str, Any]) -> AsyncGenerator[str, None]:
        initial_state = self._prepare_initial_state(request)
        
        conv_id, _ = conversation_service.ensure_brain_persistence(initial_state)
        initial_state["conversation_id"] = conv_id
        initial_state["messages"] = conversation_service.get_messages(conv_id)

        mg: MemoryGateway = initial_state.get("memory_gateway")
        if mg:
            initial_state["memory_context"] = await mg.build_agent_context("Leader")

        # Initialize session on start
        if mg:
            import asyncio as _asyncio
            try:
                _asyncio.get_event_loop().create_task(
                    mg.session.set("started_at", datetime.utcnow().isoformat())
                )
                _asyncio.get_event_loop().create_task(
                    mg.session.set("project_id", mg.project_id)
                )
                _asyncio.get_event_loop().create_task(
                    mg.session.update_workflow_state("starting", "LeaderAgent")
                )
            except RuntimeError:
                pass

        state = initial_state
        try:
            # Phase 1: LangGraph workflow up to init_sandbox
            async for event in self.workflow.astream(initial_state):
                if initial_state["conversation_id"] in self.STOP_REGISTRY:
                    yield "data: " + json.dumps({"status": "stopped"}) + "\n\n"
                    break

                yield f"data: {json.dumps(_sanitize_for_json(event))}\n\n"

                for node_name, node_data in event.items():
                    initial_state.update(node_data)
                    report = node_data.get("report") or node_data.get("progress_msg")
                    if node_name == "init_sandbox":
                        self._save_phase_message(conv_id, initial_state, node_name)

                    if report or node_name in ("recursive_clarify", "strategic_plan"):
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
                        metadata = {
                            "planContent": initial_state.get("project_plan"),
                            "agentStep": node_name,
                            "questions_data": initial_state.get("questions_data"),
                            "planApproved": initial_state.get("plan_approved", False),
                            "thoughts": thoughts,
                        }
                        conversation_service.save_message(
                            conv_id, "ASSISTANT", report or "",
                            todo_list=todo_list if isinstance(todo_list, list) else None,
                            sandbox_job=sandbox_job,
                            metadata=metadata
                        )
                        if mg:
                            import asyncio
                            try:
                                asyncio.get_event_loop().create_task(
                                    mg.short_term.append("assistant", report or "", node_name)
                                )
                            except RuntimeError:
                                pass

            # Phase 2: Stream execute_sandbox events individually if plan exists
            plan = state.get("plan", [])
            task_log_ids = {}
            if plan and state.get("plan_approved", False):
                if mg:
                    import asyncio as _asyncio2
                    try:
                        _asyncio2.get_event_loop().create_task(
                            mg.session.update_workflow_state("building", "BuilderAgent")
                        )
                    except RuntimeError:
                        pass
                agent = BuilderAgent()
                
                while True:
                    index = state.get("current_task_index", 0)
                    if index >= len(plan):
                        break
                    
                    # Start execution log for this task
                    if mg and index not in task_log_ids:
                        task = plan[index]
                        log = mg.execution.start_task(
                            mg.project_id,
                            task.get("label", f"Task {index}"),
                            "BuilderAgent",
                            todo_id=task.get("id")
                        )
                        task_log_ids[index] = log.id
                    
                    # Run builder for one task — stream each event
                    async for ev in agent.execute(state):
                        if isinstance(ev, dict):
                            if ev.get("execute_sandbox"):
                                exe = ev["execute_sandbox"]
                                exe["plan"] = plan
                                exe["current_task_index"] = index
                                yield f"data: {json.dumps({'execute_sandbox': _sanitize_for_json(exe)})}\n\n"

                                # Register artifacts from workspace_ops
                                if mg and exe.get("workspace_ops"):
                                    for op in exe["workspace_ops"]:
                                        if op.get("op") in ("create_file", "write_file"):
                                            path = op.get("path", "")
                                            if path:
                                                try:
                                                    mg.artifacts.register(mg.project_id, {
                                                        "name": path.split("/")[-1],
                                                        "filePath": path,
                                                        "type": "component",
                                                        "createdBy": "BuilderAgent",
                                                    })
                                                except Exception as artifact_err:
                                                    print(f"DEBUG: artifact register skipped ({artifact_err})")
                            else:
                                state.update(ev)
                        else:
                            state = ev

                    # Update session with current task progress
                    if mg:
                        import asyncio as _asyncio3
                        try:
                            current_task = plan[index] if index < len(plan) else {}
                            _asyncio3.get_event_loop().create_task(
                                mg.session.set("current_task_id", current_task.get("id", f"task_{index}"))
                            )
                            _asyncio3.get_event_loop().create_task(
                                mg.session.set("current_task_label", current_task.get("label", ""))
                            )
                            _asyncio3.get_event_loop().create_task(
                                mg.session.set("task_index", index)
                            )
                            _asyncio3.get_event_loop().create_task(
                                mg.session.set("total_tasks", len(plan))
                            )
                        except RuntimeError:
                            pass

                    # Complete execution log
                    if mg and index in task_log_ids:
                        mg.execution.complete_task(task_log_ids[index])
                    
                    # Save message with updated plan after each task
                    sandbox_job = state.get("sandbox_job")
                    report = state.get("report") or ""
                    leader_analysis = state.get("leader_analysis") or {}
                    thoughts = state.get("thoughts") or leader_analysis.get("analysis") or ""
                    metadata = {
                        "planContent": state.get("project_plan"),
                        "agentStep": "execute_sandbox",
                        "planApproved": True,
                        "thoughts": thoughts,
                    }
                    conversation_service.save_message(
                        conv_id, "ASSISTANT", report,
                        todo_list=list(plan),
                        sandbox_job=sandbox_job,
                        metadata=metadata
                    )
                    if mg:
                        import asyncio
                        try:
                            asyncio.get_event_loop().create_task(
                                mg.short_term.append("assistant", report or "", "execute_sandbox")
                            )
                        except RuntimeError:
                            pass
                
                # Phase 3: Runner (final report)
                runner = RunnerAgent()
                runner_state = await runner.execute(state)
                tasks = runner_state.get("plan", plan)
                sandbox_job = state.get("sandbox_job")
                runner_exe = runner_state.get("execute_sandbox") or {}
                for t in tasks:
                    if t.get("status") == "failed":
                        continue
                    t["status"] = "completed"
                
                # Mark session as complete
                if mg:
                    import asyncio as _asyncio4
                    try:
                        _asyncio4.get_event_loop().create_task(
                            mg.session.update_workflow_state("done", "RunnerAgent")
                        )
                    except RuntimeError:
                        pass

                # Store architecture pattern in memory on success
                if mg:
                    mg.architecture.record_usage(
                        {"frontend": state.get("framework", "react"), "backend": "node", "database": "supabase"},
                        mg.project_id,
                        succeeded=True
                    )
                    # Store final report in long-term memory
                    final_report_text = runner_state.get("run_report") or ""
                    if final_report_text:
                        mg.long_term.store(mg.project_id, "review", final_report_text, {"conv_id": conv_id})
                
                final_payload = {
                    "execute_sandbox": {
                        "sandbox_job": sandbox_job,
                        "plan": tasks,
                        "status": "complete",
                        "workspace_ops": runner_exe.get("workspace_ops", []),
                        "progress_msg": runner_exe.get("progress_msg"),
                    },
                    "plan": tasks,
                    "status": "complete",
                    "report": runner_state.get("run_report"),
                }
                yield f"data: {json.dumps({'final_report': _sanitize_for_json(final_payload)})}\n\n"
                
                report = runner_state.get("run_report") or ""
                metadata = {
                    "planContent": state.get("project_plan"),
                    "agentStep": "final_report",
                    "planApproved": True,
                }
                conversation_service.save_message(
                    conv_id, "ASSISTANT", report,
                    todo_list=list(tasks),
                    sandbox_job=sandbox_job,
                    metadata=metadata
                )
                if mg:
                    import asyncio
                    try:
                        asyncio.get_event_loop().create_task(
                            mg.short_term.append("assistant", report or "", "final_report")
                        )
                    except RuntimeError:
                        pass
                    
        except Exception as e:
            print(f"ERROR in stream: {e}")
            if mg:
                import asyncio as _asyncio5
                try:
                    _asyncio5.get_event_loop().create_task(
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
            if mg:
                mg.close_all()
            yield "event: end\ndata: {}\n\n"

    def _get_or_create_project_id(self, conv_id: str) -> str:
        if conv_id and conv_id != "new":
            try:
                uuid.UUID(conv_id)
                bp = SessionLocal().query(BrainProject).filter(BrainProject.conversationId == conv_id).first()
                if bp:
                    return str(bp.id)
            except (ValueError, AttributeError):
                pass
        return str(uuid.uuid4())

    def _prepare_initial_state(self, request: Dict[str, Any]) -> BrainState:
        conv_id = request.get("conversation_id") or "new"
        resume_build = bool(request.get("resume_build"))
        plan: List[Dict[str, Any]] = []
        current_index = 0

        if resume_build and conv_id and conv_id != "new":
            messages = conversation_service.get_messages(conv_id)
            plan = latest_todo_list_from_messages(messages)
            current_index, _ = compute_resume_index(plan)

        project_id = self._get_or_create_project_id(conv_id)
        session_id = conv_id if conv_id != "new" else str(uuid.uuid4())
        mg = MemoryGateway(project_id=project_id, session_id=session_id)

        return {
            "user_id": request["user_id"],
            "conversation_id": conv_id,
            "content": request.get("content") or "",
            "repo_url": request.get("repo_url"),
            "intent_confidence": 0.0,
            "plan": plan,
            "project_plan": request.get("approved_plan") or {},
            "project_report": "",
            "questions_data": {},
            "status": "starting",
            "messages": [],
            "leader_analysis": {},
            "plan_approved": bool(request.get("plan_approved")) or resume_build,
            "plan_feedback": None,
            "current_task_index": current_index,
            "executed_tasks": [],
            "current_job_id": conv_id if conv_id != "new" else request.get("current_job_id"),
            "model_id": request.get("model_id", "deepseek-chat"),
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
        try:
            result = await self.workflow.ainvoke(initial_state)
            return result
        finally:
            if mg:
                mg.close_all()

    def stop_execution(self, conversation_id: str):
        """Stops an active conversation execution."""
        self.STOP_REGISTRY.add(conversation_id)
        return {"status": "stopping", "conversation_id": conversation_id}

    def get_sandbox_files(self, conversation_id: str):
        """Returns the file tree for a given conversation workspace (disk mirror)."""
        host_path = workspace_manager.resolve_workspace_path(conversation_id)
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
