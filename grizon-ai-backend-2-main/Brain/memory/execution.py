from Brain.config.database import SessionLocal
from Brain.memory.models import ExecutionLog
from datetime import datetime, timezone
from sqlalchemy import text


def _ensure_aware(dt):
    if dt is not None and dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


class ExecutionMemory:
    def __init__(self):
        self.db = SessionLocal()

    def start_task(self, project_id: str, task_name: str, agent: str, todo_id: str = None) -> ExecutionLog:
        log = ExecutionLog(
            project_id=project_id,
            todo_id=todo_id,
            task_name=task_name,
            agent=agent,
            status="in_progress",
            started_at=datetime.now(timezone.utc)
        )
        self.db.add(log)
        self.db.commit()
        self.db.refresh(log)
        return log

    def complete_task(self, log_id: str, output_files: list = None, token_count: int = 0):
        log = self.db.query(ExecutionLog).filter(ExecutionLog.id == log_id).first()
        if not log:
            return
        now = datetime.now(timezone.utc)
        if log.started_at:
            duration = int((now - _ensure_aware(log.started_at)).total_seconds() * 1000)
        else:
            duration = 0
        self.db.query(ExecutionLog).filter(ExecutionLog.id == log_id).update({
            "status": "completed",
            "output_files": output_files or [],
            "completed_at": now,
            "duration_ms": duration,
            "token_count": token_count
        })
        self.db.commit()

    def fail_task(self, log_id: str, error_message: str):
        self.db.query(ExecutionLog).filter(ExecutionLog.id == log_id).update({
            "status": "failed",
            "error_message": error_message,
            "completed_at": datetime.now(timezone.utc)
        })
        self.db.commit()

    def is_already_done(self, project_id: str, task_name: str) -> bool:
        return self.db.query(ExecutionLog).filter(
            ExecutionLog.project_id == project_id,
            ExecutionLog.task_name == task_name,
            ExecutionLog.status == "completed"
        ).first() is not None

    def get_failed_tasks(self, project_id: str) -> list:
        return self.db.query(ExecutionLog).filter(
            ExecutionLog.project_id == project_id,
            ExecutionLog.status == "failed"
        ).all()

    def get_project_summary(self, project_id: str) -> list:
        result = self.db.execute(
            text("SELECT status, COUNT(*) as count, SUM(token_count) as total_tokens FROM memory_execution_logs WHERE project_id = :pid GROUP BY status"),
            {"pid": project_id}
        )
        return [dict(row) for row in result]

    def close(self):
        self.db.close()
