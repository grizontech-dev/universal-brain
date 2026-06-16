from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import Optional, Dict, List
from Brain.memory.decision import DecisionMemory

router = APIRouter(prefix="/brain/decisions", tags=["decisions"])


class StoreDecisionsRequest(BaseModel):
    project_id: str
    decisions: Dict[str, str]


class OverrideDecisionRequest(BaseModel):
    project_id: str
    decision_key: str
    new_value: str
    reason: Optional[str] = None


class DecisionResponse(BaseModel):
    id: str
    project_id: str
    category: str
    decision_key: str
    decision_val: str
    reason: Optional[str] = None
    approved_at: Optional[str] = None
    approved_by: str = "user"
    overridden_at: Optional[str] = None
    overridden_by: Optional[str] = None
    is_active: bool = True


@router.post("")
async def store_decisions(req: StoreDecisionsRequest):
    dm = DecisionMemory()
    try:
        dm.store_approved_decisions(req.project_id, req.decisions)
        return {"success": True, "project_id": req.project_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        dm.close()


@router.get("/{project_id}")
async def get_active_decisions(project_id: str):
    dm = DecisionMemory()
    try:
        raw = dm.get_active_decisions_raw(project_id)
        decisions = {
            "project_id": project_id,
            "decisions": {r.decision_key: r.decision_val for r in raw},
            "items": [
                {
                    "id": r.id,
                    "category": r.category,
                    "decision_key": r.decision_key,
                    "decision_val": r.decision_val,
                    "reason": r.reason,
                    "approved_at": str(r.approved_at) if r.approved_at else None,
                    "approved_by": r.approved_by,
                    "is_active": r.is_active,
                }
                for r in raw
            ],
        }
        return decisions
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        dm.close()


@router.post("/override")
async def override_decision(req: OverrideDecisionRequest):
    dm = DecisionMemory()
    try:
        dm.override_decision(req.project_id, req.decision_key, req.new_value, req.reason)
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        dm.close()
