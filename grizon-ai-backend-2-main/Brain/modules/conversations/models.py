from sqlalchemy import Column, String, Integer, DateTime, JSON, Float, ForeignKey, Boolean, Text
from sqlalchemy.dialects.postgresql import UUID
from Brain.config.database import Base
from datetime import datetime
import uuid

class User(Base):
    __tablename__ = "users"
    id = Column(String, primary_key=True)
    email = Column(String, unique=True, nullable=False)
    email_normalised = Column(String, name="email_normalised", nullable=False)
    password_hash = Column(String, name="password_hash")
    role = Column(String, nullable=False, default="user")
    status = Column(String, nullable=False, default="active")
    name = Column(String, nullable=False)
    bio = Column(Text)
    avatar_url = Column(String, name="avatar_url")
    locale = Column(String)
    timezone = Column(String)
    registration_platform = Column(String, name="registration_platform", nullable=False, default="web")
    email_verified_at = Column(DateTime, name="email_verified_at")
    password_changed_at = Column(DateTime, name="password_changed_at")
    failed_login_attempts = Column(Integer, name="failed_login_attempts", nullable=False, default=0)
    locked_until = Column(DateTime, name="locked_until")
    mfa_secret = Column(String, name="mfa_secret")
    mfa_enabled = Column(Boolean, name="mfa_enabled", nullable=False, default=False)
    last_login_at = Column(DateTime, name="last_login_at")
    last_login_ip = Column(String, name="last_login_ip")
    createdAt = Column(DateTime, default=datetime.utcnow, name="created_at")
    updatedAt = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, name="updated_at")
    banned_at = Column(DateTime, name="banned_at")
    banned_by = Column(String, name="banned_by")
    ban_reason = Column(String, name="ban_reason")
    semantic_cache_optout = Column(Boolean, name="semantic_cache_optout", nullable=False, default=False)

class Conversation(Base):
    __tablename__ = "conversations"
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    userId = Column(UUID(as_uuid=False), ForeignKey("users.id"), name="user_id")
    title = Column(String)
    status = Column(String, default="active")
    platform = Column(String, default="web")
    createdAt = Column(DateTime, default=datetime.utcnow, name="created_at")
    updatedAt = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, name="updated_at")

class Message(Base):
    __tablename__ = "messages"
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    conversationId = Column(UUID(as_uuid=False), ForeignKey("conversations.id"), name="conversation_id")
    userId = Column(UUID(as_uuid=False), ForeignKey("users.id"), name="user_id")
    role = Column(String) # USER, ASSISTANT, SYSTEM
    content = Column(String)
    todoList = Column(JSON, nullable=True, name="todo_list") # Persistent project roadmap
    sandboxJob = Column(JSON, nullable=True, name="sandbox_job") # Persistent execution credentials
    extra_metadata = Column(JSON, name="metadata", nullable=True) # Extra metadata (e.g. planContent)
    createdAt = Column(DateTime, default=datetime.utcnow, name="created_at")

class BrainProject(Base):
    __tablename__ = "brain_projects"
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    userId = Column(UUID(as_uuid=False), ForeignKey("users.id"), name="user_id")
    conversationId = Column(UUID(as_uuid=False), ForeignKey("conversations.id"), name="conversation_id", unique=True)
    title = Column(String)
    repoUrl = Column(String, name="repo_url")
    status = Column(String, default="IDLE")
    createdAt = Column(DateTime, default=datetime.utcnow, name="created_at")
    updatedAt = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, name="updated_at")

class CreditWallet(Base):
    __tablename__ = "wallets"
    id = Column(String, primary_key=True)
    userId = Column(UUID(as_uuid=False), ForeignKey("users.id"), unique=True, name="user_id")
    balance = Column(Integer, default=0)
    totalEarned = Column(Integer, default=0, name="lifetime_earned")
    totalSpent = Column(Integer, default=0, name="lifetime_spent")
    updatedAt = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, name="updated_at")

class CreditTransaction(Base):
    __tablename__ = "wallet_transactions"
    id = Column(String, primary_key=True)
    walletId = Column(String, ForeignKey("wallets.id"), name="wallet_id")
    amount = Column(Integer) # positive for earned/granted, negative for spent
    balanceAfter = Column(Integer, name="balance_after")
    type = Column(String) # E.g., 'grant', 'deduct'
    reason = Column(String, name="description")
    referenceId = Column(String, nullable=True, name="job_id") # Could link to message or job
    createdAt = Column(DateTime, default=datetime.utcnow, name="created_at")

class BrainTask(Base):
    __tablename__ = "brain_tasks"
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    projectId = Column(String, ForeignKey("brain_projects.id"), name="project_id")
    label = Column(String)
    strategy = Column(String)
    agent = Column(String)
    status = Column(String, default="PENDING")
    order = Column(Integer)
    createdAt = Column(DateTime, default=datetime.utcnow, name="created_at")
