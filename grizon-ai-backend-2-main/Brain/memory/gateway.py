from Brain.memory.short_term import ShortTermMemory
from Brain.memory.session import SessionMemory
from Brain.memory.project import ProjectMemory
from Brain.memory.decision import DecisionMemory
from Brain.memory.execution import ExecutionMemory
from Brain.memory.artifact import ArtifactMemory
from Brain.memory.review import ReviewMemory
from Brain.memory.error import ErrorMemory
from Brain.memory.skill import SkillMemory
from Brain.memory.architecture import ArchitectureMemory
from Brain.memory.change import ChangeMemory
from Brain.memory.agent_working import AgentWorkingMemory


class MemoryGateway:
    def __init__(self, project_id: str, session_id: str):
        self.project_id = project_id
        self.session_id = session_id

        self.short_term = ShortTermMemory(session_id)
        self.session = SessionMemory(session_id)
        self.project = ProjectMemory()
        self.decisions = DecisionMemory()
        self.execution = ExecutionMemory()
        self.artifacts = ArtifactMemory()
        self.reviews = ReviewMemory()
        self.errors = ErrorMemory()
        self.skills = SkillMemory()
        self.architecture = ArchitectureMemory()
        self.change = ChangeMemory()
        self.agent_wm = AgentWorkingMemory("Builder", session_id)
        self.long_term = None
        self.impact = None

    def _get_long_term(self):
        if self.long_term is None:
            from Brain.memory.long_term import LongTermMemory
            self.long_term = LongTermMemory()
        return self.long_term

    def _get_impact(self):
        if self.impact is None:
            from Brain.memory.impact import QdrantImpactAnalysis
            self.impact = QdrantImpactAnalysis()
        return self.impact

    async def build_agent_context(self, agent_name: str) -> dict:
        recent = await self.short_term.get_recent(10)
        active_decisions = self.decisions.get_active_decisions(self.project_id)
        project_info = self.project.get_by_id(self.project_id)

        # New project (no record yet): skip all queries that require project data.
        # Running 8+ sequential remote-DB queries here before the workflow starts
        # is what makes the first prompt hang for 60-70s on hosted.
        if not project_info:
            return {
                "conversation": recent,
                "decisions": active_decisions,
                "project": None,
                "known_errors": [],
                "execution_status": None,
                "session_state": await self.session.get_all(),
                "artifact_components": [],
                "registered_artifacts": [],
                "recent_reviews": [],
                "best_skills": [],
                "architecture_patterns": [],
                "recent_changes": [],
                "similar_projects": [],
            }

        recent_errors = (
            self.errors.find_fix("recent", project_info.frontend)
            if project_info and project_info.frontend
            else []
        )
        exec_summary = self.execution.get_project_summary(self.project_id)
        session_state = await self.session.get_all()

        artifact_components = self.artifacts.get_all_components(self.project_id)
        all_artifacts = self.artifacts.get_all(self.project_id)

        # ReviewMemory — recent quality reviews
        recent_reviews = []
        try:
            reviews = self.reviews.get_project_issues(self.project_id)
            recent_reviews = reviews if isinstance(reviews, list) else []
        except Exception:
            pass

        # SkillMemory — best performing agents/skills
        best_skills = []
        try:
            skills = self.skills.get_best_skills(5)
            best_skills = [
                {"name": s["skill_name"], "uses": s["total_uses"], "score": s["avg_score"]}
                for s in skills
            ] if skills else []
        except Exception:
            pass

        # ArchitectureMemory — battle-tested tech patterns
        top_patterns = []
        try:
            patterns = self.architecture.get_top_patterns(3)
            top_patterns = [
                {"pattern": p.pattern_name, "uses": p.times_used, "success_rate": p.success_rate}
                for p in patterns
            ] if patterns else []
        except Exception:
            pass

        # ChangeMemory — recent change requests
        recent_changes = []
        try:
            changes = self.change.get_project_changes(self.project_id)
            recent_changes = [
                {"request": c.request_text, "status": c.status}
                for c in changes[:5]
            ] if changes else []
        except Exception:
            pass

        # LongTermMemory — similar past projects (semantic search)
        similar_projects = []
        try:
            if project_info and project_info.description:
                similar = self._get_long_term().semantic_search(project_info.description, limit=3)
                similar_projects = similar if isinstance(similar, list) else []
        except Exception:
            pass

        return {
            "conversation": recent,
            "decisions": active_decisions,
            "project": project_info,
            "known_errors": recent_errors,
            "execution_status": exec_summary,
            "session_state": session_state,
            "artifact_components": [
                {"name": a.name, "file_path": a.file_path, "type": a.artifact_type, "version": a.version}
                for a in artifact_components
            ],
            "registered_artifacts": [
                {"name": a.name, "file_path": a.file_path, "type": a.artifact_type, "version": a.version}
                for a in all_artifacts
            ],
            "recent_reviews": recent_reviews,
            "best_skills": best_skills,
            "architecture_patterns": top_patterns,
            "recent_changes": recent_changes,
            "similar_projects": similar_projects,
        }

    async def analyze_change_impact(self, change_request: str) -> dict:
        similar = self._get_long_term().semantic_search(change_request, limit=3)
        impact = self._get_impact().impact_analysis(change_request, self.project_id)
        components = self.artifacts.get_all_components(self.project_id)

        return {
            "similar_past_context": similar,
            "impacted_components": impact,
            "all_components": components
        }

    def close_all(self):
        self.project.close()
        self.decisions.close()
        self.execution.close()
        self.artifacts.close()
        self.reviews.close()
        self.errors.close()
        self.skills.close()
        self.architecture.close()
        self.change.close()
