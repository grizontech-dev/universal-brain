import os
import json
from typing import Dict, Any, List, Optional
from Brain.config.database import SessionLocal
from Brain.modules.conversations.models import Message, BrainProject, BrainTask

class MemoryEngine:
    def __init__(self):
        self.db = SessionLocal()

    def get_conversation_memory(self, conversation_id: str) -> List[Dict[str, Any]]:
        """Retrieves past messages and decisions."""
        messages = self.db.query(Message).filter(Message.conversationId == conversation_id).all()
        return [{"role": m.role, "content": m.content, "todo": m.todoList} for m in messages]

    def get_architecture_memory(self, conversation_id: str) -> Optional[Dict[str, Any]]:
        """Retrieves the approved architecture for the project."""
        project = self.db.query(BrainProject).filter(BrainProject.conversationId == conversation_id).first()
        if project and project.status == "PLANNED":
            # In a real app, we'd store the architecture JSON in a field
            return {"repo_url": project.repoUrl, "status": project.status}
        return None

    def get_task_memory(self, project_id: str) -> List[Dict[str, Any]]:
        """Retrieves completed and pending tasks."""
        tasks = self.db.query(BrainTask).filter(BrainTask.projectId == project_id).order_by(BrainTask.order).all()
        return [{"label": t.label, "status": t.status, "agent": t.agent} for t in tasks]

    def save_execution_memory(self, conversation_id: str, task_id: str, result: Dict[str, Any]):
        """Saves the output of a task execution."""
        # This could be stored in a specialized ExecutionLog table
        pass

memory_engine = MemoryEngine()
