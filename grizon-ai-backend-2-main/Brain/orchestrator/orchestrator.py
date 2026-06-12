from typing import Any, Dict, List, Optional
from Brain.agents.manager.manager_agent import ManagerAgent
from Brain.agents.questions.questions_agent import QuestionsAgent
from Brain.agents.planner.planner_agent import PlannerAgent
from Brain.agents.todo.todo_agent import TodoAgent
from Brain.agents.builder.builder_agent import BuilderAgent
from Brain.agents.runner.runner_agent import RunnerAgent
from Brain.agents.watcher.watcher_agent import WatcherAgent
from Brain.agents.reporter.reporter_agent import ReporterAgent

class BrainOrchestrator:
    def __init__(self):
        self.manager = ManagerAgent()
        self.questions = QuestionsAgent()
        self.planner = PlannerAgent()
        self.todo = TodoAgent()
        self.builder = BuilderAgent()
        self.runner = RunnerAgent()
        self.watcher = WatcherAgent()
        self.reporter = ReporterAgent()

    async def run(self, state: Dict[str, Any]) -> Dict[str, Any]:
        """
        Full orchestration flow as requested:
        User Prompt -> Leader -> (if missing context) -> Questions -> Answers -> Leader -> Planner -> Feedback Loop -> Approved -> Todo -> Builder (Sub-agents) -> Runner -> Watcher
        """
        
        # 1. Start with Leader/Manager
        if state.get("status") in ["starting", "new_input"]:
            state = await self.manager.execute(state)
            
        # 2. Handle Questions phase
        if state.get("next_agent") == "questions":
            state = await self.questions.execute(state)
            return state # Wait for user input (answers)
            
        # 3. Handle Planning phase (includes feedback loop)
        if state.get("next_agent") == "planner" or state.get("status") == "user_feedback":
            state = await self.planner.execute(state)
            return state # Wait for user approval or more feedback
            
        # 4. Handle Plan Approval
        if state.get("status") == "plan_approved":
            state = await self.todo.execute(state)
            # Todo automatically sets next_agent to 'builder'
            
        # 5. Handle Building phase (Builder coordinates sub-agents)
        if state.get("next_agent") == "builder" or state.get("status") == "building":
            state = await self.builder.execute(state)
            # Builder will loop itself until tasks are done
            if state.get("status") == "building":
                return state # Continue building in next iteration or await

        # 6. Handle Execution phase
        if state.get("status") == "building_complete" or state.get("next_agent") == "runner":
            state = await self.runner.execute(state)
            
        # 7. Handle Monitoring phase
        if state.get("status") == "running" or state.get("next_agent") == "watcher":
            state = await self.watcher.execute(state)

        # 8. Handle Reporting phase (generates final technical report)
        if state.get("next_agent") == "reporter" or state.get("status") == "completed":
            state = await self.reporter.execute(state)

        return state
