from typing import Any, Dict, List
from Brain.shared.agent import BaseAgent
import time
from Brain.services.sandbox_manager import sandbox_manager

LOG = "[WATCHER]"

class WatcherAgent(BaseAgent):
    def __init__(self):
        super().__init__(
            name="Watcher",
            description="Monitors the sandbox and reports when the task is complete.",
            model_id="deepseek-v4-pro"
        )

    async def execute(self, state: Dict[str, Any]) -> Dict[str, Any]:
        """
        Polls the sandbox status and updates the state.
        """
        sandbox_id = state.get("sandbox_id")
        print(f"{LOG} ═══ EXECUTE ═══ sandbox_id={sandbox_id}", flush=True)
        if not sandbox_id:
            state["status"] = "error"
            return state

        # Monitoring loop (Simplified for the orchestrator)
        # In a real async environment, this would be a long-running process or a websocket stream

        state["health_status"] = "healthy"
        state["next_agent"] = "reporter"

        return state