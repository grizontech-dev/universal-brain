# BuilderBrain — Enterprise Memory Architecture
## Complete Implementation Guide

---

## Technology Stack Overview

| Layer | Technology | Role |
|---|---|---|
| Permanent Store | PostgreSQL 16 (via SQLAlchemy) | Source of truth for all structured memory |
| Semantic Search | Qdrant (vector DB) | Embedding-based retrieval across projects |
| Live State | Redis 7 | Session, agent scratchpads, workflow state |
| Embeddings | OpenAI text-embedding-3-small | Converts text → vectors (1536 dim) |
| ORM | SQLAlchemy 2.0 (sync) + Alembic | Database access & migrations |

---

## Architecture Diagram (Text)

```
                          BuilderBrain
                                │
                                ▼
                        Memory Gateway API
                                │
        ┌───────────────────────┼───────────────────────┐
        │                       │                       │
        ▼                       ▼                       ▼
   PostgreSQL               Redis                  Qdrant
(Source of Truth)       (Live State)        (Semantic Retrieval)
```

---

## Memory Layer 1 — ShortTermMemory

### Purpose
Holds the active conversation turns for the current user session. Agents read this to understand "what is happening right now."

### Storage: Redis

### Data Structure
```
Key:   short_term:{session_id}
Type:  Redis List (LPUSH / LRANGE)
TTL:   3 hours
```

### Schema
```json
{
  "role": "user | assistant | agent",
  "content": "Build me a food delivery app",
  "timestamp": "2025-01-15T10:30:00Z",
  "agent": "LeaderAgent | PlannerAgent | null"
}
```

### Implementation (Python)
```python
import json
import redis.asyncio as aioredis
from datetime import datetime

redis_client = aioredis.from_url("redis://redis:6379", decode_responses=True)

class ShortTermMemory:
    def __init__(self, session_id: str):
        self.key = f"short_term:{session_id}"
        self.ttl = 3 * 60 * 60  # 3 hours

    async def append(self, role: str, content: str, agent: str = None):
        entry = json.dumps({
            "role": role,
            "content": content,
            "agent": agent,
            "timestamp": datetime.utcnow().isoformat()
        })
        await redis_client.lpush(self.key, entry)
        await redis_client.expire(self.key, self.ttl)

    async def get_recent(self, limit: int = 20) -> list:
        raw = await redis_client.lrange(self.key, 0, limit - 1)
        entries = [json.loads(r) for r in raw]
        entries.reverse()  # chronological
        return entries

    async def clear(self):
        await redis_client.delete(self.key)
```

### When Agents Use It
- Every agent reads the last 10–20 messages before acting
- PlannerAgent reads it to understand original user requirements
- BuilderAgent reads it to avoid contradicting previous decisions

---

## Memory Layer 2 — SessionMemory

### Purpose
Tracks the active workflow state: which agent is running, what phase the project is in, current task queue.

### Storage: Redis

### Data Structure
```
Key:   session:{session_id}
Type:  Redis Hash
TTL:   24 hours
```

### Schema
```json
{
  "workflow_state": "planning | todo_generation | building | reviewing | done",
  "current_agent": "FrontendAgent",
  "current_task_id": "task_abc123",
  "project_id": "proj_xyz",
  "started_at": "2025-01-15T09:00:00Z",
  "last_active": "2025-01-15T10:45:00Z"
}
```

### Implementation (Python)
```python
class SessionMemory:
    def __init__(self, session_id: str):
        self.key = f"session:{session_id}"
        self.ttl = 24 * 60 * 60

    async def set(self, field: str, value):
        await redis_client.hset(self.key, field, json.dumps(value))
        await redis_client.expire(self.key, self.ttl)

    async def get(self, field: str):
        val = await redis_client.hget(self.key, field)
        return json.loads(val) if val else None

    async def get_all(self) -> dict:
        all_fields = await redis_client.hgetall(self.key)
        return {k: json.loads(v) for k, v in all_fields.items()}

    async def update_workflow_state(self, state: str, agent_name: str):
        await self.set("workflow_state", state)
        await self.set("current_agent", agent_name)
        await self.set("last_active", datetime.utcnow().isoformat())
```

---

## Memory Layer 3 — ProjectMemory

### Purpose
The permanent record of a project: its name, stack, folder structure, requirements, and roadmap.

### Storage: PostgreSQL

### Schema
```sql
CREATE TABLE projects (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  description     TEXT,
  frontend        TEXT,
  backend         TEXT,
  database        TEXT,
  css_framework   TEXT,
  auth_method     TEXT,
  folder_structure JSONB,
  requirements    TEXT[],
  roadmap         JSONB,
  status          TEXT DEFAULT 'active',
  owner_id        UUID,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_projects_owner ON projects(owner_id);
CREATE INDEX idx_projects_status ON projects(status);
```

### SQLAlchemy Model
```python
from sqlalchemy import Column, String, Integer, DateTime, JSON, ForeignKey, Text, Boolean, Float, ARRAY
from Brain.config.database import Base
from datetime import datetime
import uuid

class Project(Base):
    __tablename__ = "projects"
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
    owner_id = Column(String, ForeignKey("users.id"), name="owner_id")
    created_at = Column(DateTime, default=datetime.utcnow, name="created_at")
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, name="updated_at")
```

### Implementation (Python)
```python
from Brain.config.database import SessionLocal
from sqlalchemy import text

class ProjectMemory:
    def __init__(self):
        self.db = SessionLocal()

    def create(self, project_data: dict) -> Project:
        project = Project(
            name=project_data["name"],
            description=project_data.get("description"),
            frontend=project_data.get("frontend"),
            backend=project_data.get("backend"),
            database=project_data.get("database"),
            css_framework=project_data.get("cssFramework"),
            auth_method=project_data.get("authMethod"),
            requirements=project_data.get("requirements", []),
            status="active"
        )
        self.db.add(project)
        self.db.commit()
        self.db.refresh(project)
        return project

    def get_by_id(self, project_id: str) -> Project:
        return self.db.query(Project).filter(Project.id == project_id).first()

    def update_stack(self, project_id: str, stack_updates: dict):
        self.db.query(Project).filter(Project.id == project_id).update({
            **stack_updates,
            "updated_at": datetime.utcnow()
        })
        self.db.commit()

    def append_requirement(self, project_id: str, requirement: str):
        self.db.execute(
            text("UPDATE projects SET requirements = array_append(requirements, :req), updated_at = now() WHERE id = :pid"),
            {"req": requirement, "pid": project_id}
        )
        self.db.commit()
```

---

## Memory Layer 4 — DecisionMemory (CRITICAL)

### Purpose
Stores every decision the user approves. This is the source of truth that all agents must respect. Prevents agents from "forgetting" approved choices.

### Storage: PostgreSQL

### Schema
```sql
CREATE TABLE project_decisions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID REFERENCES projects(id) ON DELETE CASCADE,
  category      TEXT NOT NULL,
  decision_key  TEXT NOT NULL,
  decision_val  TEXT NOT NULL,
  reason        TEXT,
  approved_at   TIMESTAMPTZ DEFAULT now(),
  approved_by   TEXT DEFAULT 'user',
  overridden_at TIMESTAMPTZ,
  overridden_by TEXT,
  is_active     BOOLEAN DEFAULT true
);

CREATE INDEX idx_decisions_project ON project_decisions(project_id);
CREATE INDEX idx_decisions_active ON project_decisions(project_id, is_active);
```

### SQLAlchemy Model
```python
class ProjectDecision(Base):
    __tablename__ = "project_decisions"
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id = Column(String, ForeignKey("projects.id", ondelete="CASCADE"), name="project_id")
    category = Column(String, nullable=False)
    decision_key = Column(String, nullable=False, name="decision_key")
    decision_val = Column(String, nullable=False, name="decision_val")
    reason = Column(Text)
    approved_at = Column(DateTime, default=datetime.utcnow, name="approved_at")
    approved_by = Column(String, default="user", name="approved_by")
    overridden_at = Column(DateTime, name="overridden_at")
    overridden_by = Column(String, name="overridden_by")
    is_active = Column(Boolean, default=True, name="is_active")
```

### Full Decision Object (after user approval)
```json
{
  "project_id": "proj_xyz",
  "decisions": {
    "frontend": "React",
    "database": "Supabase",
    "theme": "Dark",
    "auth": "JWT",
    "css": "Tailwind",
    "api_style": "REST"
  }
}
```

### Implementation (Python)
```python
class DecisionMemory:
    def __init__(self):
        self.db = SessionLocal()

    def store_approved_decisions(self, project_id: str, decisions: dict):
        category_map = {
            "frontend": "stack", "backend": "stack", "database": "stack",
            "theme": "ui", "css": "ui",
            "auth": "security", "api_style": "architecture"
        }
        rows = []
        for key, val in decisions.items():
            rows.append(ProjectDecision(
                project_id=project_id,
                category=category_map.get(key, "general"),
                decision_key=key,
                decision_val=val,
                approved_by="user"
            ))
        self.db.bulk_save_objects(rows)
        self.db.commit()

    def get_active_decisions(self, project_id: str) -> dict:
        rows = self.db.query(ProjectDecision).filter(
            ProjectDecision.project_id == project_id,
            ProjectDecision.is_active == True
        ).all()
        return {r.decision_key: r.decision_val for r in rows}

    def override_decision(self, project_id: str, key: str, new_val: str, reason: str = None):
        self.db.query(ProjectDecision).filter(
            ProjectDecision.project_id == project_id,
            ProjectDecision.decision_key == key,
            ProjectDecision.is_active == True
        ).update({
            "is_active": False,
            "overridden_at": datetime.utcnow(),
            "overridden_by": "user"
        })
        category_map = {
            "frontend": "stack", "backend": "stack", "database": "stack",
            "theme": "ui", "css": "ui",
            "auth": "security", "api_style": "architecture"
        }
        new_decision = ProjectDecision(
            project_id=project_id,
            category=category_map.get(key, "general"),
            decision_key=key,
            decision_val=new_val,
            reason=reason,
            approved_by="user"
        )
        self.db.add(new_decision)
        self.db.commit()
```

### Agent Usage
```python
# Every agent does this before starting work:
decisions = decision_memory.get_active_decisions(project_id)
# -> {"frontend": "React", "database": "Supabase", "auth": "JWT", "theme": "Dark"}
# Agent now uses ONLY these values. No guessing.
```

---

## Memory Layer 5 — ExecutionMemory

### Purpose
Tracks every task: what was generated, what failed, retries, build logs. Prevents re-generation of already-completed work.

### Storage: PostgreSQL

### Schema
```sql
CREATE TYPE task_status AS ENUM ('pending', 'in_progress', 'completed', 'failed', 'retrying', 'skipped');

CREATE TABLE execution_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID REFERENCES projects(id) ON DELETE CASCADE,
  todo_id       UUID,
  task_name     TEXT NOT NULL,
  task_type     TEXT,
  agent         TEXT,
  status        task_status DEFAULT 'pending',
  output_files  TEXT[],
  error_message TEXT,
  retry_count   INT DEFAULT 0,
  started_at    TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ,
  duration_ms   INT,
  token_count   INT,
  metadata      JSONB DEFAULT '{}'
);

CREATE INDEX idx_exec_project_status ON execution_logs(project_id, status);
CREATE INDEX idx_exec_task_name ON execution_logs(project_id, task_name);
```

### SQLAlchemy Model
```python
class ExecutionLog(Base):
    __tablename__ = "execution_logs"
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id = Column(String, ForeignKey("projects.id", ondelete="CASCADE"), name="project_id")
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
    metadata = Column(JSON, default={})
```

### Implementation (Python)
```python
from datetime import datetime, timezone

class ExecutionMemory:
    def __init__(self):
        self.db = SessionLocal()

    def start_task(self, project_id: str, task_name: str, agent: str, todo_id: str = None) -> ExecutionLog:
        log = ExecutionLog(
            project_id=project_id,
            todo_id=todo_id,
            task_name=task_name,
            agent=agent,
            status="in_progress",
            started_at=datetime.now(timezone.utc)
        )
        self.db.add(log)
        self.db.commit()
        self.db.refresh(log)
        return log

    def complete_task(self, log_id: str, output_files: list, token_count: int = 0):
        log = self.db.query(ExecutionLog).filter(ExecutionLog.id == log_id).first()
        if not log:
            return
        duration = int((datetime.now(timezone.utc) - log.started_at).total_seconds() * 1000)
        self.db.query(ExecutionLog).filter(ExecutionLog.id == log_id).update({
            "status": "completed",
            "output_files": output_files,
            "completed_at": datetime.now(timezone.utc),
            "duration_ms": duration,
            "token_count": token_count
        })
        self.db.commit()

    def fail_task(self, log_id: str, error_message: str):
        self.db.query(ExecutionLog).filter(ExecutionLog.id == log_id).update({
            "status": "failed",
            "error_message": error_message,
            "completed_at": datetime.now(timezone.utc)
        })
        self.db.commit()

    def is_already_done(self, project_id: str, task_name: str) -> bool:
        existing = self.db.query(ExecutionLog).filter(
            ExecutionLog.project_id == project_id,
            ExecutionLog.task_name == task_name,
            ExecutionLog.status == "completed"
        ).first()
        return existing is not None

    def get_failed_tasks(self, project_id: str) -> list:
        return self.db.query(ExecutionLog).filter(
            ExecutionLog.project_id == project_id,
            ExecutionLog.status == "failed"
        ).all()

    def get_project_summary(self, project_id: str) -> list:
        from sqlalchemy import text
        result = self.db.execute(
            text("SELECT status, COUNT(*) as count, SUM(token_count) as total_tokens FROM execution_logs WHERE project_id = :pid GROUP BY status"),
            {"pid": project_id}
        )
        return [dict(row) for row in result]
```

---

## Memory Layer 6 — ArtifactMemory

### Purpose
Registry of every file, component, API, schema, and page generated. Prevents duplicate generation.

### Storage: PostgreSQL

### Schema
```sql
CREATE TABLE artifacts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID REFERENCES projects(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  artifact_type TEXT NOT NULL,
  file_path     TEXT NOT NULL,
  version       INT DEFAULT 1,
  content_hash  TEXT,
  dependencies  TEXT[],
  exports       TEXT[],
  language      TEXT,
  size_bytes    INT,
  is_active     BOOLEAN DEFAULT true,
  created_by    TEXT,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX idx_artifacts_path ON artifacts(project_id, file_path, is_active) WHERE is_active = true;
CREATE INDEX idx_artifacts_type ON artifacts(project_id, artifact_type);
CREATE INDEX idx_artifacts_name ON artifacts(project_id, name);
```

### SQLAlchemy Model
```python
class Artifact(Base):
    __tablename__ = "artifacts"
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id = Column(String, ForeignKey("projects.id", ondelete="CASCADE"), name="project_id")
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
```

### Implementation (Python)
```python
class ArtifactMemory:
    def __init__(self):
        self.db = SessionLocal()

    def register(self, project_id: str, artifact: dict) -> Artifact:
        existing = self.db.query(Artifact).filter(
            Artifact.project_id == project_id,
            Artifact.file_path == artifact["filePath"],
            Artifact.is_active == True
        ).first()

        if existing:
            existing.version += 1
            existing.content_hash = artifact.get("contentHash")
            existing.dependencies = artifact.get("dependencies", [])
            existing.updated_at = datetime.utcnow()
            self.db.commit()
            self.db.refresh(existing)
            return existing

        new_artifact = Artifact(
            project_id=project_id,
            name=artifact["name"],
            artifact_type=artifact["type"],
            file_path=artifact["filePath"],
            content_hash=artifact.get("contentHash"),
            dependencies=artifact.get("dependencies", []),
            exports=artifact.get("exports", []),
            language=artifact.get("language"),
            size_bytes=artifact.get("sizeBytes"),
            created_by=artifact.get("createdBy")
        )
        self.db.add(new_artifact)
        self.db.commit()
        self.db.refresh(new_artifact)
        return new_artifact

    def exists(self, project_id: str, file_path: str) -> bool:
        return self.db.query(Artifact).filter(
            Artifact.project_id == project_id,
            Artifact.file_path == file_path,
            Artifact.is_active == True
        ).first() is not None

    def get_all_components(self, project_id: str) -> list:
        return self.db.query(Artifact).filter(
            Artifact.project_id == project_id,
            Artifact.artifact_type == "component",
            Artifact.is_active == True
        ).all()

    def get_by_name(self, project_id: str, name: str) -> list:
        return self.db.query(Artifact).filter(
            Artifact.project_id == project_id,
            Artifact.name == name,
            Artifact.is_active == True
        ).all()
```

---

## Memory Layer 7 — ReviewMemory

### Purpose
Stores all reviewer feedback, quality scores, and identified issues for a project. Used by Planner to avoid repeating mistakes.

### Storage: PostgreSQL

### Schema
```sql
CREATE TABLE reviews (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID REFERENCES projects(id) ON DELETE CASCADE,
  artifact_id   UUID REFERENCES artifacts(id),
  reviewed_by   TEXT,
  quality_score INT CHECK (quality_score BETWEEN 0 AND 100),
  issues        JSONB,
  passed        BOOLEAN,
  review_type   TEXT,
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_reviews_project ON reviews(project_id);
CREATE INDEX idx_reviews_artifact ON reviews(artifact_id);
```

### SQLAlchemy Model
```python
class Review(Base):
    __tablename__ = "reviews"
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id = Column(String, ForeignKey("projects.id", ondelete="CASCADE"), name="project_id")
    artifact_id = Column(String, ForeignKey("artifacts.id"), name="artifact_id")
    reviewed_by = Column(String, name="reviewed_by")
    quality_score = Column(Integer, name="quality_score")
    issues = Column(JSON)
    passed = Column(Boolean)
    review_type = Column(String, name="review_type")
    created_at = Column(DateTime, default=datetime.utcnow, name="created_at")
```

### Implementation (Python)
```python
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
```

---

## Memory Layer 8 — ErrorMemory

### Purpose
BuilderBrain's experience database. Stores known errors and their proven fixes. Over time the system becomes smarter.

### Storage: PostgreSQL

### Schema
```sql
CREATE TABLE known_errors (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  error_pattern    TEXT NOT NULL,
  error_type       TEXT,
  framework        TEXT,
  occurrence_count INT DEFAULT 1,
  fix_description  TEXT NOT NULL,
  fix_code         TEXT,
  success_rate     FLOAT DEFAULT 1.0,
  last_seen        TIMESTAMPTZ DEFAULT now(),
  first_seen       TIMESTAMPTZ DEFAULT now(),
  tags             TEXT[]
);

CREATE INDEX idx_errors_framework ON known_errors(framework, error_type);
```

### SQLAlchemy Model
```python
class KnownError(Base):
    __tablename__ = "known_errors"
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
```

### Implementation (Python)
```python
from sqlalchemy import text, func

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
                FROM known_errors
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
```

---

## Memory Layer 9 — SkillMemory

### Purpose
Tracks performance of each skill used. BuilderBrain learns which skills are best, cheapest, and most reliable.

### Storage: PostgreSQL

### Schema
```sql
CREATE TABLE skill_performance (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_name      TEXT NOT NULL UNIQUE,
  version         TEXT DEFAULT '1.0',
  total_uses      INT DEFAULT 0,
  successful_uses INT DEFAULT 0,
  failed_uses     INT DEFAULT 0,
  avg_score       FLOAT DEFAULT 0,
  avg_token_cost  INT DEFAULT 0,
  avg_duration_ms INT DEFAULT 0,
  projects_used   UUID[],
  last_used       TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now()
);
```

### SQLAlchemy Model
```python
class SkillPerformance(Base):
    __tablename__ = "skill_performance"
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
```

### Implementation (Python)
```python
class SkillMemory:
    def __init__(self):
        self.db = SessionLocal()

    def record_usage(self, skill_name: str, project_id: str, outcome: dict):
        self.db.execute(
            text("""
                INSERT INTO skill_performance (skill_name, total_uses, successful_uses, failed_uses,
                    avg_score, avg_token_cost, avg_duration_ms, projects_used, last_used)
                VALUES (
                    :name, 1,
                    :success, :failure,
                    :score, :token_cost, :duration,
                    ARRAY[:project]::uuid[], now()
                )
                ON CONFLICT (skill_name) DO UPDATE SET
                    total_uses = skill_performance.total_uses + 1,
                    successful_uses = skill_performance.successful_uses + :success,
                    failed_uses = skill_performance.failed_uses + :failure,
                    avg_score = (skill_performance.avg_score * skill_performance.total_uses + :score)
                                 / (skill_performance.total_uses + 1),
                    avg_token_cost = (skill_performance.avg_token_cost * skill_performance.total_uses + :token_cost)
                                      / (skill_performance.total_uses + 1),
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
                FROM skill_performance
                ORDER BY avg_score DESC, success_rate DESC
                LIMIT :lim
            """),
            {"lim": limit}
        )
        return [dict(row) for row in results]
```

---

## Memory Layer 10 — ArchitectureMemory

### Purpose
Stores proven architecture patterns with success rates. Planner uses this to recommend battle-tested combinations.

### Storage: PostgreSQL

### Schema
```sql
CREATE TABLE architecture_patterns (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern_name   TEXT NOT NULL,
  frontend       TEXT,
  backend        TEXT,
  database       TEXT,
  auth_method    TEXT,
  css_framework  TEXT,
  times_used     INT DEFAULT 0,
  success_count  INT DEFAULT 0,
  success_rate   FLOAT DEFAULT 0,
  avg_build_time_min INT,
  project_ids    UUID[],
  tags           TEXT[],
  last_used      TIMESTAMPTZ,
  created_at     TIMESTAMPTZ DEFAULT now()
);
```

### SQLAlchemy Model
```python
class ArchitecturePattern(Base):
    __tablename__ = "architecture_patterns"
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    pattern_name = Column(String, nullable=False, name="pattern_name")
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
```

### Implementation (Python)
```python
class ArchitectureMemory:
    def __init__(self):
        self.db = SessionLocal()

    def record_usage(self, pattern: dict, project_id: str, succeeded: bool):
        key = f"{pattern.get('frontend', '')} + {pattern.get('backend', '')} + {pattern.get('database', '')}"
        self.db.execute(
            text("""
                INSERT INTO architecture_patterns
                    (pattern_name, frontend, backend, database, auth_method,
                     times_used, success_count, success_rate, project_ids, last_used)
                VALUES (
                    :key, :fe, :be, :db, :auth,
                    1, :sc, :sr, ARRAY[:project]::uuid[], now()
                )
                ON CONFLICT (pattern_name) DO UPDATE SET
                    times_used = architecture_patterns.times_used + 1,
                    success_count = architecture_patterns.success_count + :sc,
                    success_rate = (architecture_patterns.success_count + :sc)::float
                                    / (architecture_patterns.times_used + 1),
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
```

---

## Memory Layer 11 — LongTermMemory (via Qdrant)

### Purpose
Cross-project semantic memory. Stores embeddings of conversations, requirements, code reviews, and lessons learned. Enables BuilderBrain to say "we built something similar before."

### Storage: Qdrant

### Collection Configuration
```python
from qdrant_client import QdrantClient
from qdrant_client.models import PointStruct, VectorParams, Distance, Filter, FieldCondition, MatchValue

QDRANT_URL = os.getenv("QDRANT_URL", "http://qdrant:6333")
EMBEDDING_MODEL = "text-embedding-3-small"
EMBEDDING_DIM = 1536
```

### Implementation (Python)
```python
import openai
from qdrant_client import QdrantClient
from qdrant_client.models import PointStruct, VectorParams, Distance, Filter, FieldCondition, MatchValue

class LongTermMemory:
    def __init__(self):
        self.client = QdrantClient(url=QDRANT_URL)
        self.collection_name = "long_term_memory"
        self._ensure_collection()

    def _ensure_collection(self):
        collections = self.client.get_collections().collections
        if not any(c.name == self.collection_name for c in collections):
            self.client.create_collection(
                collection_name=self.collection_name,
                vectors_config=VectorParams(size=EMBEDDING_DIM, distance=Distance.COSINE)
            )

    def _embed(self, text: str) -> list:
        response = openai.embeddings.create(
            model=EMBEDDING_MODEL,
            input=text
        )
        return response.data[0].embedding

    def store(self, project_id: str, memory_type: str, content: str, metadata: dict = None):
        embedding = self._embed(content)
        point = PointStruct(
            id=str(uuid.uuid4()),
            vector=embedding,
            payload={
                "project_id": project_id,
                "memory_type": memory_type,
                "content": content,
                "metadata": metadata or {},
                "created_at": datetime.utcnow().isoformat()
            }
        )
        self.client.upsert(collection_name=self.collection_name, points=[point])

    def semantic_search(self, query: str, limit: int = 5, memory_type: str = None) -> list:
        query_vector = self._embed(query)
        filter_condition = None
        if memory_type:
            filter_condition = Filter(
                must=[FieldCondition(key="memory_type", match=MatchValue(value=memory_type))]
            )
        results = self.client.search(
            collection_name=self.collection_name,
            query_vector=query_vector,
            limit=limit,
            query_filter=filter_condition
        )
        return [
            {
                "id": str(r.id),
                "project_id": r.payload.get("project_id"),
                "memory_type": r.payload.get("memory_type"),
                "content": r.payload.get("content"),
                "metadata": r.payload.get("metadata"),
                "similarity": r.score
            }
            for r in results
        ]

    def find_similar_projects(self, project_description: str) -> list:
        results = self.semantic_search(project_description, limit=3, memory_type="requirement")
        return [r for r in results if r["similarity"] > 0.75]
```

---

## Memory Layer 12 — AgentWorkingMemory

### Purpose
Per-agent scratchpad for the current task. Each agent works in isolation without polluting others.

### Storage: Redis

### Implementation (Python)
```python
class AgentWorkingMemory:
    def __init__(self, agent_name: str, session_id: str):
        self.key = f"agent_wm:{agent_name}:{session_id}"
        self.ttl = 6 * 60 * 60  # 6 hours

    async def set(self, key: str, value):
        await redis_client.hset(self.key, key, json.dumps(value))
        await redis_client.expire(self.key, self.ttl)

    async def get(self, key: str):
        val = await redis_client.hget(self.key, key)
        return json.loads(val) if val else None

    async def get_all(self) -> dict:
        all_fields = await redis_client.hgetall(self.key)
        if not all_fields:
            return {}
        return {k: json.loads(v) for k, v in all_fields.items()}

    async def clear(self):
        await redis_client.delete(self.key)

# Usage per agent:
planner_memory = AgentWorkingMemory("PlannerAgent", session_id)
frontend_memory = AgentWorkingMemory("FrontendAgent", session_id)
# Each is fully isolated
```

---

## Bonus — ChangeMemory

### Purpose
Tracks every change request and which files it affected. User can return months later and BuilderBrain knows full context.

### Storage: PostgreSQL

### Schema
```sql
CREATE TABLE change_requests (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       UUID REFERENCES projects(id) ON DELETE CASCADE,
  request_text     TEXT NOT NULL,
  affected_files   TEXT[],
  affected_components TEXT[],
  status           TEXT DEFAULT 'pending',
  created_at       TIMESTAMPTZ DEFAULT now(),
  completed_at     TIMESTAMPTZ
);
```

### SQLAlchemy Model
```python
class ChangeRequest(Base):
    __tablename__ = "change_requests"
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id = Column(String, ForeignKey("projects.id", ondelete="CASCADE"), name="project_id")
    request_text = Column(Text, nullable=False, name="request_text")
    affected_files = Column(ARRAY(String), name="affected_files")
    affected_components = Column(ARRAY(String), name="affected_components")
    status = Column(String, default="pending")
    created_at = Column(DateTime, default=datetime.utcnow, name="created_at")
    completed_at = Column(DateTime, name="completed_at")
```

---

## Qdrant-Based Impact Analysis (Alternative to Neo4j GraphRAG)

### Purpose
Instead of running a full Neo4j knowledge graph, Qdrant's payload filtering + semantic search can answer "what does this component depend on?" and "what depends on this component?" — without the operational overhead of a graph database.

### How It Works
1. Each artifact is stored in Qdrant with its dependencies and exports as payload fields
2. Semantic search finds related artifacts by name/description
3. Payload filtering narrows by artifact type, project, or dependency

### Implementation (Python)
```python
class QdrantImpactAnalysis:
    def __init__(self):
        self.client = QdrantClient(url=QDRANT_URL)
        self.collection_name = "artifacts"
        self._ensure_collection()

    def _ensure_collection(self):
        collections = self.client.get_collections().collections
        if not any(c.name == self.collection_name for c in collections):
            self.client.create_collection(
                collection_name=self.collection_name,
                vectors_config=VectorParams(size=EMBEDDING_DIM, distance=Distance.COSINE)
            )

    def index_artifact(self, project_id: str, artifact: Artifact):
        text = f"{artifact.name} {artifact.file_path} {' '.join(artifact.dependencies or [])}"
        embedding = openai.embeddings.create(model=EMBEDDING_MODEL, input=text).data[0].embedding
        self.client.upsert(
            collection_name=self.collection_name,
            points=[PointStruct(
                id=str(artifact.id),
                vector=embedding,
                payload={
                    "project_id": project_id,
                    "name": artifact.name,
                    "file_path": artifact.file_path,
                    "artifact_type": artifact.artifact_type,
                    "dependencies": artifact.dependencies or [],
                    "exports": artifact.exports or [],
                    "language": artifact.language,
                }
            )]
        )

    def find_dependents(self, component_name: str, project_id: str = None) -> list:
        filter_conditions = [FieldCondition(key="dependencies", match=MatchValue(value=component_name))]
        if project_id:
            filter_conditions.append(
                FieldCondition(key="project_id", match=MatchValue(value=project_id))
            )
        results = self.client.scroll(
            collection_name=self.collection_name,
            limit=50,
            query_filter=Filter(must=filter_conditions)
        )
        return [r.payload for r in results[0]]

    def find_dependencies(self, component_name: str, project_id: str = None) -> list:
        filter_conditions = [FieldCondition(key="name", match=MatchValue(value=component_name))]
        if project_id:
            filter_conditions.append(
                FieldCondition(key="project_id", match=MatchValue(value=project_id))
            )
        results = self.client.scroll(
            collection_name=self.collection_name,
            limit=10,
            query_filter=Filter(must=filter_conditions)
        )
        for r in results[0]:
            return r.payload.get("dependencies", [])
        return []

    def impact_analysis(self, change_request: str, project_id: str) -> dict:
        """Simulates GraphRAG-style impact analysis using Qdrant + semantic search."""
        query_embedding = openai.embeddings.create(
            model=EMBEDDING_MODEL, input=change_request
        ).data[0].embedding

        search_results = self.client.search(
            collection_name=self.collection_name,
            query_vector=query_embedding,
            limit=10,
            query_filter=Filter(must=[
                FieldCondition(key="project_id", match=MatchValue(value=project_id))
            ])
        )
        return {
            "affected_artifacts": [
                {
                    "name": r.payload.get("name"),
                    "file_path": r.payload.get("file_path"),
                    "type": r.payload.get("artifact_type"),
                    "similarity": r.score
                }
                for r in search_results
            ]
        }
```

### Neo4j (Future Enhancement)
If your project grows to need complex multi-hop graph queries, you can add Neo4j later without changing existing code — the `MemoryGateway` abstraction means you simply swap the implementation behind the same interface.

---

## Memory Gateway API

This is the single entry point. No agent talks to memory stores directly — all go through the gateway.

```python
class MemoryGateway:
    def __init__(self, project_id: str, session_id: str):
        self.project_id = project_id
        self.session_id = session_id

        # Initialize all memory layers
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
        self.long_term = LongTermMemory()
        self.impact = QdrantImpactAnalysis()

    async def build_agent_context(self, agent_name: str) -> dict:
        """Called before any agent starts working."""
        recent = await self.short_term.get_recent(10)
        active_decisions = self.decisions.get_active_decisions(self.project_id)
        project_info = self.project.get_by_id(self.project_id)
        recent_errors = self.errors.find_fix("recent", project_info.frontend if project_info else None)
        exec_summary = self.execution.get_project_summary(self.project_id)

        return {
            "conversation": recent,
            "decisions": active_decisions,  # ALWAYS respected
            "project": project_info,
            "known_errors": recent_errors,
            "execution_status": exec_summary
        }

    async def analyze_change_impact(self, change_request: str) -> dict:
        """Called when user says 'add dark mode' or makes a change request."""
        similar = self.long_term.semantic_search(change_request, limit=3)
        impact = self.impact.impact_analysis(change_request, self.project_id)
        components = self.artifacts.get_all_components(self.project_id)

        return {
            "similar_past_context": similar,
            "impacted_components": impact,
            "all_components": components
        }
```

---

## Build Order (Phased Rollout)

### Phase 1 — Build NOW (Core reliability)
```
ShortTermMemory    -> Redis
SessionMemory      -> Redis
ProjectMemory      -> PostgreSQL
DecisionMemory     -> PostgreSQL  <- most critical
ExecutionMemory    -> PostgreSQL
```

### Phase 2 — Add within 2 weeks
```
ArtifactMemory     -> PostgreSQL
ReviewMemory       -> PostgreSQL
ErrorMemory        -> PostgreSQL
AgentWorkingMemory -> Redis
```

### Phase 3 — Add in month 2
```
SkillMemory        -> PostgreSQL
ArchitectureMemory -> PostgreSQL
LongTermMemory     -> Qdrant (already available in Docker)
ChangeMemory       -> PostgreSQL
QdrantImpactAnalysis -> Qdrant
```

### Phase 4 — V2 (GraphRAG, optional)
```
Neo4j Knowledge Graph   (add if multi-hop queries needed)
LangChain GraphRAG      (natural language over graph)
```

---

## Environment Variables Required

```env
# PostgreSQL
DATABASE_URL=postgresql://app:app@postgres:5432/app?sslmode=disable

# Redis
REDIS_URL=redis://redis:6379

# Qdrant (already in docker-compose)
QDRANT_URL=http://qdrant:6333

# Embeddings
OPENAI_API_KEY=sk-...
```

### Add to `requirements.txt`
```
qdrant-client
openai
redis
sqlalchemy
psycopg2-binary
```

---

## Migration from Existing `memory_engine.py`

The current `Brain/memory/memory_engine.py` has basic conversation + architecture + task memory using SQLAlchemy. The new system replaces it as follows:

| Old Method | New Module | Storage |
|---|---|---|
| `get_conversation_memory` | `ShortTermMemory.get_recent` | Redis |
| `get_architecture_memory` | `DecisionMemory.get_active_decisions` | PostgreSQL |
| `get_task_memory` | `ExecutionMemory` | PostgreSQL |
| `save_execution_memory` | `ExecutionMemory.start_task` / `complete_task` | PostgreSQL |

**Migration step**: Replace `from Brain.memory.memory_engine import memory_engine` with `MemoryGateway(project_id, session_id)` throughout the codebase.

---

*BuilderBrain Memory Architecture v2.0 — Python + Qdrant + PostgreSQL + Redis*
