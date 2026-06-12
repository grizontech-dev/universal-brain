from Brain.config.database import SessionLocal
from Brain.memory.models import ChangeRequest
from datetime import datetime


class ChangeMemory:
    def __init__(self):
        self.db = SessionLocal()

    def create_request(self, project_id: str, request_text: str) -> ChangeRequest:
        cr = ChangeRequest(
            project_id=project_id,
            request_text=request_text,
            status="pending"
        )
        self.db.add(cr)
        self.db.commit()
        self.db.refresh(cr)
        return cr

    def complete_request(self, request_id: str, affected_files: list = None, affected_components: list = None):
        self.db.query(ChangeRequest).filter(ChangeRequest.id == request_id).update({
            "status": "completed",
            "affected_files": affected_files or [],
            "affected_components": affected_components or [],
            "completed_at": datetime.utcnow()
        })
        self.db.commit()

    def get_project_changes(self, project_id: str) -> list:
        return self.db.query(ChangeRequest).filter(
            ChangeRequest.project_id == project_id
        ).order_by(ChangeRequest.created_at.desc()).all()

    def close(self):
        self.db.close()
