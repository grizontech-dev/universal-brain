from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import Optional, List
from Brain.memory.artifact import ArtifactMemory

router = APIRouter(prefix="/brain/artifacts", tags=["artifacts"])


class RegisterArtifactRequest(BaseModel):
    project_id: str
    name: str
    type: str
    filePath: str
    contentHash: Optional[str] = None
    dependencies: Optional[List[str]] = None
    exports: Optional[List[str]] = None
    language: Optional[str] = None
    sizeBytes: Optional[int] = None
    createdBy: Optional[str] = None


class ArtifactResponse(BaseModel):
    id: str
    project_id: str
    name: str
    artifact_type: str
    file_path: str
    version: int
    content_hash: Optional[str] = None
    dependencies: List[str] = []
    exports: List[str] = []
    language: Optional[str] = None
    size_bytes: Optional[int] = None
    is_active: bool = True
    created_by: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


@router.post("")
async def register_artifact(req: RegisterArtifactRequest):
    am = ArtifactMemory()
    try:
        artifact = am.register(req.project_id, req.model_dump())
        return {
            "id": artifact.id,
            "project_id": artifact.project_id,
            "name": artifact.name,
            "artifact_type": artifact.artifact_type,
            "file_path": artifact.file_path,
            "version": artifact.version,
            "content_hash": artifact.content_hash,
            "dependencies": artifact.dependencies or [],
            "exports": artifact.exports or [],
            "language": artifact.language,
            "size_bytes": artifact.size_bytes,
            "is_active": artifact.is_active,
            "created_by": artifact.created_by,
            "created_at": str(artifact.created_at) if artifact.created_at else None,
            "updated_at": str(artifact.updated_at) if artifact.updated_at else None,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        am.close()


@router.get("/{project_id}")
async def get_all_artifacts(project_id: str):
    am = ArtifactMemory()
    try:
        artifacts = am.get_all(project_id)
        return [
            {
                "id": a.id,
                "project_id": a.project_id,
                "name": a.name,
                "artifact_type": a.artifact_type,
                "file_path": a.file_path,
                "version": a.version,
                "content_hash": a.content_hash,
                "dependencies": a.dependencies or [],
                "exports": a.exports or [],
                "language": a.language,
                "size_bytes": a.size_bytes,
                "is_active": a.is_active,
                "created_by": a.created_by,
                "created_at": str(a.created_at) if a.created_at else None,
                "updated_at": str(a.updated_at) if a.updated_at else None,
            }
            for a in artifacts
        ]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        am.close()


@router.get("/{project_id}/check")
async def check_artifact(project_id: str, path: str = Query(..., description="File path to check")):
    am = ArtifactMemory()
    try:
        exists = am.exists(project_id, path)
        return {"exists": exists, "file_path": path, "project_id": project_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        am.close()


@router.get("/{project_id}/type/{artifact_type}")
async def get_artifacts_by_type(project_id: str, artifact_type: str):
    am = ArtifactMemory()
    try:
        artifacts = am.get_by_type(project_id, artifact_type)
        return [
            {
                "id": a.id,
                "name": a.name,
                "file_path": a.file_path,
                "version": a.version,
                "language": a.language,
                "created_at": str(a.created_at) if a.created_at else None,
            }
            for a in artifacts
        ]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        am.close()


@router.get("/{project_id}/name/{name}")
async def get_artifacts_by_name(project_id: str, name: str):
    am = ArtifactMemory()
    try:
        artifacts = am.get_by_name(project_id, name)
        return [
            {
                "id": a.id,
                "name": a.name,
                "artifact_type": a.artifact_type,
                "file_path": a.file_path,
                "version": a.version,
            }
            for a in artifacts
        ]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        am.close()


@router.delete("/{artifact_id}")
async def deactivate_artifact(artifact_id: str):
    am = ArtifactMemory()
    try:
        am.deactivate(artifact_id)
        return {"success": True, "id": artifact_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        am.close()
