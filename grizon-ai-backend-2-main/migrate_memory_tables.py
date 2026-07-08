"""
Standalone migration script for Brain memory tables.
Run: python migrate_memory_tables.py

Creates all memory_* tables defined in Brain/memory/models.py.
Idempotent — safe to run multiple times (uses IF NOT EXISTS).
"""
import sys
import os

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from Brain.config.database import engine, Base
from Brain.memory.models import (
    Project,
    ProjectDecision,
    ExecutionLog,
    Artifact,
    Review,
    KnownError,
    SkillPerformance,
    ArchitecturePattern,
    ChangeRequest,
)


def migrate():
    print("Connecting to database...")
    print(f"  URL: {engine.url}")

    print("Creating memory tables...")
    Base.metadata.create_all(bind=engine)

    # Verify tables exist
    from sqlalchemy import inspect
    inspector = inspect(engine)
    tables = inspector.get_table_names()
    memory_tables = [t for t in tables if t.startswith("memory_")]

    print(f"\nMemory tables created/found: {len(memory_tables)}")
    for t in sorted(memory_tables):
        cols = [c["name"] for c in inspector.get_columns(t)]
        print(f"  {t} ({len(cols)} columns)")

    expected = [
        "memory_projects",
        "memory_project_decisions",
        "memory_execution_logs",
        "memory_artifacts",
        "memory_reviews",
        "memory_known_errors",
        "memory_skill_performance",
        "memory_architecture_patterns",
        "memory_change_requests",
    ]

    missing = [t for t in expected if t not in memory_tables]
    if missing:
        print(f"\nWARNING: Missing tables: {missing}")
        return False

    print("\nAll memory tables created successfully!")
    return True


if __name__ == "__main__":
    success = migrate()
    sys.exit(0 if success else 1)
