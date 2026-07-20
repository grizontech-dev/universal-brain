from fastapi import APIRouter, HTTPException
from Brain.modules.conversations.service import conversation_service
from Brain.config.database import SessionLocal
from Brain.modules.conversations.models import Conversation, Message
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime
import os
import psycopg2

brain_conversations_router = APIRouter(prefix="/brain/conversations", tags=["conversations"])

# Fallback connection to grizon_db (Node.js backend database)
GRIZON_DB_URL = os.environ.get("GRIZON_DB_URL", "postgresql://grizon_user:grizon_password_123@postgres:5432/grizon_db")

def _get_grizon_db():
    return psycopg2.connect(GRIZON_DB_URL)

def _fetch_conv_from_grizon_db(conversation_id: str):
    """Fallback: fetch conversation from grizon_db when not found in app DB."""
    try:
        conn = _get_grizon_db()
        cur = conn.cursor()
        cur.execute("SELECT id, user_id, title, status, platform, created_at, updated_at FROM conversations WHERE id = %s", (conversation_id,))
        row = cur.fetchone()
        if not row:
            return None
        # Also fetch messages
        cur.execute("SELECT id, role, content, created_at FROM messages WHERE conversation_id = %s ORDER BY created_at ASC", (conversation_id,))
        msgs = cur.fetchall()
        cur.close()
        conn.close()
        return {
            "conversation": {
                "id": row[0], "userId": row[1], "title": row[2],
                "status": row[3], "platform": row[4],
                "createdAt": row[5].isoformat() if row[5] else None,
                "updatedAt": row[6].isoformat() if row[6] else None,
            },
            "messages": [
                {"id": m[0], "role": m[1], "content": m[2] or "", "createdAt": m[3].isoformat() if m[3] else None}
                for m in msgs
            ]
        }
    except Exception as e:
        print(f"[conversations] grizon_db fallback error: {e}")
        return None

def _list_conv_from_grizon_db(user_id: str = None):
    """Fallback: list conversations from grizon_db."""
    try:
        conn = _get_grizon_db()
        cur = conn.cursor()
        if user_id:
            cur.execute("SELECT id, user_id, title, status, created_at, updated_at FROM conversations WHERE user_id = %s ORDER BY updated_at DESC LIMIT 50", (user_id,))
        else:
            cur.execute("SELECT id, user_id, title, status, created_at, updated_at FROM conversations ORDER BY updated_at DESC LIMIT 50")
        rows = cur.fetchall()
        cur.close()
        conn.close()
        return [
            {
                "id": r[0], "userId": r[1], "title": r[2], "status": r[3],
                "createdAt": r[4].isoformat() if r[4] else None,
                "updatedAt": r[5].isoformat() if r[5] else None,
            }
            for r in rows
        ]
    except Exception as e:
        print(f"[conversations] grizon_db list fallback error: {e}")
        return []

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
            # Fallback: check grizon_db (Node.js backend database)
            result = _fetch_conv_from_grizon_db(conversation_id)
            if result:
                return result
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

        app_convs = [
            {
                "id": c.id,
                "userId": c.userId,
                "title": c.title,
                "status": c.status,
                "createdAt": c.createdAt.isoformat() if isinstance(c.createdAt, datetime) else str(c.createdAt) if c.createdAt else None,
                "updatedAt": c.updatedAt.isoformat() if isinstance(c.updatedAt, datetime) else str(c.updatedAt) if c.updatedAt else None,
            }
            for c in convs
        ]

        # Also fetch from grizon_db and merge (dedup by id)
        grizon_convs = _list_conv_from_grizon_db(user_id)
        seen_ids = {c["id"] for c in app_convs}
        for gc in grizon_convs:
            if gc["id"] not in seen_ids:
                app_convs.append(gc)

        # Sort by updatedAt desc
        app_convs.sort(key=lambda c: c.get("updatedAt") or "", reverse=True)
        return app_convs[:50]
    finally:
        db.close()
