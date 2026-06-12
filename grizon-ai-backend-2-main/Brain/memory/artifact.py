from Brain.config.database import SessionLocal
from Brain.memory.models import Artifact


class ArtifactMemory:
    def __init__(self):
        self.db = SessionLocal()

    def register(self, project_id: str, artifact: dict) -> Artifact:
        existing = self.db.query(Artifact).filter(
            Artifact.project_id == project_id,
            Artifact.file_path == artifact.get("filePath"),
            Artifact.is_active == True
        ).first()

        if existing:
            existing.version += 1
            existing.content_hash = artifact.get("contentHash")
            existing.dependencies = artifact.get("dependencies", [])
            from datetime import datetime
            existing.updated_at = datetime.utcnow()
            self.db.commit()
            self.db.refresh(existing)
            return existing

        new_artifact = Artifact(
            project_id=project_id,
            name=artifact["name"],
            artifact_type=artifact.get("type", "component"),
            file_path=artifact.get("filePath"),
            content_hash=artifact.get("contentHash"),
            dependencies=artifact.get("dependencies", []),
            exports=artifact.get("exports", []),
            language=artifact.get("language"),
            size_bytes=artifact.get("sizeBytes"),
            created_by=artifact.get("createdBy")
        )
        self.db.add(new_artifact)
        self.db.commit()
        self.db.refresh(new_artifact)
        return new_artifact

    def exists(self, project_id: str, file_path: str) -> bool:
        return self.db.query(Artifact).filter(
            Artifact.project_id == project_id,
            Artifact.file_path == file_path,
            Artifact.is_active == True
        ).first() is not None

    def get_all_components(self, project_id: str) -> list:
        return self.db.query(Artifact).filter(
            Artifact.project_id == project_id,
            Artifact.artifact_type == "component",
            Artifact.is_active == True
        ).all()

    def get_by_name(self, project_id: str, name: str) -> list:
        return self.db.query(Artifact).filter(
            Artifact.project_id == project_id,
            Artifact.name == name,
            Artifact.is_active == True
        ).all()

    def close(self):
        self.db.close()
