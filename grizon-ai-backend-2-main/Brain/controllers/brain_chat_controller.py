from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from Brain.models.chat_models import BrainChatRequest, BrainChatResponse
from Brain.modules.chat.service import BrainChatService
import json

router = APIRouter(prefix="/brain", tags=["brain"])
chat_service = BrainChatService()

@router.post("/chat", response_model=BrainChatResponse)
async def chat(request: BrainChatRequest):
    try:
        result = await chat_service.process_chat(request.dict())
        print(f"DEBUG: result keys: {result.keys()}")
        return BrainChatResponse(
            conversation_id=result["conversation_id"],
            response=result["report"],
            status=result["status"],
            todo_list=result["plan"],
            report=result["report"]
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/chat/stream")
async def chat_stream(request: BrainChatRequest):
    try:
        return StreamingResponse(
            chat_service.process_chat_stream(request.dict()),
            media_type="text/event-stream"
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
