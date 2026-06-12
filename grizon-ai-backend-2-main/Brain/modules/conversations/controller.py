from fastapi import APIRouter, HTTPException, Depends
from Brain.modules.conversations.service import conversation_service
from Brain.config.database import get_db
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional, List

brain_conversations_router = APIRouter(prefix="/brain/conversations", tags=["conversations"])

class CreateConversationRequest(BaseModel):
    user_id: str
    content: str
    repo_url: Optional[str] = None

class ConversationResponse(BaseModel):
    id: str
    userId: str
    title: Optional[str]
    createdAt: str
    updatedAt: str

@brain_conversations_router.post("")
async def create_conversation(request: CreateConversationRequest):
    try:
        # We reuse the ensure_brain_persistence logic
        state = {
            "user_id": request.user_id,
            "content": request.content,
            "conversation_id": "new",
            "repo_url": request.repo_url
        }
        conv_id = conversation_service.ensure_brain_persistence(state)
        return {"success": True, "conversation_id": conv_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@brain_conversations_router.get("/{conversation_id}")
async def get_conversation(conversation_id: str):
    # This can be expanded if needed to fetch full history from Python side
    # For now, we mainly need creation
    return {"id": conversation_id}
