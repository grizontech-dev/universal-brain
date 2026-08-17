import os
from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from dotenv import load_dotenv

load_dotenv(dotenv_path=os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), '.env'))

DATABASE_URL = os.getenv("DATABASE_URL")
if DATABASE_URL and DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

if not DATABASE_URL:
    raise RuntimeError(
        "[DATABASE] FATAL: DATABASE_URL environment variable is not set. "
        "The Brain backend cannot start without a database connection. "
        "Set DATABASE_URL in your .env file."
    )

engine = create_engine(
    DATABASE_URL,
    pool_size=10,
    max_overflow=20,
    pool_timeout=30,  # increased from 5s — prevents pool exhaustion under load
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# Import models so they are registered with Base.metadata
import Brain.memory.models  # noqa: E402, F401
import Brain.modules.conversations.models  # noqa: E402, F401
import Brain.modules.connectors.supabase.service  # noqa: E402, F401
import Brain.modules.connectors.github.service  # noqa: E402, F401

# Create all tables on startup (if database is available)
try:
    Base.metadata.create_all(bind=engine)
except Exception as _db_err:
    print(f"[DATABASE] Warning: DB connection skipped on import: {_db_err}")

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
