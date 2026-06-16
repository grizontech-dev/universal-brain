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
        recent_errors = (
            self.errors.find_fix("recent", project_info.frontend)
            if project_info and project_info.frontend
            else []
        )
        exec_summary = self.execution.get_project_summary(self.project_id)
        session_state = await self.session.get_all()

        artifact_components = self.artifacts.get_all_components(self.project_id)
        all_artifacts = self.artifacts.get_all(self.project_id)

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
            ]
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
