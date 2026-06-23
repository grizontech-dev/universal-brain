import sys, os
current_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(current_dir))

from Brain.config.database import SessionLocal
from sqlalchemy import text
db = SessionLocal()
res = db.execute(text("SELECT * FROM connectors")).fetchall()
print("Connectors in DB:", res)
