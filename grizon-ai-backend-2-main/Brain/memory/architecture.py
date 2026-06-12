from Brain.config.database import SessionLocal
from Brain.memory.models import ArchitecturePattern
from sqlalchemy import text


class ArchitectureMemory:
    def __init__(self):
        self.db = SessionLocal()

    def record_usage(self, pattern: dict, project_id: str, succeeded: bool):
        key = f"{pattern.get('frontend', '')} + {pattern.get('backend', '')} + {pattern.get('database', '')}"
        self.db.execute(
            text("""
                INSERT INTO memory_architecture_patterns
                    (id, pattern_name, frontend, backend, database, auth_method,
                     times_used, success_count, success_rate, project_ids, last_used)
                VALUES (
                    gen_random_uuid()::text, :key, :fe, :be, :db, :auth,
                    1, :sc, :sr, ARRAY[:project]::text[], now()
                )
                ON CONFLICT (pattern_name) DO UPDATE SET
                    times_used = memory_architecture_patterns.times_used + 1,
                    success_count = memory_architecture_patterns.success_count + :sc,
                    success_rate = (memory_architecture_patterns.success_count + :sc)::float
                                    / (memory_architecture_patterns.times_used + 1),
                    last_used = now()
            """),
            {
                "key": key,
                "fe": pattern.get("frontend"),
                "be": pattern.get("backend"),
                "db": pattern.get("database"),
                "auth": pattern.get("auth"),
                "sc": 1 if succeeded else 0,
                "sr": 1.0 if succeeded else 0.0,
                "project": project_id
            }
        )
        self.db.commit()

    def get_top_patterns(self, limit: int = 5) -> list:
        return self.db.query(ArchitecturePattern).filter(
            ArchitecturePattern.times_used >= 2
        ).order_by(
            ArchitecturePattern.success_rate.desc(),
            ArchitecturePattern.times_used.desc()
        ).limit(limit).all()

    def get_best_match_for_type(self, app_type: str) -> ArchitecturePattern:
        return self.db.query(ArchitecturePattern).filter(
            ArchitecturePattern.tags.any(app_type),
            ArchitecturePattern.success_rate >= 0.8
        ).order_by(
            ArchitecturePattern.success_rate.desc(),
            ArchitecturePattern.times_used.desc()
        ).first()

    def close(self):
        self.db.close()
