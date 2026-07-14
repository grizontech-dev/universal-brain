from fastapi import APIRouter, HTTPException
from Brain.modules.conversations.service import conversation_service
from Brain.config.database import SessionLocal
from Brain.modules.conversations.models import Conversation, Message
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime

brain_conversations_router = APIRouter(prefix="/brain/conversations", tags=["conversations"])

class CreateConversationRequest(BaseModel):
    user_id: str
    content: str
    repo_url: Optional[str] = None

@brain_conversations_router.post("")
async def create_conversation(request: CreateConversationRequest):
    try:
        state = {
            "user_id": request.user_id,
            "content": request.content,
            "conversation_id": "new",
            "repo_url": request.repo_url
        }
        conv_id, _ = conversation_service.ensure_brain_persistence(state)
        return {"success": True, "conversation_id": conv_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@brain_conversations_router.get("/{conversation_id}")
async def get_conversation(conversation_id: str):
    """Fetch a Brain conversation with all its messages."""
    db = SessionLocal()
    try:
        conv = db.query(Conversation).filter(Conversation.id == conversation_id).first()
        if not conv:
            raise HTTPException(status_code=404, detail="Conversation not found")

        messages = (
            db.query(Message)
            .filter(Message.conversationId == conversation_id)
            .order_by(Message.createdAt.asc())
            .all()
        )

        def serialize_dt(dt):
            return dt.isoformat() if isinstance(dt, datetime) else str(dt) if dt else None

        conv_data = {
            "id": conv.id,
            "userId": conv.userId,
            "title": conv.title,
            "status": conv.status,
            "platform": conv.platform,
            "createdAt": serialize_dt(conv.createdAt),
            "updatedAt": serialize_dt(conv.updatedAt),
        }

        serialized_messages = []
        for m in messages:
            msg = {
                "id": m.id,
                "role": m.role,
                "content": m.content or "",
                "createdAt": serialize_dt(m.createdAt),
            }
            if m.todoList:
                msg["todoList"] = m.todoList
            if m.sandboxJob:
                msg["sandboxJob"] = m.sandboxJob
            if m.extra_metadata:
                msg["metadata"] = m.extra_metadata
            serialized_messages.append(msg)

        return {"conversation": conv_data, "messages": serialized_messages}
    finally:
        db.close()


@brain_conversations_router.get("")
async def list_conversations(user_id: Optional[str] = None):
    """List Brain conversations, optionally filtered by user_id."""
    db = SessionLocal()
    try:
        query = db.query(Conversation).order_by(Conversation.updatedAt.desc())
        if user_id:
            query = query.filter(Conversation.userId == user_id)
        convs = query.limit(50).all()

        def serialize_dt(dt):
            return dt.isoformat() if isinstance(dt, datetime) else str(dt) if dt else None

        return [
            {
                "id": c.id,
                "userId": c.userId,
                "title": c.title,
                "status": c.status,
                "createdAt": serialize_dt(c.createdAt),
                "updatedAt": serialize_dt(c.updatedAt),
            }
            for c in convs
        ]
    finally:
        db.close()
