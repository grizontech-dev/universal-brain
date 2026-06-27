import sys, os
current_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(current_dir))
from Brain.config.database import SessionLocal
from sqlalchemy import text
db = SessionLocal()
db.execute(text("ALTER TABLE connectors DROP CONSTRAINT IF EXISTS \"connectors_userId_fkey\"; ALTER TABLE github_repositories DROP CONSTRAINT IF EXISTS \"github_repositories_userId_fkey\"; ALTER TABLE github_repositories DROP CONSTRAINT IF EXISTS \"github_repositories_connectorId_fkey\""))
db.commit()
print("FK dropped.")
