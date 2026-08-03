# Grizon AI Brain — Queue System Architecture Plan

**Version:** 1.0
**Date:** 2026-07-22
**Status:** Design — Pre-Implementation

---

## Table of Contents

1. [Problem Statement](#1-problem-statement)
2. [Current Architecture Analysis](#2-current-architecture-analysis)
3. [Proposed Architecture](#3-proposed-architecture)
4. [Queue Taxonomy](#4-queue-taxonomy)
5. [Core Components](#5-core-components)
6. [Job Lifecycle](#6-job-lifecycle)
7. [Data Models](#7-data-models)
8. [Worker Architecture](#8-worker-architecture)
9. [Real-Time Communication](#9-real-time-communication)
10. [Scalability Strategy](#10-scalability-strategy)
11. [Reliability & Fault Tolerance](#11-reliability--fault-tolerance)
12. [Monitoring & Observability](#12-monitoring--observability)
13. [API Contract Changes](#13-api-contract-changes)
14. [Migration Strategy](#14-migration-strategy)
15. [Infrastructure Requirements](#15-infrastructure-requirements)
16. [Cost Estimation](#16-cost-estimation)
17. [Implementation Phases](#17-implementation-phases)
18. [Risks & Mitigations](#18-risks--mitigations)

---

## 1. Problem Statement

### Current Limitation

The Brain backend processes every chat request **synchronously in-process**. A single `POST /brain/chat/stream` request ties up a FastAPI worker for the full duration of the LangGraph workflow (Manager → Questions → Planner → Todo → Builder → Runner), which can take **30 seconds to 5+ minutes** for complex projects.

This means:
- **100 concurrent users = 100 blocked workers** — FastAPI's default `uvicorn` worker pool (typically 1–4 workers) is exhausted almost immediately.
- **No horizontal scaling** — spinning up more FastAPI instances doesn't help because each request still blocks a worker.
- **No job persistence** — if the server restarts, all in-flight builds are lost.
- **No retry** — a transient LLM API failure kills the entire request.
- **No prioritization** — a simple chat message and a 50-task build compete for the same worker.

### Target

Handle **1,000–10,000 concurrent active requests** and **100,000+ queued jobs** with:
- Sub-second job enqueue latency
- Horizontal worker scaling
- Automatic retries with exponential backoff
- Real-time progress streaming to clients
- Graceful degradation under load

---

## 2. Current Architecture Analysis

### Request Flow (As-Is)

```mermaid
sequenceDiagram
    participant FE as Frontend (Next.js)
    participant API as FastAPI Worker
    participant LG as LangGraph Workflow
    participant BA as BuilderAgent
    participant RA as RunnerAgent

    FE->>API: POST /brain/chat/stream (SSE)
    Note over API: Worker BLOCKED for entire duration

    rect rgb(230, 240, 255)
        Note over LG: Phase 1: LangGraph (sync)
        LG->>LG: node_manager (ManagerAgent)
        LG->>LG: node_clarifier (QuestionsAgent)
        LG->>LG: node_planner (PlannerAgent)
        LG->>LG: node_todo (TodoAgent)
        LG->>LG: node_init_sandbox
    end

    rect rgb(255, 245, 230)
        Note over BA: Phase 2: Builder Loop (async)
        loop For each task in plan
            BA->>BA: BuilderAgent.execute()
        end
    end

    rect rgb(230, 255, 230)
        Note over RA: Phase 3: Runner (async)
        RA->>RA: RunnerAgent.execute()
    end

    API-->>FE: SSE events as generator
```

### Key Bottlenecks

| Component | Issue | Impact |
|-----------|-------|--------|
| FastAPI Worker | Blocks for full request duration | Max ~4 concurrent requests |
| `asyncio.create_task()` | Background tasks lost on process crash | No job persistence |
| `STOP_REGISTRY` (in-memory `set`) | Per-process, not shared | Stop signal only works on same instance |
| `ws_manager` (in-memory dict) | Per-process connections | WebSocket broadcasts only reach local clients |
| `SessionLocal()` (SQLAlchemy sync) | Blocking DB calls in async context | Thread pool exhaustion under load |

---

## 3. Proposed Architecture

### High-Level Design

```mermaid
graph TB
    Client["Frontend Next.js"]

    subgraph EC2["EC2 Docker Compose"]
        API1["Brain FastAPI :8001"]
        APIN["Node Backend :4000"]

        subgraph REDIS["Redis :6379"]
            Q1["brain:q:high"]
            Q2["brain:q:normal"]
            Q3["brain:q:low"]
            S1["job:state / job:meta"]
            PS["Pub/Sub channel"]
        end

        subgraph WORKERS["Queue Workers"]
            W1["Planner Worker"]
            W2["Builder Worker"]
            W3["Runner Worker"]
        end

        PG[("PostgreSQL :5432")]
    end

    Client --> API1
    Client --> APIN
    API1 --> Q1
    API1 --> Q2
    API1 --> S1
    Q1 --> W1
    Q2 --> W2
    Q3 --> W3
    W1 --> PG
    W2 --> PG
    W3 --> PG
    W1 --> PS
    W2 --> PS
    W3 --> PS
```

### Design Principles

1. **Enqueue Fast, Process Later** — API endpoints return immediately with a `job_id`. Processing happens in worker pools.
2. **Separate Queues by Phase** — LangGraph planning, code building, and deployment run on different worker pools with independent scaling.
3. **Redis as Single Source of Queuing Truth** — Redis Streams provide durable, ordered, consumer-group-aware job distribution.
4. **Stateless Workers** — Any worker can process any job. No in-memory state for job tracking.
5. **Graceful Degradation** — If Redis is down, fall back to in-process execution (current behavior) with a warning.

---

## 4. Queue Taxonomy

### Priority Queues

| Queue Name | Priority | Worker Pool | Timeout | Description |
|------------|----------|-------------|---------|-------------|
| `brain:q:critical` | 0 (highest) | Phase 1 | 30s | Stop signals, health pings |
| `brain:q:high` | 1 | Phase 1 | 5min | Chat intent analysis, planning |
| `brain:q:normal` | 2 | Phase 2 | 30min | Code building (per-task) |
| `brain:q:low` | 3 | Phase 3 | 15min | Deployment, sandbox setup |
| `brain:q:background` | 4 | Background | 60min | Title generation, memory writes, cleanup |

### Queue Selection Logic

```python
def select_queue(job_type: str, priority: str = "normal") -> str:
    mapping = {
        "stop":           "brain:q:critical",
        "chat_analyze":   "brain:q:high",
        "chat_plan":      "brain:q:high",
        "chat_clarify":   "brain:q:high",
        "chat_todo":      "brain:q:high",
        "build_task":     "brain:q:normal",
        "sandbox_init":   "brain:q:low",
        "deploy":         "brain:q:low",
        "title_gen":      "brain:q:background",
        "memory_write":   "brain:q:background",
        "cleanup":        "brain:q:background",
    }
    return mapping.get(job_type, "brain:q:normal")
```

---

## 5. Core Components

### 5.1 Job Enqueue Service (`Brain/queues/enqueue.py`)

Responsible for creating job records and pushing them to the appropriate Redis queue.

```python
# Brain/queues/enqueue.py — Conceptual Design

import uuid
import json
import time
from typing import Any, Dict, Optional
from Brain.config.redis import redis_client

class JobEnqueueService:
    """Enqueues jobs into Redis Streams with metadata."""

    HIGH_PRIORITY_QUEUES = ["brain:q:critical", "brain:q:high"]
    ALL_QUEUES = [
        "brain:q:critical",
        "brain:q:high",
        "brain:q:normal",
        "brain:q:low",
        "brain:q:background",
    ]

    async def enqueue(
        self,
        job_type: str,
        payload: Dict[str, Any],
        conversation_id: str,
        user_id: str,
        priority: str = "normal",
        delay_seconds: int = 0,
    ) -> str:
        """Enqueue a job and return its ID."""
        job_id = str(uuid.uuid4())
        queue_name = self._select_queue(job_type, priority)

        job_record = {
            "job_id": job_id,
            "job_type": job_type,
            "conversation_id": conversation_id,
            "user_id": user_id,
            "payload": json.dumps(payload),
            "status": "queued",
            "created_at": str(time.time()),
            "attempts": "0",
            "max_attempts": "3",
            "queue": queue_name,
            "delay_until": str(time.time() + delay_seconds) if delay_seconds else "0",
        }

        # Store job metadata in Redis hash
        await redis_client.hset(f"job:{job_id}:meta", "_", json.dumps(job_record))

        # Push to Redis Stream
        if delay_seconds > 0:
            # Delayed job: store in a sorted set, picked up by scheduler
            await redis_client.zadd(
                "brain:delayed_jobs",
                {job_id: time.time() + delay_seconds}
            )
        else:
            await redis_client.xadd(queue_name, {"payload": json.dumps(job_record)})

        return job_id

    def _select_queue(self, job_type: str, priority: str) -> str:
        # ... queue selection logic from Section 4
        pass

    async def cancel_job(self, job_id: str) -> bool:
        """Mark a job as cancelled."""
        meta = await redis_client.hget(f"job:{job_id}:meta", "_")
        if not meta:
            return False
        job = json.loads(meta)
        job["status"] = "cancelled"
        await redis_client.hset(f"job:{job_id}:meta", "_", json.dumps(job))
        return True

    async def get_job_status(self, job_id: str) -> Optional[Dict]:
        """Get current job status."""
        meta = await redis_client.hget(f"job:{job_id}:meta", "_")
        if not meta:
            return None
        return json.loads(meta)
```

### 5.2 Job State Store (`Brain/queues/state.py`)

Real-time job state accessible by API gateway, workers, and SSE proxy.

```python
# Brain/queues/state.py — Conceptual Design

import json
from typing import Any, Dict, Optional
from Brain.config.redis import redis_client

class JobStateStore:
    """Read/write job execution state in Redis."""

    async def set_state(self, job_id: str, state: Dict[str, Any]):
        await redis_client.set(f"job:{job_id}:state", json.dumps(state))

    async def get_state(self, job_id: str) -> Optional[Dict]:
        raw = await redis_client.get(f"job:{job_id}:state")
        return json.loads(raw) if raw else None

    async def update_field(self, job_id: str, field: str, value: Any):
        state = await self.get_state(job_id) or {}
        state[field] = value
        await self.set_state(job_id, state)

    async def append_event(self, job_id: str, event: Dict[str, Any]):
        """Append an event to the job's event log (capped at 500 events)."""
        key = f"job:{job_id}:events"
        await redis_client.lpush(key, json.dumps(event))
        # Trim to last 500 events
        # Redis LTRIM would be used here

    async def set_progress(self, job_id: str, current: int, total: int, label: str = ""):
        state = await self.get_state(job_id) or {}
        state["progress"] = {
            "current": current,
            "total": total,
            "percent": round(current / max(total, 1) * 100),
            "label": label,
        }
        await self.set_state(job_id, state)

    async def mark_complete(self, job_id: str, result: Any = None):
        state = await self.get_state(job_id) or {}
        state["status"] = "completed"
        state["result"] = result
        state["completed_at"] = str(time.time())
        await self.set_state(job_id, state)

    async def mark_failed(self, job_id: str, error: str, retryable: bool = True):
        state = await self.get_state(job_id) or {}
        state["status"] = "failed"
        state["error"] = error
        state["retryable"] = retryable
        await self.set_state(job_id, state)
```

### 5.3 Delayed Job Scheduler (`Brain/queues/scheduler.py`)

Polls `brain:delayed_jobs` sorted set and moves due jobs to their target queues.

```python
# Brain/queues/scheduler.py — Conceptual Design

import asyncio
import json
import time
from Brain.config.redis import redis_client
from Brain.queues.enqueue import JobEnqueueService

class DelayedJobScheduler:
    """Polls delayed jobs and moves them to their target queue when due."""

    def __init__(self, poll_interval: float = 1.0):
        self.poll_interval = poll_interval
        self._running = False
        self.enqueuer = JobEnqueueService()

    async def start(self):
        self._running = True
        while self._running:
            try:
                now = time.time()
                # Get jobs whose delay has elapsed
                due_jobs = await redis_client.zrangebyscore(
                    "brain:delayed_jobs", 0, now, withscores=True, limit=0, count=100
                )
                for job_id, score in due_jobs:
                    # Move from delayed set to actual queue
                    meta_raw = await redis_client.hget(f"job:{job_id}:meta", "_")
                    if meta_raw:
                        job = json.loads(meta_raw)
                        queue_name = job.get("queue", "brain:q:normal")
                        await redis_client.xadd(queue_name, {"payload": meta_raw})
                        await redis_client.zrem("brain:delayed_jobs", job_id)
            except Exception as e:
                print(f"[SCHEDULER] Error: {e}")
            await asyncio.sleep(self.poll_interval)
```

---

## 6. Job Lifecycle

### State Machine

```mermaid
stateDiagram-v2
    [*] --> CREATED: Job record written to DB
    CREATED --> QUEUED: Pushed to Redis Stream
    QUEUED --> CLAIMED: Worker ACK'd message
    CLAIMED --> RUNNING: Worker processing

    RUNNING --> COMPLETED: Success
    RUNNING --> FAILED: Error

    FAILED --> RETRYING: attempts < max
    FAILED --> DEAD: attempts >= max
    RETRYING --> QUEUED: Re-enqueued with delay

    CLAIMED --> CANCELLED: User stop signal
    RUNNING --> CANCELLED: User stop signal

    COMPLETED --> [*]
    DEAD --> [*]
    CANCELLED --> [*]
```

### Job Types & Their Lifecycle

#### Type 1: Full Chat Pipeline (Phase 1 → 2 → 3)

A single user message triggers a chain of jobs:

```mermaid
flowchart TD
    A["User sends message"] --> B["Job: chat_analyze<br/>(priority=high)"]
    B --> C{"Intent?"}
    C -->|Need clarification| D["Job: chat_clarify<br/>(priority=high)"]
    C -->|Ready to plan| E["Job: chat_plan<br/>(priority=high)"]
    D -->|"User answers"| A
    E --> F["Job: chat_todo<br/>(priority=high)"]
    F --> G["Job: sandbox_init<br/>(priority=low)"]
    G --> H["Job: build_task × N<br/>(priority=normal)"]
    H --> I{"All tasks done?"}
    I -->|No| H
    I -->|Yes| J["Job: deploy<br/>(priority=low)"]
    J --> K["Notify client via SSE"]

    style A fill:#e1f5fe
    style B fill:#fff3e0
    style D fill:#fff3e0
    style E fill:#fff3e0
    style F fill:#fff3e0
    style G fill:#e8f5e9
    style H fill:#fce4ec
    style J fill:#e8f5e9
    style K fill:#f3e5f5
```

#### Type 2: Resume Build

```mermaid
flowchart LR
    A["User resumes build"] --> B["Job: resume_build<br/>(priority=high)"]
    B --> C["Enqueue remaining<br/>build_task jobs<br/>from saved plan"]

    style A fill:#e1f5fe
    style B fill:#fff3e0
    style C fill:#fce4ec
```

#### Type 3: Stop Signal

```mermaid
flowchart LR
    A["User clicks Stop"] --> B["Job: stop<br/>(priority=critical)"]
    B --> C["Worker sets STOP<br/>flag in Redis"]
    C --> D["Current workers<br/>check flag → abort"]

    style A fill:#e1f5fe
    style B fill:#ffebee
    style D fill:#fce4ec
```

---

## 7. Data Models

### 7.1 PostgreSQL: `brain_jobs` Table

```sql
CREATE TABLE brain_jobs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES conversations(id),
    user_id         UUID NOT NULL REFERENCES users(id),
    job_type        VARCHAR(50) NOT NULL,
    status          VARCHAR(20) NOT NULL DEFAULT 'queued',
    priority        INTEGER NOT NULL DEFAULT 2,
    queue_name      VARCHAR(100) NOT NULL,
    payload         JSONB NOT NULL,
    result          JSONB,
    error_message   TEXT,
    attempts        INTEGER NOT NULL DEFAULT 0,
    max_attempts    INTEGER NOT NULL DEFAULT 3,
    worker_id       VARCHAR(100),
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_brain_jobs_conv ON brain_jobs(conversation_id);
CREATE INDEX idx_brain_jobs_status ON brain_jobs(status);
CREATE INDEX idx_brain_jobs_user ON brain_jobs(user_id);
CREATE INDEX idx_brain_jobs_created ON brain_jobs(created_at);
```

### 7.2 PostgreSQL: `brain_job_events` Table (Audit Log)

```sql
CREATE TABLE brain_job_events (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id      UUID NOT NULL REFERENCES brain_jobs(id),
    event_type  VARCHAR(50) NOT NULL,
    data        JSONB,
    worker_id   VARCHAR(100),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_brain_job_events_job ON brain_job_events(job_id);
```

### 7.3 Redis Key Schema

| Key Pattern | Type | TTL | Purpose |
|-------------|------|-----|---------|
| `brain:q:{priority}` | Stream | None | Job queue |
| `job:{job_id}:meta` | Hash | 24h | Job metadata |
| `job:{job_id}:state` | String (JSON) | 24h | Real-time execution state |
| `job:{job_id}:events` | List | 24h | Event log (capped 500) |
| `conv:{conv_id}:active_job` | String | 24h | Currently active job for a conversation |
| `conv:{conv_id}:sse_channel` | Pub/Sub | — | Real-time SSE events for a conversation |
| `stop:{conv_id}` | String | 1h | Stop signal flag |
| `rate:{user_id}:{window}` | String (counter) | 1h | Rate limiting |
| `brain:delayed_jobs` | Sorted Set | — | Jobs with delayed execution |
| `brain:worker:{worker_id}:heartbeat` | String | 30s | Worker liveness |
| `brain:stats:queued` | String (counter) | — | Global queue depth |
| `brain:stats:processing` | String (counter) | — | Currently processing count |

---

## 8. Worker Architecture

### 8.1 Worker Types

| Worker Type | Concurrency | Queue | Processing |
|-------------|-------------|-------|------------|
| **PlannerWorker** | 2–8 | `brain:q:high` | LangGraph workflow (analyze → plan → todo) |
| **BuilderWorker** | 4–16 | `brain:q:normal` | Code generation per task |
| **RunnerWorker** | 2–4 | `brain:q:low` | Sandbox deployment |
| **BackgroundWorker** | 2–4 | `brain:q:background` | Title gen, memory writes, cleanup |
| **SchedulerWorker** | 1 | — | Delayed job polling |

### 8.2 Worker Implementation (`Brain/queues/workers/base.py`)

```mermaid
flowchart TD
    A["Worker Start"] --> B["Ensure Consumer Groups"]
    B --> C{"Active tasks < Concurrency?"}
    C -->|No| D["Sleep 100ms"]
    D --> C
    C -->|Yes| E["XREADGROUP from queue"]
    E --> F{"Message received?"}
    F -->|No| G["Sleep poll_timeout"]
    G --> C
    F -->|Yes| H["asyncio.create_task"]
    H --> C

    subgraph "Task Processing"
        I["Parse payload"] --> J{"Stop signal set?"}
        J -->|Yes| K["ACK & skip"]
        J -->|No| L{"Delay elapsed?"}
        L -->|No| M["NACK (redeliver later)"]
        L -->|Yes| N["Call self.process()"]
        N --> O{"Success?"}
        O -->|Yes| P["Update state: completed"]
        O -->|No| Q{"Attempts < Max?"}
        Q -->|Yes| R["Re-enqueue with backoff"]
        Q -->|No| S["Dead letter queue"]
        P --> T["ACK message"]
        R --> T
        S --> T
        K --> T
        M --> T
    end

    style A fill:#e1f5fe
    style I fill:#fff3e0
    style N fill:#e8f5e9
    style S fill:#ffebee
```

```python
# Brain/queues/workers/base.py — Conceptual Design

import asyncio
import json
import time
import uuid
from typing import Callable, Dict, Any
from Brain.config.redis import redis_client

class BaseWorker:
    """Base class for Redis Stream consumers."""

    def __init__(
        self,
        worker_type: str,
        queue_names: list[str],
        consumer_group: str,
        concurrency: int = 4,
        poll_timeout_ms: int = 5000,
    ):
        self.worker_type = worker_type
        self.worker_id = f"{worker_type}-{uuid.uuid4().hex[:8]}"
        self.queue_names = queue_names
        self.consumer_group = consumer_group
        self.concurrency = concurrency
        self.poll_timeout_ms = poll_timeout_ms
        self._running = False
        self._active_tasks: set = set()

    async def start(self):
        """Main worker loop."""
        self._running = True
        await self._ensure_consumer_groups()

        while self._running:
            if len(self._active_tasks) >= self.concurrency:
                await asyncio.sleep(0.1)
                continue

            for queue_name in self.queue_names:
                if len(self._active_tasks) >= self.concurrency:
                    break

                try:
                    messages = await redis_client.xreadgroup(
                        self.consumer_group,
                        self.worker_id,
                        {queue_name: ">"},
                        count=1,
                        block=self.poll_timeout_ms,
                    )
                    if messages:
                        for stream, entries in messages:
                            for msg_id, fields in entries:
                                task = asyncio.create_task(
                                    self._process_message(queue_name, msg_id, fields)
                                )
                                self._active_tasks.add(task)
                                task.add_done_callback(self._active_tasks.discard)
                except Exception as e:
                    print(f"[{self.worker_id}] Read error: {e}")
                    await asyncio.sleep(1)

    async def _process_message(self, queue_name: str, msg_id: str, fields: dict):
        """Process a single message with error handling and retries."""
        try:
            payload = json.loads(fields.get("payload", "{}"))
            job_id = payload.get("job_id")

            # Check for stop signal
            if await redis_client.get(f"stop:{payload.get('conversation_id')}"):
                await self._ack(queue_name, msg_id)
                return

            # Check delay
            delay_until = float(payload.get("delay_until", 0))
            if delay_until > time.time():
                # Re-queue with delay
                await self._nack(queue_name, msg_id)
                return

            # Process
            result = await self.process(payload)

            # Update state
            await redis_client.set(
                f"job:{job_id}:state",
                json.dumps({"status": "completed", "result": result})
            )

            # ACK
            await self._ack(queue_name, msg_id)

        except Exception as e:
            print(f"[{self.worker_id}] Processing error: {e}")
            await self._handle_failure(queue_name, msg_id, fields, str(e))

    async def _handle_failure(self, queue_name, msg_id, fields, error):
        """Handle failed message: retry or dead-letter."""
        payload = json.loads(fields.get("payload", "{}"))
        attempts = int(payload.get("attempts", 0))
        max_attempts = int(payload.get("max_attempts", 3))

        if attempts < max_attempts:
            # Re-enqueue with backoff
            payload["attempts"] = str(attempts + 1)
            delay = min(2 ** attempts * 5, 300)  # 5s, 10s, 20s, ... max 5min
            payload["delay_until"] = str(time.time() + delay)
            await redis_client.zadd("brain:delayed_jobs", {payload["job_id"]: time.time() + delay})
            await self._ack(queue_name, msg_id)
        else:
            # Dead letter
            await redis_client.xadd("brain:q:dead_letter", {"payload": json.dumps(payload)})
            await self._ack(queue_name, msg_id)

    async def _ack(self, queue_name: str, msg_id: str):
        await redis_client.xack(queue_name, self.consumer_group, msg_id)

    async def _nack(self, queue_name: str, msg_id: str):
        # Redis Streams: just don't ACK — it'll be redelivered
        pass

    async def _ensure_consumer_groups(self):
        """Create consumer groups if they don't exist."""
        for queue_name in self.queue_names:
            try:
                await redis_client.xgroup_create(
                    queue_name, self.consumer_group, id="0", mkstream=True
                )
            except Exception:
                pass  # Group already exists

    async def process(self, payload: Dict[str, Any]) -> Any:
        """Override in subclass. Process a single job."""
        raise NotImplementedError

    async def stop(self):
        self._running = False
        for task in self._active_tasks:
            task.cancel()
```

### 8.3 Concrete Workers

```python
# Brain/queues/workers/planner_worker.py — Conceptual Design

from Brain.queues.workers.base import BaseWorker
from Brain.agents.manager.manager_agent import ManagerAgent
from Brain.agents.planner.planner_agent import PlannerAgent
from Brain.agents.todo.todo_agent import TodoAgent

class PlannerWorker(BaseWorker):
    def __init__(self):
        super().__init__(
            worker_type="planner",
            queue_names=["brain:q:high"],
            consumer_group="planner-group",
            concurrency=4,
        )

    async def process(self, payload):
        job_type = payload["job_type"]
        conv_id = payload["conversation_id"]

        if job_type == "chat_analyze":
            agent = ManagerAgent()
            return await agent.execute(payload["payload"])

        elif job_type == "chat_plan":
            agent = PlannerAgent()
            return await agent.execute(payload["payload"])

        elif job_type == "chat_todo":
            agent = TodoAgent()
            return await agent.execute(payload["payload"])


# Brain/queues/workers/builder_worker.py — Conceptual Design

from Brain.queues.workers.base import BaseWorker
from Brain.agents.builder.builder_agent import BuilderAgent

class BuilderWorker(BaseWorker):
    def __init__(self):
        super().__init__(
            worker_type="builder",
            queue_names=["brain:q:normal"],
            consumer_group="builder-group",
            concurrency=8,
        )

    async def process(self, payload):
        agent = BuilderAgent()
        state = payload["payload"]
        results = []
        async for event in agent.execute(state):
            if isinstance(event, dict):
                results.append(event)
        return results


# Brain/queues/workers/runner_worker.py — Conceptual Design

from Brain.queues.workers.base import BaseWorker
from Brain.agents.runner.runner_agent import RunnerAgent

class RunnerWorker(BaseWorker):
    def __init__(self):
        super().__init__(
            worker_type="runner",
            queue_names=["brain:q:low"],
            consumer_group="runner-group",
            concurrency=4,
        )

    async def process(self, payload):
        agent = RunnerAgent()
        state = payload["payload"]
        result = {}
        async for event in agent.execute(state):
            if isinstance(event, dict):
                result = event
        return result
```

### 8.4 Worker Process Entry Point (`Brain/queues/worker_main.py`)

```python
# Brain/queues/worker_main.py — Conceptual Design

import asyncio
import signal
import sys
import os
from dotenv import load_dotenv

load_dotenv()

from Brain.queues.workers.planner_worker import PlannerWorker
from Brain.queues.workers.builder_worker import BuilderWorker
from Brain.queues.workers.runner_worker import RunnerWorker
from Brain.queues.scheduler import DelayedJobScheduler

WORKER_TYPES = {
    "planner": PlannerWorker,
    "builder": BuilderWorker,
    "runner": RunnerWorker,
}

async def main():
    worker_type = os.getenv("WORKER_TYPE", "planner")
    concurrency = int(os.getenv("WORKER_CONCURRENCY", "4"))

    WorkerClass = WORKER_TYPES.get(worker_type)
    if not WorkerClass:
        print(f"Unknown worker type: {worker_type}")
        sys.exit(1)

    worker = WorkerClass()
    scheduler = DelayedJobScheduler()

    # Handle graceful shutdown
    loop = asyncio.get_event_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, lambda: asyncio.create_task(shutdown(worker, scheduler)))

    print(f"Starting {worker_type} worker (concurrency={concurrency})")
    await asyncio.gather(
        worker.start(),
        scheduler.start(),
    )

async def shutdown(worker, scheduler):
    print("Shutting down gracefully...")
    await worker.stop()
    scheduler._running = False

if __name__ == "__main__":
    asyncio.run(main())
```

---

## 9. Real-Time Communication

### 9.1 SSE Event Proxy

Instead of the current `StreamingResponse` generator (which blocks a worker), the API gateway subscribes to a Redis Pub/Sub channel per conversation and proxies events to the SSE client.

```mermaid
sequenceDiagram
    participant FE as Frontend
    participant API as API Gateway
    participant Redis as Redis Pub/Sub
    participant Worker as Worker

    FE->>API: GET /brain/stream/{conv_id}
    API->>Redis: SUBSCRIBE brain:evt:{conv_id}

    loop Live Event Stream
        Worker->>Redis: PUBLISH brain:evt:{conv_id}
        Redis-->>API: Event message
        API-->>FE: SSE: data: {event}
    end

    Note over FE,API: On disconnect & reconnect
    FE->>API: GET /brain/stream/{conv_id}
    API->>Redis: GET job:{id}:state (sync)
    API-->>FE: SSE: data: {state_sync}
    loop Resume streaming
        Worker->>Redis: PUBLISH brain:evt:{conv_id}
        Redis-->>API: Event message
        API-->>FE: SSE: data: {event}
    end
```

```python
# Brain/queues/sse_proxy.py — Conceptual Design

import asyncio
import json
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from Brain.config.redis import redis_client

router = APIRouter(prefix="/brain/stream", tags=["queue"])

@router.get("/{conversation_id}")
async def stream_job_events(conversation_id: str):
    """SSE endpoint that streams real-time events for a conversation."""

    async def event_generator():
        pubsub = redis_client._client.pubsub()
        channel = f"brain:evt:{conversation_id}"
        await pubsub.subscribe(channel)

        try:
            # First: send current state if job exists
            active_job = await redis_client.get(f"conv:{conversation_id}:active_job")
            if active_job:
                state = await redis_client.get(f"job:{active_job}:state")
                if state:
                    yield f"data: {json.dumps({'type': 'state_sync', 'state': json.loads(state)})}\n\n"

            # Then: stream live events
            while True:
                message = await pubsub.get_message(
                    ignore_subscribe_messages=True, timeout=1.0
                )
                if message and message["type"] == "message":
                    yield f"data: {message['data']}\n\n"
                else:
                    yield ": keep-alive\n\n"
                    await asyncio.sleep(1)
        finally:
            await pubsub.unsubscribe(channel)
            await pubsub.close()

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
```

### 9.2 Event Publishing (Worker → Client)

Workers publish events to the Redis channel after each meaningful state change:

```python
# Called by workers after each phase/step

async def publish_event(conversation_id: str, event: dict):
    channel = f"brain:evt:{conversation_id}"
    await redis_client._client.publish(channel, json.dumps(event))
```

### 9.3 Event Types

| Event Type | Payload | When |
|------------|---------|------|
| `job_queued` | `{job_id, job_type, queue}` | Job enqueued |
| `job_started` | `{job_id, worker_id}` | Worker picked up job |
| `phase_update` | `{phase, agent, status, report}` | LangGraph node complete |
| `task_started` | `{task_index, total, label}` | Builder starts a task |
| `task_completed` | `{task_index, status, result}` | Builder finishes a task |
| `sandbox_update` | `{status, preview_url, ops}` | Sandbox state change |
| `progress` | `{current, total, percent, label}` | Progress bar update |
| `final_report` | `{report, plan, status}` | Build complete |
| `error` | `{error, retryable}` | Something failed |
| `stopped` | `{reason}` | User stopped execution |

---

## 10. Scalability Strategy

### 10.1 Horizontal Scaling

**Phase 1: Same EC2 (add containers)**

```mermaid
graph TB
    subgraph EC2["Single EC2 Instance"]
        RC["Redis :6379"]
        PG[("PostgreSQL :5432")]

        subgraph CW["Containers"]
            W1["Planner Worker"]
            W2["Builder Worker x1-3"]
            W3["Runner Worker"]
            W4["Background Worker"]
        end
    end

    RC --> W1 & W2 & W3 & W4
    W1 & W2 & W3 --> PG
```

**Phase 2: Two EC2s (split API + Workers)**

```mermaid
graph LR
    subgraph EC2A["EC2 A — API + DB"]
        API["Brain + Node Backend"]
        PG[("PostgreSQL")]
        RC["Redis"]
    end

    subgraph EC2B["EC2 B — Workers"]
        W1["Planner x2"]
        W2["Builder x4"]
        W3["Runner x2"]
    end

    API --> RC
    RC --> W1 & W2 & W3
    W1 & W2 & W3 --> PG
```

### 10.2 Scaling Rules

| Metric | Threshold | Action |
|--------|-----------|--------|
| Queue depth (high) | > 50 pending | Scale planner workers +2 |
| Queue depth (normal) | > 200 pending | Scale builder workers +4 |
| Queue depth (low) | > 20 pending | Scale runner workers +2 |
| Worker heartbeat missing | > 30s | Mark worker dead, reassign jobs |
| Memory usage (worker) | > 80% | Restart worker, scale out |
| Redis memory | > 75% | Scale Redis cluster |

### 10.3 Worker Isolation (Docker Compose — extends existing setup)

Workers run as additional containers in the **same docker-compose.yml** already deployed on EC2. No new infrastructure needed initially.

```yaml
# Add these services to your existing docker-compose.yml

  # --- Queue Workers (new) ---

  planner-worker:
    build:
      context: ./Brain
      dockerfile: Dockerfile
    container_name: grizon-planner-worker
    restart: unless-stopped
    depends_on:
      redis:
        condition: service_healthy
    env_file:
      - .env.docker
    environment:
      - WORKER_TYPE=planner
      - WORKER_CONCURRENCY=4
      - DATABASE_URL=postgresql://app:app@postgres:5432/app?sslmode=disable
      - REDIS_URL=redis://redis:6379
      - PYTHONUNBUFFERED=1
    command: ["python", "-m", "Brain.queues.worker_main"]
    volumes:
      - ./Brain:/app/Brain
      - ./workspaces:/app/workspaces
    deploy:
      resources:
        limits: { cpus: "2", memory: 4G }

  builder-worker:
    build:
      context: ./Brain
      dockerfile: Dockerfile
    container_name: grizon-builder-worker
    restart: unless-stopped
    depends_on:
      redis:
        condition: service_healthy
    env_file:
      - .env.docker
    environment:
      - WORKER_TYPE=builder
      - WORKER_CONCURRENCY=8
      - DATABASE_URL=postgresql://app:app@postgres:5432/app?sslmode=disable
      - REDIS_URL=redis://redis:6379
      - PYTHONUNBUFFERED=1
    command: ["python", "-m", "Brain.queues.worker_main"]
    volumes:
      - ./Brain:/app/Brain
      - ./workspaces:/app/workspaces
    deploy:
      resources:
        limits: { cpus: "4", memory: 8G }

  runner-worker:
    build:
      context: ./Brain
      dockerfile: Dockerfile
    container_name: grizon-runner-worker
    restart: unless-stopped
    depends_on:
      redis:
        condition: service_healthy
    env_file:
      - .env.docker
    environment:
      - WORKER_TYPE=runner
      - WORKER_CONCURRENCY=4
      - DATABASE_URL=postgresql://app:app@postgres:5432/app?sslmode=disable
      - REDIS_URL=redis://redis:6379
      - PYTHONUNBUFFERED=1
    command: ["python", "-m", "Brain.queues.worker_main"]
    volumes:
      - ./Brain:/app/Brain
      - ./workspaces:/app/workspaces
    deploy:
      resources:
        limits: { cpus: "2", memory: 4G }

  background-worker:
    build:
      context: ./Brain
      dockerfile: Dockerfile
    container_name: grizon-bg-worker
    restart: unless-stopped
    depends_on:
      redis:
        condition: service_healthy
    env_file:
      - .env.docker
    environment:
      - WORKER_TYPE=background
      - WORKER_CONCURRENCY=2
      - DATABASE_URL=postgresql://app:app@postgres:5432/app?sslmode=disable
      - REDIS_URL=redis://redis:6379
      - PYTHONUNBUFFERED=1
    command: ["python", "-m", "Brain.queues.worker_main"]
    volumes:
      - ./Brain:/app/Brain
    deploy:
      resources:
        limits: { cpus: "1", memory: 2G }
```

**Running workers:**
```bash
# Start only workers (brain stays as-is)
docker compose --profile brain up -d planner-worker builder-worker runner-worker background-worker

# Scale builder workers on demand
docker compose --profile brain up -d --scale builder-worker=3 builder-worker
```

---

## 11. Reliability & Fault Tolerance

### 11.1 Retry Strategy

```mermaid
flowchart LR
    A["Job Fails"] --> B{"Attempts < 3?"}
    B -->|Yes| C["Wait 5s × 2^attempt"]
    C --> D["Re-enqueue to<br/>delayed_jobs"]
    D --> E["Scheduler moves<br/>to target queue"]
    E --> F["Worker picks up"]
    F --> A
    B -->|No| G["Dead Letter Queue"]
    G --> H["Alert + Manual<br/>re-inspection"]

    style A fill:#ffebee
    style G fill:#ffcdd2
    style H fill:#fff3e0
```

| Attempt | Delay | Backoff |
|---------|-------|---------|
| 1st retry | 5s | Fixed |
| 2nd retry | 20s | Exponential |
| 3rd retry | 120s | Exponential |
| After 3 → Dead Letter | — | Manual inspection |

### 11.2 Dead Letter Queue

Jobs that fail all retries go to `brain:q:dead_letter`. A monitoring process alerts and allows manual re-enqueue:

```python
async def requeue_dead_letter(job_id: str):
    """Manually re-enqueue a dead-lettered job."""
    raw = await redis_client.xrange("brain:q:dead_letter", count=1000)
    for msg_id, fields in raw:
        payload = json.loads(fields.get("payload", "{}"))
        if payload.get("job_id") == job_id:
            payload["attempts"] = "0"  # Reset attempts
            await redis_client.xadd(payload["queue"], {"payload": json.dumps(payload)})
            await redis_client.xdel("brain:q:dead_letter", msg_id)
            return True
    return False
```

### 11.3 Graceful Degradation

If Redis is unavailable, the system falls back to the current in-process behavior:

```python
async def enqueue_with_fallback(job_type, payload, conv_id, user_id):
    try:
        job_id = await enqueuer.enqueue(job_type, payload, conv_id, user_id)
        return {"job_id": job_id, "mode": "queued"}
    except Exception as e:
        # Redis down — fall back to in-process
        print(f"[QUEUE] Redis unavailable ({e}), falling back to in-process")
        return {"job_id": None, "mode": "in_process", "error": str(e)}
```

### 11.4 Crash Recovery

- **Redis Streams are durable** — messages persist across worker restarts.
- **Consumer groups** ensure no message is lost; unACK'd messages are redelivered after `visibility_timeout`.
- **PostgreSQL job records** allow rebuilding Redis state from DB on startup.

---

## 12. Monitoring & Observability

### 12.1 Metrics to Track

| Metric | Type | Source |
|--------|------|--------|
| `brain_queue_depth_{queue}` | Gauge | Redis XLEN |
| `brain_job_duration_seconds` | Histogram | Per job_type |
| `brain_job_failures_total` | Counter | Per job_type, error |
| `brain_worker_active_count` | Gauge | Per worker_type |
| `brain_worker_cpu_percent` | Gauge | Per worker |
| `brain_worker_memory_bytes` | Gauge | Per worker |
| `brain_api_enqueue_latency_ms` | Histogram | API gateway |
| `brain_sse_connection_count` | Gauge | Per conversation |
| `brain_redis_memory_bytes` | Gauge | Redis INFO |

### 12.2 Health Check Endpoint

```python
@router.get("/brain/queue/health")
async def queue_health():
    return {
        "redis": await redis_client.ping(),
        "queues": {
            q: await redis_client.xinfo_stream(q)  # length, consumers, etc.
            for q in JobEnqueueService.ALL_QUEUES
        },
        "dead_letter_count": await redis_client.xlen("brain:q:dead_letter"),
        "delayed_jobs_count": await redis_client.zcard("brain:delayed_jobs"),
    }
```

### 12.3 Dashboard (Future)

- Grafana dashboard with Redis metrics, queue depths, worker status
- Alerting on: queue depth > threshold, worker death, high failure rate

---

## 13. API Contract Changes

### 13.1 New Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/brain/chat/submit` | Enqueue a chat job, returns `{job_id}` immediately |
| `GET` | `/brain/stream/{conversation_id}` | SSE stream for real-time events |
| `GET` | `/brain/job/{job_id}` | Get job status and result |
| `POST` | `/brain/job/{job_id}/cancel` | Cancel a running job |
| `GET` | `/brain/queue/health` | Queue system health check |
| `GET` | `/brain/queue/stats` | Queue depth and worker stats |

### 13.2 Modified Endpoints

| Method | Path | Change |
|--------|------|--------|
| `POST` | `/brain/chat` | Keep for backward compat, internally enqueues + waits |
| `POST` | `/brain/chat/stream` | Keep for backward compat, internally enqueues + streams via Redis proxy |
| `POST` | `/brain/sandbox/write-file` | No change |

### 13.3 New Request/Response Types

```python
# Brain/queues/types.py

from pydantic import BaseModel
from typing import Optional, Any, Dict

class ChatSubmitRequest(BaseModel):
    user_id: str
    conversation_id: Optional[str] = None
    content: str
    repo_url: Optional[str] = None
    model_id: Optional[str] = "deepseek-chat"
    plan_approved: Optional[bool] = False
    framework: Optional[str] = "react"
    resume_build: Optional[bool] = False

class ChatSubmitResponse(BaseModel):
    job_id: str
    conversation_id: str
    status: str  # "queued"
    stream_url: str  # SSE endpoint to listen on

class JobStatusResponse(BaseModel):
    job_id: str
    status: str
    progress: Optional[Dict[str, Any]] = None
    result: Optional[Any] = None
    error: Optional[str] = None
    created_at: str
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
```

---

## 14. Migration Strategy

```mermaid
gantt
    title Migration Timeline
    dateFormat  YYYY-MM-DD
    section Phase 0
    Dual-Mode (Current + Queue)    :a1, 2026-08-01, 14d
    section Phase 1
    Queue-Primary (frontend migrate) :a2, after a1, 14d
    section Phase 2
    Queue-Only (remove old code)     :a3, after a2, 7d
```

### Phase 0: Dual-Mode (Current → Queue)

The system runs in **hybrid mode** where:
- New `POST /brain/chat/submit` endpoint uses the queue
- Existing `POST /brain/chat` and `POST /brain/chat/stream` continue working as-is
- Frontend can migrate incrementally

### Phase 1: Queue-Primary

- Frontend switches to `POST /brain/chat/submit` + SSE subscription
- Old endpoints become thin wrappers that enqueue internally
- Both modes share the same DB and Redis

### Phase 2: Queue-Only

- Old sync endpoints deprecated
- All traffic goes through the queue system
- Remove fallback code

### Rollback Plan

If the queue system causes issues:
1. Set `QUEUE_ENABLED=false` env var
2. System falls back to in-process execution (current behavior)
3. No code changes needed — the fallback is built into the enqueue service

---

## 15. Infrastructure Requirements

### Current Setup (Already on EC2)

Your existing `docker-compose.yml` already runs:

| Service | Container | Port | Status |
|---------|-----------|------|--------|
| PostgreSQL (pgvector) | grizon-postgres | 5432 | Running |
| Redis 7 | grizon-redis | 6379 | Running |
| Brain (FastAPI) | grizon-brain | 8001 | Running |
| Node Backend | grizon-backend | 4000 | Running |
| Qdrant | grizon-qdrant | 6333 | Running |
| PgWeb | grizon-pgweb | 8081 | Running |

### What the Queue System Adds (Same EC2)

No new EC2 instances needed. Just add worker containers to the existing docker-compose:

| New Container | Resource Needs | Purpose |
|---------------|---------------|---------|
| `grizon-planner-worker` | 2 CPU / 4GB | LangGraph workflow (analyze, plan, todo) |
| `grizon-builder-worker` × 1–3 | 4 CPU / 8GB each | Code generation per task |
| `grizon-runner-worker` | 2 CPU / 4GB | Sandbox deployment |
| `grizon-bg-worker` | 1 CPU / 2GB | Title gen, memory writes, cleanup |

**Total additional on same EC2:** ~13 CPU / 26GB RAM (scale builder workers based on load)

### When to Add a Second EC2

Scale to a second EC2 instance when:
- Builder queue depth consistently > 100 pending jobs
- EC2 CPU usage > 80% sustained
- You need > 5 concurrent builder workers

At that point, run workers on EC2 #2 and keep the API + DB on EC2 #1.

---

## 16. Cost Estimation

### Already Running (No Additional Cost)

Your existing EC2 + Docker Compose stack covers:
- EC2 instance (already paying for it)
- PostgreSQL (container, no extra cost)
- Redis (container, no extra cost)
- Brain FastAPI (container, no extra cost)

### Queue System Additional Cost

**Phase 1 (Same EC2 — $0 extra):**
Just add worker containers. If your EC2 has enough headroom, this costs nothing extra.

**Phase 2 (If EC2 needs upgrade):**
If adding workers exceeds current EC2 capacity, upgrade the instance:

| Change | Monthly Cost |
|--------|-------------|
| Upgrade from current → c6g.2xlarge (8 vCPU / 16GB) | ~$200/mo extra |
| Or add a second c6g.xlarge for workers only | ~$140/mo extra |

**Phase 3 (Production scale — when needed):**
| Resource | Monthly Cost |
|----------|-------------|
| Second EC2 c6g.2xlarge (workers only) | ~$280 |
| CloudWatch basic monitoring | ~$0 (free tier) |
| **Total additional** | **~$280/mo** |

### vs. Alternative: Managed Queue Services

| Option | Monthly Cost | Complexity |
|--------|-------------|------------|
| Self-hosted (your approach) | $0–280 | Medium |
| AWS SQS + ECS Fargate | $500–2000 | Low |
| BullMQ + Redis (already have Redis) | $0 | Low |

**Recommendation:** Start with self-hosted workers on your existing EC2. It's the cheapest and you already have Redis + Docker Compose running.

---

## 17. Implementation Phases

### Phase 1: Foundation (Week 1–2)

- [ ] Create `Brain/queues/` module structure
- [ ] Implement `enqueue.py` (JobEnqueueService)
- [ ] Implement `state.py` (JobStateStore)
- [ ] Create `brain_jobs` and `brain_job_events` DB tables
- [ ] Add Redis consumer group support to `ResilientRedisClient`
- [ ] Implement `BaseWorker` class
- [ ] Create `worker_main.py` entry point
- [ ] Add `/brain/queue/health` endpoint
- [ ] Unit tests for enqueue/dequeue lifecycle

### Phase 2: Workers (Week 2–3)

- [ ] Implement `PlannerWorker` (wraps ManagerAgent + PlannerAgent + TodoAgent)
- [ ] Implement `BuilderWorker` (wraps BuilderAgent per-task)
- [ ] Implement `RunnerWorker` (wraps RunnerAgent)
- [ ] Implement `BackgroundWorker` (title gen, memory writes)
- [ ] Implement `DelayedJobScheduler`
- [ ] Integration tests: enqueue → worker picks up → processes → completes

### Phase 3: API Gateway (Week 3–4)

- [ ] Create `POST /brain/chat/submit` endpoint
- [ ] Create `GET /brain/stream/{conversation_id}` SSE proxy
- [ ] Create `GET /brain/job/{job_id}` status endpoint
- [ ] Create `POST /brain/job/{job_id}/cancel` endpoint
- [ ] Modify existing `/brain/chat` and `/brain/chat/stream` to use queue internally
- [ ] Add rate limiting per user
- [ ] API integration tests

### Phase 4: Frontend Integration (Week 4–5)

- [ ] Add `submitChat()` function to `brainApiBase.ts`
- [ ] Add SSE subscription hook `useBrainStream(conversationId)`
- [ ] Update `BrainView.tsx` to use new submit + stream flow
- [ ] Add job status polling for disconnected clients
- [ ] Handle reconnection and state sync

### Phase 5: Docker & Deployment (Week 5–6)

- [ ] Create `docker-compose.queue.yml`
- [ ] Add worker Dockerfiles
- [ ] Add Redis to deployment stack
- [ ] Create deployment scripts for worker pools
- [ ] Load testing with Locust/k6 (target: 1K concurrent)

### Phase 6: Monitoring & Hardening (Week 6–7)

- [ ] Add Prometheus metrics exporter
- [ ] Create Grafana dashboard
- [ ] Add alerting rules
- [ ] Dead letter queue monitoring
- [ ] Chaos testing: kill workers mid-job, Redis failover
- [ ] Performance tuning based on load test results

---

## 18. Risks & Mitigations

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Redis single point of failure | All jobs stall | Medium | Redis Sentinel/Cluster, fallback to in-process |
| Worker OOM on large builds | Job failure | High | Per-task memory limits, builder worker isolation |
| SSE connection drops | Client loses progress | High | Job state persistence, reconnection with state sync |
| Race condition: stop signal not reaching worker | Build continues after stop | Medium | Stop check in tight loop, TTL-based auto-stop |
| Queue backlog during traffic spike | High latency | Medium | Auto-scaling, priority queues, rate limiting |
| LangGraph state not serializable | Job payload too large | Medium | Store state in DB, pass only job_id to worker |
| Consumer group rebalancing on worker restart | Brief processing pause | Low | Short visibility timeout, fast worker startup |

---

## Appendix A: Environment Variables

Add these to your existing `.env.docker` (workers inherit the same env as Brain):

```env
# --- Queue System (add to existing .env.docker) ---
WORKER_TYPE=planner          # planner | builder | runner | background
WORKER_CONCURRENCY=4

# Queue Tuning (optional — defaults are sane)
QUEUE_HIGH_VISIBILITY_TIMEOUT=300
QUEUE_NORMAL_VISIBILITY_TIMEOUT=1800
QUEUE_LOW_VISIBILITY_TIMEOUT=900
QUEUE_MAX_RETRIES=3
QUEUE_RETRY_BASE_DELAY=5
```

Existing vars already used by the queue system:
- `REDIS_URL=redis://redis:6379` (already in .env.docker)
- `DATABASE_URL=...` (already in .env.docker)

---

## Appendix B: File Structure (New Files)

```mermaid
graph TD
    subgraph QUEUES["Brain/queues/"]
        INIT["__init__.py"]
        ENQ["enqueue.py - JobEnqueueService"]
        STATE["state.py - JobStateStore"]
        SCHED["scheduler.py - DelayedJobScheduler"]
        SSE["sse_proxy.py - SSE event proxy"]
        TYPES["types.py - Pydantic models"]
        MAIN["worker_main.py - Worker entry point"]

        subgraph WORKERS["workers/"]
            BASE["base.py - BaseWorker class"]
            PLANNER["planner_worker.py - Phase 1"]
            BUILDER["builder_worker.py - Phase 2"]
            RUNNER["runner_worker.py - Phase 3"]
            BG["background_worker.py - Background tasks"]
        end

        subgraph TESTS["tests/"]
            T1["test_enqueue.py"]
            T2["test_state.py"]
            T3["test_workers.py"]
            T4["test_scheduler.py"]
        end
    end

    MAIN --> PLANNER & BUILDER & RUNNER & BG
    PLANNER & BUILDER & RUNNER & BG --> BASE
    ENQ --> STATE
    SSE --> STATE
```

---

*This document is the authoritative design reference for the Brain Queue System implementation. All implementation decisions should trace back to this plan.*
