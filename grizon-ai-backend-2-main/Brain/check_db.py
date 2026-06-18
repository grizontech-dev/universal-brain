from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
import os
from Brain.modules.conversations.models import Conversation, Message, BrainProject

engine = create_engine("postgresql://app:app@localhost:5432/app")
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

db = SessionLocal()
convs = db.query(Conversation).order_by(Conversation.createdAt.desc()).limit(1).all()
if not convs:
    print("No conversations")
else:
    c = convs[0]
    print(f"Conversation: {c.id} title: {c.title} userId: {c.userId}")
    msgs = db.query(Message).filter(Message.conversationId == c.id).order_by(Message.createdAt.asc()).all()
    print(f"Messages: {len(msgs)}")
    for m in msgs:
        print(f" - {m.role}: {m.content[:50]} | metadata: {bool(m.extra_metadata)}")
