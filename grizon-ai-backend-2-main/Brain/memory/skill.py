from Brain.config.database import SessionLocal
from sqlalchemy import text


class SkillMemory:
    def __init__(self):
        self.db = SessionLocal()

    def record_usage(self, skill_name: str, project_id: str, outcome: dict):
        self.db.execute(
            text("""
                INSERT INTO memory_skill_performance (skill_name, total_uses, successful_uses, failed_uses,
                    avg_score, avg_token_cost, avg_duration_ms, projects_used, last_used)
                VALUES (
                    :name, 1,
                    :success, :failure,
                    :score, :token_cost, :duration,
                    ARRAY[:project]::text[], now()
                )
                ON CONFLICT (skill_name) DO UPDATE SET
                    total_uses = memory_skill_performance.total_uses + 1,
                    successful_uses = memory_skill_performance.successful_uses + :success,
                    failed_uses = memory_skill_performance.failed_uses + :failure,
                    avg_score = (memory_skill_performance.avg_score * memory_skill_performance.total_uses + :score)
                                 / (memory_skill_performance.total_uses + 1),
                    avg_token_cost = (memory_skill_performance.avg_token_cost * memory_skill_performance.total_uses + :token_cost)
                                      / (memory_skill_performance.total_uses + 1),
                    last_used = now()
            """),
            {
                "name": skill_name,
                "success": 1 if outcome.get("success") else 0,
                "failure": 0 if outcome.get("success") else 1,
                "score": outcome.get("score", 0),
                "token_cost": outcome.get("tokenCost", 0),
                "duration": outcome.get("durationMs", 0),
                "project": project_id
            }
        )
        self.db.commit()

    def get_best_skills(self, limit: int = 5) -> list:
        results = self.db.execute(
            text("""
                SELECT skill_name, avg_score, total_uses,
                       (successful_uses::float / NULLIF(total_uses, 0)) as success_rate
                FROM memory_skill_performance
                ORDER BY avg_score DESC, success_rate DESC
                LIMIT :lim
            """),
            {"lim": limit}
        )
        return [dict(row) for row in results]

    def close(self):
        self.db.close()
