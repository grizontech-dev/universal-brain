from Brain.config.database import SessionLocal
from Brain.memory.models import Project
from datetime import datetime
from sqlalchemy import text


class ProjectMemory:
    def __init__(self):
        self.db = SessionLocal()

    def create(self, project_data: dict) -> Project:
        project = Project(
            name=project_data["name"],
            description=project_data.get("description"),
            frontend=project_data.get("frontend"),
            backend=project_data.get("backend"),
            database=project_data.get("database"),
            css_framework=project_data.get("cssFramework") or project_data.get("css_framework"),
            auth_method=project_data.get("authMethod") or project_data.get("auth_method"),
            folder_structure=project_data.get("folder_structure") or project_data.get("folderStructure"),
            requirements=project_data.get("requirements", []),
            roadmap=project_data.get("roadmap"),
            owner_id=project_data.get("owner_id"),
            status=project_data.get("status", "active")
        )
        self.db.add(project)
        self.db.commit()
        self.db.refresh(project)
        return project

    def get_by_id(self, project_id: str) -> Project:
        return self.db.query(Project).filter(Project.id == project_id).first()

    def update_stack(self, project_id: str, stack_updates: dict):
        self.db.query(Project).filter(Project.id == project_id).update({
            **stack_updates,
            "updated_at": datetime.utcnow()
        })
        self.db.commit()

    def append_requirement(self, project_id: str, requirement: str):
        self.db.execute(
            text("UPDATE memory_projects SET requirements = array_append(requirements, :req), updated_at = now() WHERE id = :pid"),
            {"req": requirement, "pid": project_id}
        )
        self.db.commit()

    def list_by_owner(self, owner_id: str) -> list:
        return self.db.query(Project).filter(Project.owner_id == owner_id).all()

    def list_all(self) -> list:
        return self.db.query(Project).all()

    def close(self):
        self.db.close()
