from typing import Optional
from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from Brain.modules.chat.types import BrainChatRequest, BrainChatResponse
from Brain.modules.chat.service import get_brain_chat_service

router = APIRouter(prefix="/brain/chat", tags=["brain"])


class StopChatRequest(BaseModel):
    conversation_id: Optional[str] = None

@router.post("", response_model=BrainChatResponse)
async def chat(request: BrainChatRequest):
    try:
        service = get_brain_chat_service()
        data = request.dict()
        
        # Failsafe: Handle conversation_id if it's a list (frontend quirk)
        if isinstance(data.get("conversation_id"), list):
            valid_ids = [x for x in data["conversation_id"] if isinstance(x, str)]
            data["conversation_id"] = valid_ids[0] if valid_ids else None

        result = await service.process_chat(data)
        return BrainChatResponse(
            conversation_id=result["conversation_id"],
            response=result["report"],
            status=result["status"],
            todo_list=result.get("plan", []),
            report=result["report"]
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/stream")
async def chat_stream(request: BrainChatRequest):
    try:
        service = get_brain_chat_service()
        data = request.dict()

        # Failsafe: Handle conversation_id if it's a list (frontend quirk)
        if isinstance(data.get("conversation_id"), list):
            valid_ids = [x for x in data["conversation_id"] if isinstance(x, str)]
            data["conversation_id"] = valid_ids[0] if valid_ids else None

        return StreamingResponse(
            service.process_chat_stream(data),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            }
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
@router.post("/stop")
async def stop_chat(
    request: StopChatRequest = None,
    conversation_id: Optional[str] = Query(default=None),
):
    """Stop an active brain execution.
    Accepts EITHER:
    - JSON body: {"conversation_id": "..."}
    - Query param: ?conversation_id=...
    - Both (body takes priority)
    """
    # Resolve conversation_id from body first, then query param
    conv_id = (request.conversation_id if request else None) or conversation_id
    if not conv_id:
        raise HTTPException(status_code=422, detail="conversation_id is required (body or query param)")
    try:
        service = get_brain_chat_service()
        result = service.stop_execution(conv_id)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/stop/query")
async def stop_chat_query(conversation_id: str = Query(...)):
    """Stop endpoint that accepts conversation_id as a query parameter."""
    try:
        service = get_brain_chat_service()
        result = service.stop_execution(conversation_id)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
@router.get("/files/{conversation_id}")
async def get_files(conversation_id: str):
    try:
        service = get_brain_chat_service()
        return service.get_sandbox_files(conversation_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
