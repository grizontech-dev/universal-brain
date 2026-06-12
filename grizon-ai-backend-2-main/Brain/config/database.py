import os
from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from dotenv import load_dotenv

print("Loading .env...")
load_dotenv()
print(".env loaded")

DATABASE_URL = os.getenv("DATABASE_URL")
print(f"DATABASE_URL: {DATABASE_URL}")
engine = create_engine(DATABASE_URL)
print("Engine created")
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
print("SessionLocal created")
Base = declarative_base()
print("Base created")

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
