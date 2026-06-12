import os
import sys
current_dir = os.path.dirname(os.path.abspath(__file__))
parent_dir = os.path.dirname(current_dir)
if parent_dir not in sys.path:
    sys.path.insert(0, parent_dir)

from Brain.config.database import SessionLocal
from Brain.modules.conversations.models import User

def create_test_user():
    db = SessionLocal()
    user_id = "test_user_123"
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        print(f"Creating test user: {user_id}")
        # Need to provide email and role due to NOT NULL constraints
        user = User(id=user_id, email="test@example.com", role="USER")
        db.add(user)
        db.commit()
        print("User created.")
    else:
        print("User already exists.")
    db.close()

if __name__ == "__main__":
    create_test_user()
