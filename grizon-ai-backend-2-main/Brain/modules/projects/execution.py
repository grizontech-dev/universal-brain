from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, List
from Brain.memory.execution import ExecutionMemory

router = APIRouter(prefix="/brain/execution", tags=["execution"])


class StartTaskRequest(BaseModel):
    project_id: str
    task_name: str
    agent: str
    todo_id: Optional[str] = None


class CompleteTaskRequest(BaseModel):
    output_files: Optional[List[str]] = None
    token_count: int = 0


class FailTaskRequest(BaseModel):
    error_message: str


class TaskLogResponse(BaseModel):
    id: str
    project_id: str
    todo_id: Optional[str] = None
    task_name: str
    task_type: Optional[str] = None
    agent: Optional[str] = None
    status: str = "pending"
    output_files: List[str] = []
    error_message: Optional[str] = None
    retry_count: int = 0
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    duration_ms: Optional[int] = None
    token_count: Optional[int] = None


@router.post("/start")
async def start_task(req: StartTaskRequest):
    em = ExecutionMemory()
    try:
        log = em.start_task(req.project_id, req.task_name, req.agent, req.todo_id)
        return {
            "id": log.id,
            "project_id": log.project_id,
            "task_name": log.task_name,
            "agent": log.agent,
            "status": log.status,
            "started_at": str(log.started_at) if log.started_at else None,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        em.close()


@router.post("/{log_id}/complete")
async def complete_task(log_id: str, req: CompleteTaskRequest):
    em = ExecutionMemory()
    try:
        em.complete_task(log_id, req.output_files, req.token_count)
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        em.close()


@router.post("/{log_id}/fail")
async def fail_task(log_id: str, req: FailTaskRequest):
    em = ExecutionMemory()
    try:
        em.fail_task(log_id, req.error_message)
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        em.close()


@router.get("/check/{project_id}/{task_name}")
async def is_already_done(project_id: str, task_name: str):
    em = ExecutionMemory()
    try:
        done = em.is_already_done(project_id, task_name)
        return {"already_done": done}
    finally:
        em.close()


@router.get("/failed/{project_id}")
async def get_failed_tasks(project_id: str):
    em = ExecutionMemory()
    try:
        tasks = em.get_failed_tasks(project_id)
        return [
            {
                "id": t.id,
                "task_name": t.task_name,
                "agent": t.agent,
                "error_message": t.error_message,
                "retry_count": t.retry_count,
                "started_at": str(t.started_at) if t.started_at else None,
                "completed_at": str(t.completed_at) if t.completed_at else None,
            }
            for t in tasks
        ]
    finally:
        em.close()


@router.get("/summary/{project_id}")
async def get_project_summary(project_id: str):
    em = ExecutionMemory()
    try:
        summary = em.get_project_summary(project_id)
        return {"project_id": project_id, "summary": summary}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        em.close()
