from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from Brain.memory.short_term import ShortTermMemory
from Brain.memory.session import SessionMemory

router = APIRouter(prefix="/brain/memory", tags=["memory"])


# --- Debug endpoints ---

@router.get("/debug/{session_id}")
async def get_short_term_memory(session_id: str, limit: int = 50):
    stm = ShortTermMemory(session_id)
    entries = await stm.get_recent(limit)
    return {"session_id": session_id, "entries": entries, "count": len(entries)}


@router.get("/debug/{session_id}/session")
async def get_session_memory(session_id: str):
    sm = SessionMemory(session_id)
    data = await sm.get_all()
    return {"session_id": session_id, "data": data}


# --- Production session endpoints ---

class SessionUpdateRequest(BaseModel):
    field: str
    value: str


@router.get("/session/{session_id}")
async def read_session(session_id: str):
    """Get full session state for a session ID."""
    sm = SessionMemory(session_id)
    data = await sm.get_all()
    if not data:
        return {"session_id": session_id, "data": {}, "exists": False}
    return {"session_id": session_id, "data": data, "exists": True}


@router.put("/session/{session_id}")
async def update_session(session_id: str, body: SessionUpdateRequest):
    """Update a single field in session state."""
    sm = SessionMemory(session_id)
    await sm.set(body.field, body.value)
    return {"session_id": session_id, "field": body.field, "updated": True}


@router.put("/session/{session_id}/workflow")
async def update_workflow(session_id: str, state: str, agent: str):
    """Update workflow state and current agent."""
    sm = SessionMemory(session_id)
    from datetime import datetime
    await sm.set("workflow_state", state)
    await sm.set("current_agent", agent)
    await sm.set("last_active", datetime.utcnow().isoformat())
    return {"session_id": session_id, "workflow_state": state, "current_agent": agent, "updated": True}


@router.delete("/session/{session_id}")
async def clear_session(session_id: str):
    """Clear session state (for testing/cleanup)."""
    sm = SessionMemory(session_id)
    await sm.clear()
    return {"session_id": session_id, "cleared": True}
