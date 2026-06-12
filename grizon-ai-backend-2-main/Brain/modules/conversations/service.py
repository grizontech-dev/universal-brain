from Brain.config.database import SessionLocal
from Brain.modules.conversations.models import Conversation, Message, BrainProject, CreditWallet, CreditTransaction, User
from datetime import datetime
import uuid
import re
from typing import Dict, Any

def _ensure_uuid(user_id: str) -> str:
    """Ensure user_id is a valid UUID, generate one if not."""
    uuid_pattern = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', re.I)
    if uuid_pattern.match(user_id):
        return user_id
    # Generate a deterministic UUID from the string for consistency
    return str(uuid.uuid5(uuid.NAMESPACE_DNS, user_id))

def _ensure_user_exists(db, user_id: str):
    """Ensure a user exists in the database for the given user_id."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        # Use existing system user for anonymous/unknown users
        system_user_id = "00000000-0000-0000-0000-000000000001"
        user = db.query(User).filter(User.id == system_user_id).first()
        if user:
            return system_user_id
        # Fallback: create minimal user (requires all NOT NULL columns)
        # This shouldn't happen in practice since system user exists
        raise Exception(f"User {user_id} not found and system user not available")
    return user_id

class ConversationService:
    @staticmethod
    def deduct_credits(user_id: str, amount: int, reason: str, reference_id: str = None) -> bool:
        """Deducts credits from user wallet and logs transaction."""
        db = SessionLocal()
        try:
            wallet = db.query(CreditWallet).filter(CreditWallet.userId == user_id).first()
            if not wallet:
                print(f"ERROR: No wallet found for user {user_id}")
                return False
            
            if wallet.balance < amount:
                print(f"ERROR: Insufficient credits for user {user_id}")
                # We still deduct if it's a critical system task or handle it elsewhere
                # For now, let's just return false
                return False
            
            # Update wallet
            wallet.balance -= amount
            wallet.totalSpent += amount
            wallet.updatedAt = datetime.utcnow()
            
            # Log transaction
            transaction = CreditTransaction(
                id=str(uuid.uuid4()),
                walletId=wallet.id,
                amount=-amount,
                balanceAfter=wallet.balance,
                type="deduct",
                reason=reason,
                createdAt=datetime.utcnow()
            )
            db.add(transaction)
            db.commit()
            print(f"SUCCESS: Deducted {amount} credits from user {user_id} for {reason}")
            return True
        except Exception as e:
            db.rollback()
            print(f"ERROR: Failed to deduct credits: {e}")
            return False
        finally:
            db.close()

    @staticmethod
    def ensure_brain_persistence(state: Dict[str, Any]) -> str:
        """Ensures Conversation, initial Message, and BrainProject exist in DB."""
        db = SessionLocal()
        try:
            conv_id = state.get("conversation_id")
            if conv_id == "new":
                conv_id = None
            
            # 1. Handle Conversation creation/verification
            existing_conv = None
            if conv_id:
                try:
                    uuid.UUID(conv_id)
                    existing_conv = db.query(Conversation).filter(Conversation.id == conv_id).first()
                except (ValueError, AttributeError):
                    conv_id = None
                    existing_conv = None
            
            if not existing_conv:
                # If no ID provided or ID doesn't exist, create new
                if not conv_id:
                    conv_id = str(uuid.uuid4())
                
                user_id = _ensure_uuid(state["user_id"])
                user_id = _ensure_user_exists(db, user_id)
                new_conv = Conversation(
                    id=conv_id,
                    userId=user_id,
                    title=state["content"][:60],
                    status="active",
                    platform="web",
                    createdAt=datetime.utcnow(),
                    updatedAt=datetime.utcnow()
                )
                db.add(new_conv)
                db.flush() # Ensure it's in the session so FKs can reference it
                
                # Create BrainProject
                project = BrainProject(
                    id=str(uuid.uuid4()),
                    userId=user_id,
                    conversationId=conv_id,
                    title=state["content"][:50],
                    repoUrl=state.get("repo_url"),
                    status="ANALYZING",
                    createdAt=datetime.utcnow(),
                    updatedAt=datetime.utcnow()
                )
                db.add(project)
                
                # Save Initial User Message
                user_msg = Message(
                    id=str(uuid.uuid4()),
                    conversationId=conv_id,
                    userId=user_id,
                    role="user",
                    content=state["content"],
                    createdAt=datetime.utcnow()
                )
                db.add(user_msg)
                db.commit()
            else:
                # Existing conversation exists, ensure BrainProject exists
                project = db.query(BrainProject).filter(BrainProject.conversationId == conv_id).first()
                user_id = _ensure_uuid(state["user_id"])
                user_id = _ensure_user_exists(db, user_id)
                if not project:
                    project = BrainProject(
                        id=str(uuid.uuid4()),
                        userId=user_id,
                        conversationId=conv_id,
                        title=state["content"][:50],
                        repoUrl=state.get("repo_url"),
                        status="ANALYZING",
                        createdAt=datetime.utcnow(),
                        updatedAt=datetime.utcnow()
                    )
                    db.add(project)
                elif project.repoUrl:
                    # Load existing repoUrl into state if current state is missing it
                    if not state.get("repo_url"):
                        state["repo_url"] = project.repoUrl
                
                # Save follow-up user message only if it's different from the last one or enough time passed
                # To prevent the double-save issue when stream API is called right after create API
                last_msg = db.query(Message).filter(
                    Message.conversationId == conv_id, 
                    Message.role == "user"
                ).order_by(Message.createdAt.desc()).first()
                
                if not last_msg or last_msg.content.strip() != state["content"].strip():
                    user_msg = Message(
                        id=str(uuid.uuid4()),
                        conversationId=conv_id,
                        userId=user_id,
                        role="user",
                        content=state["content"],
                        createdAt=datetime.utcnow()
                    )
                    db.add(user_msg)
                db.commit()
            return conv_id, state.get("repo_url")
        except Exception as e:
            db.rollback()
            raise e
        finally:
            db.close()

    @staticmethod
    def update_titles(conversation_id: str, title: str):
        """Updates both Conversation and BrainProject titles."""
        db = SessionLocal()
        try:
            db.query(Conversation).filter(Conversation.id == conversation_id).update({"title": title})
            db.query(BrainProject).filter(BrainProject.conversationId == conversation_id).update({"title": title})
            db.commit()
        finally:
            db.close()

    @staticmethod
    def save_message(conversation_id: str, role: str, content: str, todo_list: list = None, sandbox_job: dict = None, metadata: dict = None):
        """Saves a message to the database with optional metadata."""
        db = SessionLocal()
        try:
            conv = db.query(Conversation).filter(Conversation.id == conversation_id).first()
            user_id = conv.userId if conv else "00000000-0000-0000-0000-000000000000"
            msg = Message(
                id=str(uuid.uuid4()),
                conversationId=conversation_id,
                userId=user_id,
                role=role.lower(),
                content=content,
                todoList=todo_list,
                sandboxJob=sandbox_job,
                extra_metadata=metadata,
                createdAt=datetime.utcnow()
            )
            print(f"DEBUG: Saving message to DB - Conv: {conversation_id}, Role: {role}, Content Snippet: {content[:30]}")
            db.add(msg)
            db.commit()
            print("DEBUG: Message saved successfully.")
        finally:
            db.close()

    @staticmethod
    def get_messages(conversation_id: str) -> list:
        """Fetches all messages for a given conversation ID."""
        db = SessionLocal()
        try:
            messages = db.query(Message).filter(Message.conversationId == conversation_id).order_by(Message.createdAt.asc()).all()
            return [
                {
                    "role": m.role or "user", 
                    "content": m.content or "",
                    "todoList": m.todoList,
                    "sandboxJob": m.sandboxJob,
                    "metadata": m.extra_metadata
                } for m in messages
            ]
        finally:
            db.close()

conversation_service = ConversationService()
