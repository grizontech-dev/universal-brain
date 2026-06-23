import sys, os
current_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(current_dir))
from Brain.config.database import SessionLocal
from sqlalchemy import text
db = SessionLocal()
db.execute(text("INSERT INTO users (id, email, email_normalised, password_hash, role, status, name, created_at, updated_at, registration_platform) VALUES ('test_user_123', 'test@example.com', 'test@example.com', 'dummy', 'USER', 'ACTIVE', 'Test User', now(), now(), 'email') ON CONFLICT DO NOTHING"))
db.commit()
print("Test user inserted via SQL.")
