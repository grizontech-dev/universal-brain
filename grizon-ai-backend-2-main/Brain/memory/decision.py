from Brain.config.database import SessionLocal
from Brain.memory.models import ProjectDecision
from datetime import datetime


class DecisionMemory:
    def __init__(self):
        self.db = SessionLocal()

    @staticmethod
    def _category(key: str) -> str:
        return {
            "frontend": "stack", "backend": "stack", "database": "stack",
            "theme": "ui", "css": "ui",
            "auth": "security", "api_style": "architecture"
        }.get(key, "general")

    def store_approved_decisions(self, project_id: str, decisions: dict):
        project_id = str(project_id)
        rows = []
        for key, val in decisions.items():
            rows.append(ProjectDecision(
                project_id=project_id,
                category=self._category(key),
                decision_key=key,
                decision_val=val,
                approved_by="user"
            ))
        if rows:
            self.db.bulk_save_objects(rows)
            self.db.commit()

    def get_active_decisions(self, project_id: str) -> dict:
        project_id = str(project_id)
        rows = self.db.query(ProjectDecision).filter(
            ProjectDecision.project_id == project_id,
            ProjectDecision.is_active == True
        ).all()
        return {r.decision_key: r.decision_val for r in rows}

    def override_decision(self, project_id: str, key: str, new_val: str, reason: str = None):
        project_id = str(project_id)
        self.db.query(ProjectDecision).filter(
            ProjectDecision.project_id == project_id,
            ProjectDecision.decision_key == key,
            ProjectDecision.is_active == True
        ).update({
            "is_active": False,
            "overridden_at": datetime.utcnow(),
            "overridden_by": "user"
        })
        new_decision = ProjectDecision(
            project_id=project_id,
            category=self._category(key),
            decision_key=key,
            decision_val=new_val,
            reason=reason,
            approved_by="user"
        )
        self.db.add(new_decision)
        self.db.commit()

    def close(self):
        self.db.close()
