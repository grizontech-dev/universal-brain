from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import Optional, List
from Brain.memory.project import ProjectMemory

router = APIRouter(prefix="/brain/projects", tags=["projects"])


class CreateProjectRequest(BaseModel):
    name: str
    description: Optional[str] = None
    frontend: Optional[str] = None
    backend: Optional[str] = None
    database: Optional[str] = None
    css_framework: Optional[str] = None
    auth_method: Optional[str] = None
    folder_structure: Optional[dict] = None
    requirements: Optional[List[str]] = None
    roadmap: Optional[dict] = None
    owner_id: Optional[str] = None


class UpdateStackRequest(BaseModel):
    frontend: Optional[str] = None
    backend: Optional[str] = None
    database: Optional[str] = None
    css_framework: Optional[str] = None
    auth_method: Optional[str] = None


class ProjectResponse(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    frontend: Optional[str] = None
    backend: Optional[str] = None
    database: Optional[str] = None
    css_framework: Optional[str] = None
    auth_method: Optional[str] = None
    folder_structure: Optional[dict] = None
    requirements: List[str] = []
    roadmap: Optional[dict] = None
    status: str = "active"
    owner_id: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


def _to_response(project) -> ProjectResponse:
    return ProjectResponse(
        id=project.id,
        name=project.name,
        description=project.description,
        frontend=project.frontend,
        backend=project.backend,
        database=project.database,
        css_framework=project.css_framework,
        auth_method=project.auth_method,
        folder_structure=project.folder_structure,
        requirements=project.requirements or [],
        roadmap=project.roadmap,
        status=project.status,
        owner_id=project.owner_id,
        created_at=str(project.created_at) if project.created_at else None,
        updated_at=str(project.updated_at) if project.updated_at else None,
    )


@router.post("", response_model=ProjectResponse)
async def create_project(req: CreateProjectRequest):
    pm = ProjectMemory()
    try:
        project = pm.create(req.model_dump(exclude_none=True))
        return _to_response(project)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        pm.close()


@router.get("/{project_id}", response_model=ProjectResponse)
async def get_project(project_id: str):
    pm = ProjectMemory()
    try:
        project = pm.get_by_id(project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        return _to_response(project)
    finally:
        pm.close()


@router.patch("/{project_id}/stack")
async def update_project_stack(project_id: str, req: UpdateStackRequest):
    pm = ProjectMemory()
    try:
        updates = req.model_dump(exclude_none=True)
        if not updates:
            raise HTTPException(status_code=400, detail="No fields to update")
        pm.update_stack(project_id, updates)
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        pm.close()


@router.post("/{project_id}/requirements")
async def append_requirement(project_id: str, req: dict):
    requirement = req.get("requirement")
    if not requirement:
        raise HTTPException(status_code=400, detail="requirement is required")
    pm = ProjectMemory()
    try:
        pm.append_requirement(project_id, requirement)
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        pm.close()


@router.get("", response_model=List[ProjectResponse])
async def list_projects(owner_id: str = Query(...)):
    pm = ProjectMemory()
    try:
        projects = pm.list_by_owner(owner_id)
        return [_to_response(p) for p in projects]
    finally:
        pm.close()
