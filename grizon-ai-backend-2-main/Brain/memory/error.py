from Brain.config.database import SessionLocal
from Brain.memory.models import KnownError
from datetime import datetime
from sqlalchemy import text


class ErrorMemory:
    def __init__(self):
        self.db = SessionLocal()

    def record_error(self, error_pattern: str, framework: str, error_type: str, fix: dict):
        existing = self.db.query(KnownError).filter(
            KnownError.error_pattern == error_pattern,
            KnownError.framework == framework
        ).first()

        if existing:
            existing.occurrence_count += 1
            existing.last_seen = datetime.utcnow()
            self.db.commit()
        else:
            err = KnownError(
                error_pattern=error_pattern,
                error_type=error_type,
                framework=framework,
                fix_description=fix.get("description", ""),
                fix_code=fix.get("code"),
                tags=fix.get("tags", [])
            )
            self.db.add(err)
            self.db.commit()

    def find_fix(self, error_pattern: str, framework: str) -> list:
        results = self.db.execute(
            text("""
                SELECT *, ts_rank(to_tsvector('english', error_pattern),
                    plainto_tsquery('english', :pattern)) as rank
                FROM memory_known_errors
                WHERE framework = :framework
                  AND to_tsvector('english', error_pattern) @@ plainto_tsquery('english', :pattern)
                ORDER BY rank DESC, success_rate DESC, occurrence_count DESC
                LIMIT 3
            """),
            {"pattern": error_pattern, "framework": framework}
        )
        return [dict(row) for row in results]

    def mark_fix_success(self, error_id: str):
        err = self.db.query(KnownError).filter(KnownError.id == error_id).first()
        if err:
            new_rate = min(1.0, err.success_rate + 0.05)
            err.success_rate = new_rate
            self.db.commit()

    def close(self):
        self.db.close()
