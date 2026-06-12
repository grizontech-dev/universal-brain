from typing import List, Dict, Any

class ContextManager:
    @staticmethod
    def compress_history(messages: List[Dict[str, Any]], max_tokens: int = 2000) -> List[Dict[str, Any]]:
        """
        Compresses conversation history to fit within token limits.
        In a real app, this would use tiktoken to count tokens and summarize old messages.
        """
        if len(messages) <= 5:
            return messages
        
        # Keep the system prompt, first message, and last 3 messages
        compressed = [messages[0]] # System
        compressed.append(messages[1]) # User initial
        compressed.extend(messages[-3:]) # Recent context
        
        return compressed

    @staticmethod
    def format_agent_context(state: Dict[str, Any]) -> str:
        """Formats the current state for an agent."""
        return f"Current Status: {state.get('status')}\nPlan: {state.get('project_plan')}\nTasks Completed: {len(state.get('executed_tasks', []))}"

context_manager = ContextManager()
