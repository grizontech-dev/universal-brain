from Brain.config.database import SessionLocal
from Brain.memory.models import Review


class ReviewMemory:
    def __init__(self):
        self.db = SessionLocal()

    def store_review(self, project_id: str, artifact_id: str, review: dict) -> Review:
        r = Review(
            project_id=project_id,
            artifact_id=artifact_id,
            reviewed_by=review.get("reviewer"),
            quality_score=review.get("score"),
            issues=review.get("issues"),
            passed=review.get("score", 0) >= 70,
            review_type=review.get("type", "auto")
        )
        self.db.add(r)
        self.db.commit()
        self.db.refresh(r)
        return r

    def get_project_issues(self, project_id: str) -> list:
        reviews = self.db.query(Review).filter(
            Review.project_id == project_id
        ).order_by(Review.created_at.desc()).all()
        issues = []
        for r in reviews:
            if r.issues:
                issues.extend(r.issues)
        return issues

    def get_recurring_issues(self, project_id: str) -> list:
        all_issues = self.get_project_issues(project_id)
        counts = {}
        for issue in all_issues:
            text = issue.get("issue", "")
            counts[text] = counts.get(text, 0) + 1
        return [
            {"issue": text, "count": count}
            for text, count in sorted(counts.items(), key=lambda x: -x[1])
            if count > 1
        ]

    def close(self):
        self.db.close()
