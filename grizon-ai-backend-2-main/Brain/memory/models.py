from sqlalchemy import Column, String, Integer, DateTime, JSON, Text, Boolean, Float, ARRAY, ForeignKey
from Brain.config.database import Base
from datetime import datetime
import uuid


class Project(Base):
    __tablename__ = "memory_projects"
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String, nullable=False)
    description = Column(Text)
    frontend = Column(String)
    backend = Column(String)
    database = Column(String)
    css_framework = Column(String, name="css_framework")
    auth_method = Column(String, name="auth_method")
    folder_structure = Column(JSON, name="folder_structure")
    requirements = Column(ARRAY(String), default=[])
    roadmap = Column(JSON)
    status = Column(String, default="active")
    owner_id = Column(String, name="owner_id")
    created_at = Column(DateTime, default=datetime.utcnow, name="created_at")
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, name="updated_at")


class ProjectDecision(Base):
    __tablename__ = "memory_project_decisions"
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id = Column(String, name="project_id")
    category = Column(String, nullable=False)
    decision_key = Column(String, nullable=False, name="decision_key")
    decision_val = Column(String, nullable=False, name="decision_val")
    reason = Column(Text)
    approved_at = Column(DateTime, default=datetime.utcnow, name="approved_at")
    approved_by = Column(String, default="user", name="approved_by")
    overridden_at = Column(DateTime, name="overridden_at")
    overridden_by = Column(String, name="overridden_by")
    is_active = Column(Boolean, default=True, name="is_active")


class ExecutionLog(Base):
    __tablename__ = "memory_execution_logs"
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id = Column(String, name="project_id")
    todo_id = Column(String, name="todo_id")
    task_name = Column(String, nullable=False, name="task_name")
    task_type = Column(String, name="task_type")
    agent = Column(String)
    status = Column(String, default="pending")
    output_files = Column(ARRAY(String), name="output_files")
    error_message = Column(Text, name="error_message")
    retry_count = Column(Integer, default=0, name="retry_count")
    started_at = Column(DateTime, name="started_at")
    completed_at = Column(DateTime, name="completed_at")
    duration_ms = Column(Integer, name="duration_ms")
    token_count = Column(Integer, name="token_count")
    log_metadata = Column(JSON, name="metadata", default={})


class Artifact(Base):
    __tablename__ = "memory_artifacts"
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id = Column(String, name="project_id")
    name = Column(String, nullable=False)
    artifact_type = Column(String, nullable=False, name="artifact_type")
    file_path = Column(String, nullable=False, name="file_path")
    version = Column(Integer, default=1)
    content_hash = Column(String, name="content_hash")
    dependencies = Column(ARRAY(String), default=[])
    exports = Column(ARRAY(String), default=[])
    language = Column(String)
    size_bytes = Column(Integer, name="size_bytes")
    is_active = Column(Boolean, default=True, name="is_active")
    created_by = Column(String, name="created_by")
    created_at = Column(DateTime, default=datetime.utcnow, name="created_at")
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, name="updated_at")


class Review(Base):
    __tablename__ = "memory_reviews"
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id = Column(String, name="project_id")
    artifact_id = Column(String, name="artifact_id")
    reviewed_by = Column(String, name="reviewed_by")
    quality_score = Column(Integer, name="quality_score")
    issues = Column(JSON)
    passed = Column(Boolean)
    review_type = Column(String, name="review_type")
    created_at = Column(DateTime, default=datetime.utcnow, name="created_at")


class KnownError(Base):
    __tablename__ = "memory_known_errors"
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    error_pattern = Column(String, nullable=False, name="error_pattern")
    error_type = Column(String, name="error_type")
    framework = Column(String)
    occurrence_count = Column(Integer, default=1, name="occurrence_count")
    fix_description = Column(Text, nullable=False, name="fix_description")
    fix_code = Column(Text, name="fix_code")
    success_rate = Column(Float, default=1.0, name="success_rate")
    last_seen = Column(DateTime, default=datetime.utcnow, name="last_seen")
    first_seen = Column(DateTime, default=datetime.utcnow, name="first_seen")
    tags = Column(ARRAY(String), default=[])


class SkillPerformance(Base):
    __tablename__ = "memory_skill_performance"
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    skill_name = Column(String, nullable=False, unique=True, name="skill_name")
    version = Column(String, default="1.0")
    total_uses = Column(Integer, default=0, name="total_uses")
    successful_uses = Column(Integer, default=0, name="successful_uses")
    failed_uses = Column(Integer, default=0, name="failed_uses")
    avg_score = Column(Float, default=0, name="avg_score")
    avg_token_cost = Column(Integer, default=0, name="avg_token_cost")
    avg_duration_ms = Column(Integer, default=0, name="avg_duration_ms")
    projects_used = Column(ARRAY(String), name="projects_used")
    last_used = Column(DateTime, name="last_used")
    created_at = Column(DateTime, default=datetime.utcnow, name="created_at")


class ArchitecturePattern(Base):
    __tablename__ = "memory_architecture_patterns"
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    pattern_name = Column(String, nullable=False, unique=True, name="pattern_name")
    frontend = Column(String)
    backend = Column(String)
    database = Column(String)
    auth_method = Column(String, name="auth_method")
    css_framework = Column(String, name="css_framework")
    times_used = Column(Integer, default=0, name="times_used")
    success_count = Column(Integer, default=0, name="success_count")
    success_rate = Column(Float, default=0, name="success_rate")
    avg_build_time_min = Column(Integer, name="avg_build_time_min")
    project_ids = Column(ARRAY(String), name="project_ids")
    tags = Column(ARRAY(String), default=[])
    last_used = Column(DateTime, name="last_used")
    created_at = Column(DateTime, default=datetime.utcnow, name="created_at")


class ChangeRequest(Base):
    __tablename__ = "memory_change_requests"
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id = Column(String, name="project_id")
    request_text = Column(Text, nullable=False, name="request_text")
    affected_files = Column(ARRAY(String), name="affected_files")
    affected_components = Column(ARRAY(String), name="affected_components")
    status = Column(String, default="pending")
    created_at = Column(DateTime, default=datetime.utcnow, name="created_at")
    completed_at = Column(DateTime, name="completed_at")
