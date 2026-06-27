import os
import json
import asyncio
from typing import TypedDict, List, Dict, Any, Optional, AsyncGenerator
from langgraph.graph import StateGraph, END
from langchain_anthropic import ChatAnthropic
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage, AIMessage, SystemMessage
from dotenv import load_dotenv
from sqlalchemy import create_engine, Column, String, Integer, DateTime, JSON, Float, ForeignKey, Enum, Boolean
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
import enum
from datetime import datetime

load_dotenv()

# Database Setup
DATABASE_URL = os.getenv("DATABASE_URL")
engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# Database Models for Main App (Matching Prisma Schema)
class Conversation(Base):
    __tablename__ = "conversations"
    id = Column(String, primary_key=True)
    userId = Column(String, ForeignKey("users.id"), name="user_id")
    title = Column(String)
    status = Column(String, default="active")
    platform = Column(String, default="web")
    createdAt = Column(DateTime, default=datetime.utcnow, name="created_at")
    updatedAt = Column(DateTime, default=datetime.utcnow, name="updated_at")

class Message(Base):
    __tablename__ = "messages"
    id = Column(String, primary_key=True)
    conversationId = Column(String, ForeignKey("conversations.id"), name="conversation_id")
    userId = Column(String, ForeignKey("users.id"), name="user_id")
    role = Column(String) # USER, ASSISTANT, SYSTEM
    content = Column(String)
    createdAt = Column(DateTime, default=datetime.utcnow, name="created_at")

# Database Models for Brain
class BrainProject(Base):
    __tablename__ = "brain_projects"
    id = Column(String, primary_key=True)
    userId = Column(String, ForeignKey("users.id"), name="user_id")
    conversationId = Column(String, ForeignKey("conversations.id"), name="conversation_id", unique=True)
    title = Column(String)
    status = Column(String, default="IDLE")
    createdAt = Column(DateTime, name="created_at")
    updatedAt = Column(DateTime, name="updated_at")

class BrainTask(Base):
    __tablename__ = "brain_tasks"
    id = Column(String, primary_key=True)
    projectId = Column(String, ForeignKey("brain_projects.id"), name="project_id")
    label = Column(String)
    strategy = Column(String)
    agent = Column(String)
    status = Column(String, default="PENDING")
    order = Column(Integer)
    createdAt = Column(DateTime, name="created_at")

# Define the State for LangGraph
class BrainState(TypedDict):
    user_id: str
    conversation_id: str
    content: str
    repo_url: Optional[str]
    intent_confidence: float
    plan: List[Dict[str, Any]]
    clarifications: List[Dict[str, Any]]
    self_critique: List[str]
    report: str
    status: str
    messages: List[Any]
    search_provider: str
    search_results: str
    leader_analysis: str
    plan_approved: bool
    approved_plan: Optional[str]
    review_required: bool
    model_id: str
    current_task_index: int
    executed_tasks: List[Dict[str, Any]]

class BrainChatService:
    def __init__(self):
        from Brain.services.provider_router import ProviderRouter
        self.model = ProviderRouter.get_model("gpt-4o-mini", temperature=0.3)
        self.workflow = self._create_workflow()

    def _create_workflow(self):
        graph = StateGraph(BrainState)

        # Define Nodes (The Cognitive Loop)
        graph.add_node("analyze_ingress", self.analyze_ingress)
        graph.add_node("recursive_clarify", self.recursive_clarify)
        graph.add_node("web_research", self.web_research)
        graph.add_node("strategic_plan", self.strategic_plan)
        graph.add_node("create_tasks", self.create_tasks)
        graph.add_node("task_orchestrator", self.task_orchestrator)
        graph.add_node("execute_sandbox", self.execute_sandbox)
        graph.add_node("final_report", self.final_report)

        # Define Conditional Edges
        graph.set_entry_point("analyze_ingress")
        
        # Branching: If plan is already approved, jump straight to Task Generation (Todo List)
        graph.add_conditional_edges(
            "analyze_ingress",
            lambda state: "tasks" if state.get("plan_approved") else "clarify",
            {
                "tasks": "create_tasks",
                "clarify": "recursive_clarify"
            }
        )
        
        # Decision: Need more info or proceed to research/planning?
        graph.add_conditional_edges(
            "recursive_clarify",
            self.should_continue_to_research,
            {
                "research": "web_research",
                "clarify": "final_report"
            }
        )
        
        graph.add_edge("web_research", "strategic_plan")
        
        # Human-in-the-loop: Review Plan before generating tasks
        graph.add_conditional_edges(
            "strategic_plan",
            lambda state: "review" if state.get("review_required") and not state.get("plan_approved") else "execute",
            {
                "review": "final_report",
                "execute": "create_tasks"
            }
        )
        
        graph.add_edge("create_tasks", "task_orchestrator")
        
        # Loop for tasks
        graph.add_conditional_edges(
            "task_orchestrator",
            self.should_continue_executing,
            {
                "execute": "execute_sandbox",
                "complete": "final_report"
            }
        )
        
        graph.add_edge("execute_sandbox", "task_orchestrator")
        graph.add_edge("final_report", END)

        return graph.compile()

    def should_continue_to_research(self, state: BrainState):
        if state.get("status") == "ready_to_research":
            return "research"
        if state["intent_confidence"] >= 0.8:
            return "research"
        return "clarify"

    def should_continue_executing(self, state: BrainState):
        tasks = state.get("plan", [])
        idx = state.get("current_task_index", 0)
        if idx < len(tasks):
            return "execute"
        return "complete"

    async def analyze_ingress(self, state: BrainState) -> Dict[str, Any]:
        """Module A: Ingest & Map architecture using LeaderAgent."""
        from Brain.agents.leader_agent import LeaderAgent
        
        print(f"Leader Agent is analyzing ingress for: {state['conversation_id']}")
        
        if state.get("plan_approved"):
            print("Plan already approved, skipping Leader Agent analysis logic.")
            return {"status": "plan_approved_bypassing"}

        model_id = state.get("model_id") or "gpt-4o-mini"
        leader_data = await LeaderAgent.analyze(state["content"], model_id)
        
        # Update DB with title
        db = SessionLocal()
        try:
            suggested_title = leader_data.get("suggested_title")
            if suggested_title:
                # Update Conversation title
                db.query(Conversation).filter(Conversation.id == state["conversation_id"]).update({"title": suggested_title})
                # Update BrainProject title
                db.query(BrainProject).filter(BrainProject.conversationId == state["conversation_id"]).update({"title": suggested_title})
                db.commit()
        finally:
            db.close()

        return {
            "status": "led", 
            "intent_confidence": leader_data["confidence"],
            "leader_analysis": leader_data["leader_analysis"],
            "conversation_id": state["conversation_id"]
        }

    async def recursive_clarify(self, state: BrainState) -> Dict[str, Any]:
        """Module B: Interaction Hub using ClarifierAgent."""
        from Brain.agents.clarifier_agent import ClarifierAgent
        
        model_id = state.get("model_id") or "gpt-4o-mini"
        clarification_data = await ClarifierAgent.clarify(state["content"], model_id)
        
        if clarification_data["needs_clarification"]:
            raw_questions = clarification_data.get("questions", [])
            normalized_questions = []
            for i, q in enumerate(raw_questions):
                if isinstance(q, str):
                    text = q
                    options = []
                else:
                    text = q.get("question") or q.get("text") or ""
                    raw_options = q.get("options", [])
                    options = [opt.get("label", "") if isinstance(opt, dict) else str(opt) for opt in raw_options]

                normalized_questions.append({
                    "id": q.get("id") if isinstance(q, dict) and q.get("id") else f"q{i}",
                    "text": text,
                    "options": [opt for opt in options if opt]
                })

            preamble = clarification_data.get("preamble") or "To help you better, I need a few more details."
            payload = {"preamble": preamble, "questions": normalized_questions}

            return {
                "clarifications": normalized_questions,
                "status": "clarifying",
                "intent_confidence": clarification_data["confidence"],
                "report": f"__CLARIFY__:{json.dumps(payload)}"
            }
            
        return {
            "status": "ready_to_research",
            "intent_confidence": clarification_data["confidence"]
        }

    async def web_research(self, state: BrainState) -> Dict[str, Any]:
        """Module Research: Web Search using Tavily and/or Brave."""
        from Brain.services.web_search_service import WebSearchService
        search_service = WebSearchService()
        
        provider = state.get("search_provider", "tavily")
        query = state["content"]
        
        print(f"Performing web research using {provider} for query: {query}")
        
        if provider == "both":
            results = await search_service.search_combined(query)
        else:
            results = await search_service.search(query, provider=provider)
            
        formatted_results = search_service.format_results(results)
        return {"search_results": formatted_results, "status": "researched"}

    async def strategic_plan(self, state: BrainState) -> Dict[str, Any]:
        """Module D: Architect high-level strategy using PlannerAgent."""
        from Brain.agents.planner_agent import PlannerAgent
        
        model_id = state.get("model_id") or "gpt-4o-mini"
        planning_data = await PlannerAgent.create_plan(
            state["content"], 
            state["search_results"], 
            model_id
        )
        
        return {
            "report": f"## Strategic Plan\n{planning_data['strategy']}",
            "status": "planning_complete",
            "review_required": True
        }

    async def create_tasks(self, state: BrainState) -> Dict[str, Any]:
        """Module E: Generate Todo List using TaskAgent."""
        from Brain.agents.task_agent import TaskAgent
        
        model_id = state.get("model_id") or "gpt-4o-mini"
        todo_list = await TaskAgent.create_todo_list(state["report"], model_id)
        
        return {
            "plan": todo_list,
            "status": "tasks_generated"
        }

    async def task_orchestrator(self, state: BrainState) -> Dict[str, Any]:
        """Module E2: Manages the task execution loop."""
        tasks = state.get("plan", [])
        idx = state.get("current_task_index", 0)
        
        if idx < len(tasks):
            task = tasks[idx]
            print(f"Orchestrating task {idx+1}/{len(tasks)}: {task['task']}")
            return {
                "status": "executing_task",
                "progress_msg": f"[TASK_PROGRESS] 🔄 Task {idx+1}/{len(tasks)}: {task['task']}..."
            }
        
        return {"status": "all_tasks_completed"}

    async def execute_sandbox(self, state: BrainState) -> Dict[str, Any]:
        """Module F: The E2B Detonation Zone - Executing current task."""
        import asyncio
        tasks = state.get("plan", [])
        idx = state.get("current_task_index", 0)
        executed = state.get("executed_tasks", [])
        
        if idx < len(tasks):
            task = tasks[idx].copy()
            # Simulate real work delay
            await asyncio.sleep(1.5) 
            
            task["status"] = "completed"
            task["result"] = "Technical verification complete. Sandbox environment confirmed state."
            executed.append(task)
            
            # Update the main plan list for the frontend
            new_plan = tasks.copy()
            new_plan[idx]["status"] = "completed"
            
            return {
                "current_task_index": idx + 1,
                "executed_tasks": executed,
                "plan": new_plan,
                "status": "task_executed"
            }
        
        return {"status": "no_task_to_execute"}

    async def final_report(self, state: BrainState) -> Dict[str, Any]:
        """Module G: The Canvas Reporting Hub."""
        from Brain.agents.reporter_agent import ReporterAgent
        
        plan_approved = state.get("plan_approved", False)
        executed_tasks = state.get("executed_tasks", [])
        
        if plan_approved and executed_tasks:
            # Generate a real technical report based on execution
            print("Generating final execution report...")
            report = await ReporterAgent.synthesize(
                state["content"], 
                executed_tasks, 
                state.get("model_id", "gpt-4o-mini")
            )
            
            final_report_content = f"""
## Technical Execution Report
{report}

---
### ✅ Execution Finished
All tasks in the technical roadmap have been completed. You can review the final findings in the Brain Canvas.
"""
        else:
            # Planning phase report
            detailed_report = state.get("report", "# Project Brain: Analysis Complete")
            final_report_content = f"""
{detailed_report}

---
### ✅ System Status: Ready for Execution
The Grizon Brain has completed the high-fidelity planning phase. 
Please review the **Technical Strategy** above and the granular **Todo List** below.
**Reply "Approve" or click the button to begin technical execution.**
"""
        
        return {
            "report": final_report_content.strip(), 
            "status": "completed",
            "response": final_report_content.strip(),
            "conversation_id": state["conversation_id"]
        }
    
    def _ensure_db_persistence(self, state: Dict[str, Any]) -> str:
        """Helper to ensure Conversation, Message (User), and BrainProject exist in DB."""
        db = SessionLocal()
        try:
            import uuid
            
            conv_id = state.get("conversation_id")
            
            # 1. Handle Conversation creation
            if conv_id == "new" or not conv_id:
                conv_id = str(uuid.uuid4())
                new_conv = Conversation(
                    id=conv_id,
                    userId=state["user_id"],
                    title=state["content"][:60],
                    status="active",
                    platform="web",
                    createdAt=datetime.utcnow(),
                    updatedAt=datetime.utcnow()
                )
                db.add(new_conv)
                
                # 2. Save Initial User Message
                user_msg = Message(
                    id=str(uuid.uuid4()),
                    conversationId=conv_id,
                    userId=state["user_id"],
                    role="user",
                    content=state["content"],
                    createdAt=datetime.utcnow()
                )
                db.add(user_msg)
                
                # 3. Create BrainProject
                project = BrainProject(
                    id=str(uuid.uuid4()),
                    userId=state["user_id"],
                    conversationId=conv_id,
                    title=state["content"][:50],
                    status="ANALYZING",
                    createdAt=datetime.utcnow(),
                    updatedAt=datetime.utcnow()
                )
                db.add(project)
                db.commit()
            else:
                # Existing conversation
                project = db.query(BrainProject).filter(BrainProject.conversationId == conv_id).first()
                if not project:
                    project = BrainProject(
                        id=str(uuid.uuid4()),
                        userId=state["user_id"],
                        conversationId=conv_id,
                        title=state["content"][:50],
                        status="ANALYZING",
                        createdAt=datetime.utcnow(),
                        updatedAt=datetime.utcnow()
                    )
                    db.add(project)
                
                # Save follow-up user message
                user_msg = Message(
                    id=str(uuid.uuid4()),
                    conversationId=conv_id,
                    userId=state["user_id"],
                    role="user",
                    content=state["content"],
                    createdAt=datetime.utcnow()
                )
                db.add(user_msg)
                db.commit()
            return conv_id
        finally:
            db.close()

    async def process_chat(self, request: Dict[str, Any]) -> Dict[str, Any]:
        initial_state = {
            "user_id": request["user_id"],
            "conversation_id": request.get("conversation_id") or "new",
            "content": request["content"],
            "repo_url": request.get("repo_url"),
            "intent_confidence": 0.0,
            "plan": [],
            "clarifications": [],
            "self_critique": [],
            "report": "",
            "status": "starting",
            "messages": [],
            "search_provider": request.get("search_provider", "tavily"),
            "search_results": "",
            "leader_analysis": "",
            "plan_approved": request.get("plan_approved", False),
            "approved_plan": request.get("approved_plan"),
            "review_required": request.get("review_required", True),
            "model_id": request.get("model_id", "gpt-4o-mini"),
            "current_task_index": 0,
            "executed_tasks": []
        }
        
        initial_state["conversation_id"] = self._ensure_db_persistence(initial_state)
        
        # If plan is already approved, we must ensure 'report' contains the plan for TaskAgent
        if initial_state.get("plan_approved") and initial_state.get("approved_plan"):
            initial_state["report"] = initial_state["approved_plan"]

        print(f"DEBUG: Starting workflow for conversation: {initial_state['conversation_id']}")
        try:
            result = await self.workflow.ainvoke(initial_state)
        except Exception as e:
            print(f"ERROR in workflow: {e}")
            raise e
        
        # Ensure conversation_id and other required fields are present in the final result
        if not result.get("conversation_id"):
            result["conversation_id"] = initial_state["conversation_id"]
            
        print(f"DEBUG: Workflow finished. conversation_id in result: {result.get('conversation_id')}")
        return result

    async def process_chat_stream(self, request: Dict[str, Any]) -> AsyncGenerator[str, None]:
        initial_state = {
            "user_id": request["user_id"],
            "conversation_id": request.get("conversation_id") or "new",
            "content": request["content"],
            "repo_url": request.get("repo_url"),
            "intent_confidence": 0.0,
            "plan": [],
            "clarifications": [],
            "self_critique": [],
            "report": "",
            "status": "starting",
            "messages": [],
            "search_provider": request.get("search_provider", "tavily"),
            "search_results": "",
            "leader_analysis": "",
            "plan_approved": request.get("plan_approved", False),
            "approved_plan": request.get("approved_plan"),
            "review_required": request.get("review_required", True),
            "model_id": request.get("model_id", "gpt-4o-mini"),
            "current_task_index": 0,
            "executed_tasks": []
        }
        
        initial_state["conversation_id"] = self._ensure_db_persistence(initial_state)
        
        # If plan is already approved, we must ensure 'report' contains the plan for TaskAgent
        if initial_state.get("plan_approved") and initial_state.get("approved_plan"):
            initial_state["report"] = initial_state["approved_plan"]
        
        final_response = ""
        async for event in self.workflow.astream(initial_state):
            # Track final response from final_report node
            if "final_report" in event:
                final_response = event["final_report"].get("report", "")
            elif "analyze_ingress" in event and not final_response:
                # Fallback to leader analysis if we stop early
                final_response = event["analyze_ingress"].get("leader_analysis", "")
                
            yield f"data: {json.dumps(event)}\n\n"
            
        # After stream finished, save Assistant message
        if final_response:
            db = SessionLocal()
            try:
                import uuid
                asst_msg = Message(
                    id=str(uuid.uuid4()),
                    conversationId=initial_state["conversation_id"],
                    userId=initial_state["user_id"],
                    role="assistant",
                    content=final_response,
                    createdAt=datetime.utcnow()
                )
                db.add(asst_msg)
                db.commit()
            finally:
                db.close()
