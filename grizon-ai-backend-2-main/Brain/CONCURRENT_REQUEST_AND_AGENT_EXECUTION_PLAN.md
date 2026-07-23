# Grizon AI Brain — Concurrent Request Handling & Hallucination-Free Agent Execution

**Version:** 1.0
**Date:** 2026-07-22
**Status:** Design — Pre-Implementation

---

## Table of Contents

1. [Problem Statement](#1-problem-statement)
2. [The Tracking Chain: User → Request → Task → File → Agent](#2-the-tracking-chain)
3. [Multi-User Request Handling: Complete Flow](#3-multi-user-request-handling-complete-flow)
4. [Concurrent Request Handling (100 Users)](#4-concurrent-request-handling-100-users)
5. [Agent Execution Without Hallucination](#5-agent-execution-without-hallucination)
6. [Request Lifecycle Under Load](#6-request-lifecycle-under-load)
7. [Agent Validation Pipeline](#7-agent-validation-pipeline)
8. [Sandbox-as-Proof Architecture](#8-sandbox-as-proof-architecture)
9. [Rate Limiting & Fairness](#9-rate-limiting--fairness)
10. [Memory & Context Isolation](#10-memory--context-isolation)
11. [Monitoring Under Load](#11-monitoring-under-load)
12. [Implementation Checklist](#12-implementation-checklist)

---

## 1. Problem Statement

### Challenge 1: 100 Concurrent Users

Currently, a single request blocks a FastAPI worker for 30s–5min. With 100 concurrent users:
- 100 blocked workers = system deadlock
- No request can complete
- Memory and CPU spike → crash

### Challenge 2: Agent Hallucination

AI agents (LLMs) can:
- Generate code that doesn't compile
- Reference APIs/files that don't exist
- Produce incorrect logic that passes syntax checks
- Create duplicate/conflicting code across tasks
- Hallucinate function names, imports, or library versions

**Goal:** Handle 100 concurrent requests smoothly AND ensure every agent output is verified before delivery.

---

## 2. The Tracking Chain: User → Request → Task → File → Agent

### 2.1 Core Question

> "100 users ne request ki — system ko kaise pata ki kiski request hai, kiske files hain, kaunsa agent kya kar raha hai?"

**Answer:** Every piece of data carries a `user_id` and `conversation_id` as a tracking chain. Nothing exists without an owner.

```mermaid
flowchart LR
    U["user_id"] --> C["conversation_id"]
    C --> J["job_id"]
    J --> T["task_id"]
    T --> F["file_path"]
    T --> A["agent_id"]

    style U fill:#e1f5fe
    style C fill:#e1f5fe
    style J fill:#fff3e0
    style T fill:#fff3e0
    style F fill:#e8f5e9
    style A fill:#f3e5f5
```

| Level | ID | Example | Where Stored |
|-------|-----|---------|-------------|
| User | `user_id` | `usr_abc123` | `users` table |
| Conversation | `conversation_id` | `conv_xyz789` | `conversations` table |
| Job | `job_id` | `job_123e4567` | `brain_jobs` table + Redis |
| Task | `task_id` | `task_0`, `task_1`, ... | `state["plan"][0]["id"]` |
| File | `file_path` | `src/components/Button.tsx` | `workspace_manager` |
| Agent | `agent_id` | `BuilderAgent-8f3a2b1c` | Worker heartbeat |

### 2.2 Data Model: Who Owns What

```mermaid
erDiagram
    USER ||--o{ CONVERSATION : creates
    USER ||--o{ BRAIN_PROJECT : owns
    CONVERSATION ||--o{ MESSAGE : contains
    CONVERSATION ||--o{ BRAIN_JOB : triggers
    CONVERSATION ||--o{ BRAIN_TASK : has
    BRAIN_JOB ||--o{ BRAIN_TASK : produces
    BRAIN_TASK ||--o{ BRAIN_FILE : generates

    USER {
        string id PK
        string email
        string name
    }
    CONVERSATION {
        string id PK
        string user_id FK
        string title
        string status
    }
    BRAIN_JOB {
        string id PK
        string conversation_id FK
        string user_id FK
        string job_type
        string status
    }
    BRAIN_TASK {
        string id PK
        string job_id FK
        string conversation_id FK
        string label
        string agent
        string status
    }
    BRAIN_FILE {
        string id PK
        string task_id FK
        string conversation_id FK
        string file_path
        string action
    }
```

### 2.3 How Each Record Links Back to User

```sql
-- Every query can trace back to the user:

-- "Whose job is this?"
SELECT user_id FROM brain_jobs WHERE id = :job_id;

-- "What files did this user's build create?"
SELECT bf.file_path, bt.label
FROM brain_files bf
JOIN brain_tasks bt ON bf.task_id = bt.id
WHERE bt.conversation_id = :conversation_id;

-- "What is this user's active build status?"
SELECT bj.status, bj.job_type, bj.created_at
FROM brain_jobs bj
WHERE bj.user_id = :user_id
  AND bj.status IN ('queued', 'running')
ORDER BY bj.created_at DESC;
```

### 2.4 When User Sends a Request — Full Traceability

```mermaid
sequenceDiagram
    participant U as User (usr_abc)
    participant API as API Gateway
    participant DB as PostgreSQL
    participant RQ as Redis Queue
    participant W as Worker

    U->>API: POST /brain/chat/submit
    Note over API: Extract user_id from JWT

    API->>DB: Ensure conversation exists
    Note over DB: conversation_id = conv_xyz, user_id = usr_abc

    API->>DB: Create brain_job record
    Note over DB: job_id = job_123, user_id = usr_abc, conversation_id = conv_xyz

    API->>RQ: Enqueue job
    Note over RQ: job:job_123:meta contains user_id + conv_id

    API-->>U: {job_id: job_123, stream_url: ...}

    W->>RQ: Pick up job_123
    Note over W: Reads user_id from job meta, creates workspace /workspaces/conv_xyz/

    W->>W: Execute LangGraph workflow
    Note over W: All state carries user_id + conversation_id
```

### 2.5 What Gets Stored at Each Step

| Step | What's Created | Owner Fields |
|------|---------------|--------------|
| User sends message | `conversations` row | `user_id` |
| User sends message | `messages` row | `user_id`, `conversation_id` |
| Job enqueued | `brain_jobs` row | `user_id`, `conversation_id` |
| Job enqueued | Redis `job:{id}:meta` | `user_id`, `conversation_id` |
| Planner runs | `brain_tasks` rows | `conversation_id`, `agent` |
| Builder runs | Files in workspace | `conversation_id` (in path) |
| Builder runs | `brain_files` rows | `task_id`, `conversation_id` |
| Deploy runs | Preview URL | `conversation_id` |

### 2.6 Agent Context: How Agents Know "Whose Work Is This"

Every agent receives a `BrainState` dictionary — the single source of truth:

```python
BrainState = {
    "user_id": "usr_abc123",           # WHO initiated this
    "conversation_id": "conv_xyz789",  # WHICH conversation
    "content": "Build a todo app",     # WHAT they asked
    "plan": [...],                     # Tasks to execute
    "current_job_id": "job_123",       # WHICH job
    "model_id": "deepseek-chat",       # WHICH LLM model
    "framework": "react",              # Project settings
}
```

How each agent uses ownership info:

| Agent | Reads | Uses For |
|-------|-------|----------|
| **ManagerAgent** | `user_id`, `content`, `messages` | Understand user intent from their history |
| **QuestionsAgent** | `user_id`, `conversation_id` | Generate questions specific to their project |
| **PlannerAgent** | `user_id`, `content`, `memory_context` | Create plan aligned with their requirements |
| **TodoAgent** | `conversation_id`, `project_plan` | Break plan into tasks for their project |
| **BuilderAgent** | `conversation_id`, `current_job_id` | Write files to THEIR workspace only |
| **RunnerAgent** | `conversation_id`, `current_job_id` | Deploy THEIR build only |

**Rule:** Agent context never includes other users' data. Each worker processes ONE job at a time.

### 2.7 File Ownership: Which Files Belong to Which User

Every conversation gets its own workspace directory:

```
/workspaces/
├── conv_abc123/          ← User A's project
│   ├── src/
│   │   ├── App.tsx
│   │   └── components/
│   │       └── Button.tsx
│   └── package.json
├── conv_def456/          ← User B's project
│   ├── src/
│   │   └── main.py
│   └── requirements.txt
└── conv_ghi789/          ← User C's project
    ├── src/
    │   └── index.html
    └── styles.css
```

File path contains conversation ID:

```python
file_path = "src/components/Button.tsx"
conversation_id = "conv_abc123"
full_path = f"/workspaces/{conversation_id}/{file_path}"
# = /workspaces/conv_abc123/src/components/Button.tsx
```

### 2.8 Task Assignment: Which Agent Handles What

Each task in the plan has an assigned agent:

```python
plan = [
    {
        "id": "task_0",
        "title": "Create Express backend with Supabase auth",
        "category": "backend",
        "agent": "BuilderAgent",      # ← WHO executes this
        "conversation_id": "conv_abc123",  # ← WHOSE project
    },
    {
        "id": "task_1",
        "title": "Create React frontend with login page",
        "category": "frontend",
        "agent": "BuilderAgent",
        "conversation_id": "conv_abc123",
    },
    {
        "id": "task_2",
        "title": "Start dev servers and verify",
        "category": "runner",
        "agent": "RunnerAgent",       # ← Different agent for deploy
        "conversation_id": "conv_abc123",
    },
]
```

Agent assignment logic:

```mermaid
flowchart TD
    A["TodoAgent generates tasks"] --> B{"Task category?"}
    B -->|"backend / frontend / integration"| C["BuilderAgent"]
    B -->|"runner / deploy"| D["RunnerAgent"]
    B -->|"planning / analysis"| E["PlannerAgent"]

    C --> F["Write code in workspace"]
    D --> G["Start servers, deploy"]
    E --> H["Generate plan, not code"]

    style C fill:#e1f5fe
    style D fill:#e8f5e9
    style E fill:#fff3e0
```

### 2.9 Redis State Map: Real-Time Tracking

```
# Job metadata (who owns this job)
job:job_123:meta → {
    "job_id": "job_123",
    "user_id": "usr_abc123",
    "conversation_id": "conv_xyz789",
    "status": "running"
}

# Active job for conversation
conv:conv_xyz789:active_job → "job_123"

# Stop signal (per conversation)
stop:conv_xyz789 → "true"

# Rate limiting (per user)
rate:usr_abc123:rpm → "3"
rate:usr_abc123:concurrent → "1"
```

### 2.10 Visual Flow: 3 Users, 3 Requests Simultaneously

```mermaid
sequenceDiagram
    participant U1 as User A (usr_1)
    participant U2 as User B (usr_2)
    participant U3 as User C (usr_3)
    participant API as API Gateway
    participant RQ as Redis Queue
    participant W1 as Worker 1
    participant W2 as Worker 2
    participant W3 as Worker 3

    par All 3 send requests at same time
        U1->>API: "Build a todo app"
        U2->>API: "Build a blog site"
        U3->>API: "Build a chat app"
    end

    API->>API: Create 3 separate jobs
    Note over API: job_1 → usr_1, conv_1 | job_2 → usr_2, conv_2 | job_3 → usr_3, conv_3

    API-->>U1: job_1, stream for conv_1
    API-->>U2: job_2, stream for conv_2
    API-->>U3: job_3, stream for conv_3

    par Workers pick up jobs
        W1->>RQ: Pick job_1 (usr_1)
        W2->>RQ: Pick job_2 (usr_2)
        W3->>RQ: Pick job_3 (usr_3)
    end

    Note over W1: State = user_id: usr_1, conv_id: conv_1 → writes to /workspaces/conv_1/
    Note over W2: State = user_id: usr_2, conv_id: conv_2 → writes to /workspaces/conv_2/
    Note over W3: State = user_id: usr_3, conv_id: conv_3 → writes to /workspaces/conv_3/

    par Each worker reports back
        W1-->>U1: SSE: task_0 completed
        W2-->>U2: SSE: task_0 completed
        W3-->>U3: SSE: task_0 completed
    end

    Note over W1,W3: Workers NEVER mix data between users
```

What each worker sees:

| Worker | Current Job | User | Workspace | Tasks |
|--------|------------|------|-----------|-------|
| Worker 1 | job_1 | usr_1 | `/workspaces/conv_1/` | Create backend, Create frontend, Deploy |
| Worker 2 | job_2 | usr_2 | `/workspaces/conv_2/` | Create blog engine, Create admin panel, Deploy |
| Worker 3 | job_3 | usr_3 | `/workspaces/conv_3/` | Create chat server, Create chat UI, Deploy |

### 2.11 Edge Cases

| Scenario | How Handled |
|----------|------------|
| Same user sends 2 messages | Each gets separate `conversation_id` OR same if follow-up |
| User has 3 active builds | Rate limiter caps at `concurrent` limit per tier |
| Worker crash mid-task | Redis Stream: message not ACK'd → redelivered to another worker |
| Two tasks write same file | Sequential execution within a conversation (one worker per job) |
| User A and User B both create `App.tsx` | Separate workspaces → no conflict |
| User clicks Stop | `stop:{conv_id}` set in Redis → current worker checks → aborts |

### 2.12 The Ownership Guarantee

```
EVERY piece of data has a clear owner:

1. Every CONVERSATION belongs to a USER
2. Every JOB belongs to a CONVERSATION (and therefore a USER)
3. Every TASK belongs to a JOB (and therefore a USER)
4. Every FILE belongs to a TASK (and therefore a USER)
5. Every AGENT execution reads ONLY its assigned task's data
6. Every WORKSPACE is isolated per CONVERSATION

Result: User A never sees User B's files, tasks, or agent outputs.
```

---

## 3. Multi-User Request Handling: Complete Flow

### 3.1 What Happens When Multiple Users Send Requests

```mermaid
flowchart TD
    subgraph "Users (Browser / Mobile)"
        U1["User A\nBuild a todo app"]
        U2["User B\nBuild a blog site"]
        U3["User C\nFix my login bug"]
        U4["User D\nBuild a chat app"]
        U5["User N\n...100 more users"]
    end

    subgraph "API Gateway (FastAPI :8001)"
        AUTH["Auth Middleware\nExtract user_id from JWT"]
        RATE["Rate Limiter\nCheck user tier + limits"]
        ENQ["Job Enqueuer\nCreate job + push to Redis"]
    end

    subgraph "Redis Queue"
        Q_HIGH["brain:q:high\nPlanning jobs"]
        Q_NORM["brain:q:normal\nBuild jobs"]
        Q_LOW["brain:q:low\nDeploy jobs"]
        STATE["Job State Store\njob:{id}:state"]
    end

    subgraph "Worker Pool"
        W1["Planner Worker 1"]
        W2["Planner Worker 2"]
        W3["Builder Worker 1"]
        W4["Builder Worker 2"]
        W5["Builder Worker 3"]
        W6["Runner Worker 1"]
    end

    subgraph "Per-User Workspaces"
        WS_A["/workspaces/conv_A/\nUser A's files"]
        WS_B["/workspaces/conv_B/\nUser B's files"]
        WS_C["/workspaces/conv_C/\nUser C's files"]
        WS_D["/workspaces/conv_D/\nUser D's files"]
    end

    U1 & U2 & U3 & U4 & U5 --> AUTH
    AUTH --> RATE
    RATE --> ENQ
    ENQ --> Q_HIGH
    Q_HIGH --> W1 & W2
    W1 & W2 --> Q_NORM
    Q_NORM --> W3 & W4 & W5
    W3 --> WS_A
    W4 --> WS_B
    W5 --> WS_C
    Q_LOW --> W6
    W6 --> WS_A & WS_B

    style U1 fill:#e1f5fe
    style U2 fill:#e1f5fe
    style U3 fill:#e1f5fe
    style U4 fill:#e1f5fe
    style U5 fill:#e1f5fe
    style WS_A fill:#e8f5e9
    style WS_B fill:#e8f5e9
    style WS_C fill:#e8f5e9
    style WS_D fill:#e8f5e9
```

### 3.2 Complete Request Flow: Step by Step

```mermaid
sequenceDiagram
    participant UA as User A
    participant UB as User B
    participant UC as User C
    participant API as API Gateway
    participant AUTH as Auth Service
    participant RATE as Rate Limiter
    participant RQ as Redis Queue
    participant PW as Planner Workers
    participant BW as Builder Workers
    participant WS as Workspaces

    Note over UA,UC: === STEP 1: All 3 users send requests simultaneously ===

    par User A sends request
        UA->>API: POST /brain/chat/submit
        API->>AUTH: Validate JWT token
        AUTH-->>API: user_id = usr_A
        API->>RATE: Check rate limit (usr_A, free tier)
        RATE-->>API: allowed (0/5 RPM, 0/1 concurrent)
        API->>RQ: Enqueue job_job_A (user_id: usr_A, conv_id: conv_A)
        API-->>UA: {job_id: job_A, stream: /brain/stream/conv_A}
    end

    par User B sends request
        UB->>API: POST /brain/chat/submit
        API->>AUTH: Validate JWT token
        AUTH-->>API: user_id = usr_B
        API->>RATE: Check rate limit (usr_B, pro tier)
        RATE-->>API: allowed (0/20 RPM, 0/3 concurrent)
        API->>RQ: Enqueue job_job_B (user_id: usr_B, conv_id: conv_B)
        API-->>UB: {job_id: job_B, stream: /brain/stream/conv_B}
    end

    par User C sends request
        UC->>API: POST /brain/chat/submit
        API->>AUTH: Validate JWT token
        AUTH-->>API: user_id = usr_C
        API->>RATE: Check rate limit (usr_C, free tier)
        RATE-->>API: allowed (0/5 RPM, 0/1 concurrent)
        API->>RQ: Enqueue job_job_C (user_id: usr_C, conv_id: conv_C)
        API-->>UC: {job_id: job_C, stream: /brain/stream/conv_C}
    end

    Note over UA,UC: === STEP 2: Workers pick up jobs from queue ===

    par Planner Phase
        PW->>RQ: Pick job_job_A
        Note over PW: State = {user_id: usr_A, conv_id: conv_A}
        PW->>PW: ManagerAgent → PlannerAgent → TodoAgent
        PW->>RQ: Enqueue build tasks for conv_A

        PW->>RQ: Pick job_job_B
        Note over PW: State = {user_id: usr_B, conv_id: conv_B}
        PW->>PW: ManagerAgent → PlannerAgent → TodoAgent
        PW->>RQ: Enqueue build tasks for conv_B
    end

    Note over UA,UC: === STEP 3: Builder workers process tasks ===

    par Builder Phase
        BW->>RQ: Pick task from job_job_A
        Note over BW: Writes to /workspaces/conv_A/
        BW->>WS: Create files in conv_A workspace
        BW->>BW: Validate code in sandbox
        BW->>RQ: Task complete → pick next

        BW->>RQ: Pick task from job_job_B
        Note over BW: Writes to /workspaces/conv_B/
        BW->>WS: Create files in conv_B workspace
        BW->>BW: Validate code in sandbox
        BW->>RQ: Task complete → pick next
    end

    Note over UA,UC: === STEP 4: Real-time updates via SSE ===

    par SSE Streams
        PW-->>UA: SSE: {"phase": "planning", "status": "analyzing"}
        PW-->>UB: SSE: {"phase": "planning", "status": "analyzing"}
        BW-->>UA: SSE: {"task_started": "Create backend API", "index": 0}
        BW-->>UB: SSE: {"task_started": "Create blog engine", "index": 0}
        BW-->>UA: SSE: {"task_completed": "Create backend API", "status": "done"}
        BW-->>UB: SSE: {"task_completed": "Create blog engine", "status": "done"}
    end
```

### 3.3 The API Gateway: Entry Point for All Users

```python
# Brain/queues/controllers/chat_submit.py

from fastapi import APIRouter, Depends, Request
from Brain.queues.enqueue import JobEnqueueService
from Brain.queues.rate_limiter import RateLimiter
from Brain.queues.types import ChatSubmitRequest, ChatSubmitResponse

router = APIRouter(prefix="/brain/chat", tags=["queue"])
enqueuer = JobEnqueueService()
rate_limiter = RateLimiter()

@router.post("/submit", response_model=ChatSubmitResponse)
async def submit_chat(request: ChatSubmitRequest, http_request: Request):
    """
    Multi-user entry point. Every request goes through:
    1. Auth (extract user_id from JWT)
    2. Rate limit check (per-user)
    3. Job creation + enqueue
    4. Return job_id + stream URL
    """

    # Step 1: Extract user_id from JWT
    user_id = http_request.state.user_id  # Set by auth middleware

    # Step 2: Rate limit check
    tier = http_request.state.user_tier  # "free", "pro", "enterprise"
    rate_check = await rate_limiter.check_rate_limit(user_id, tier)
    if not rate_check["allowed"]:
        return HTTPException(
            status_code=429,
            detail=rate_check["reason"],
            headers={"Retry-After": str(rate_check["retry_after"])}
        )

    # Step 3: Create or get conversation
    conversation_id = await ensure_conversation(
        user_id=user_id,
        content=request.content,
        existing_id=request.conversation_id
    )

    # Step 4: Enqueue job
    job_id = await enqueuer.enqueue(
        job_type="chat_analyze",
        payload={
            "user_id": user_id,
            "conversation_id": conversation_id,
            "content": request.content,
            "model_id": request.model_id,
            "framework": request.framework,
        },
        conversation_id=conversation_id,
        user_id=user_id,
        priority="high",
    )

    # Step 5: Increment concurrent counter
    await rate_limiter.increment_concurrent(user_id)

    # Step 6: Return immediately (don't block!)
    return ChatSubmitResponse(
        job_id=job_id,
        conversation_id=conversation_id,
        status="queued",
        stream_url=f"/brain/stream/{conversation_id}",
    )
```

### 3.4 How Workers Know Which User's Job They're Processing

```python
# Brain/queues/workers/planner_worker.py

class PlannerWorker(BaseWorker):
    async def process(self, payload):
        """
        Each job payload contains:
        {
            "job_id": "job_123",
            "user_id": "usr_abc",         ← WHO requested this
            "conversation_id": "conv_xyz", ← WHICH conversation
            "job_type": "chat_analyze",
            "payload": { ... }             ← The actual work
        }
        """

        user_id = payload["user_id"]
        conversation_id = payload["conversation_id"]
        job_type = payload["job_type"]

        print(f"[PLANNER] Processing {job_type} for user {user_id}, conv {conversation_id}")

        # Build state with ONLY this user's data
        state = {
            "user_id": user_id,                    # This user only
            "conversation_id": conversation_id,    # This conversation only
            "content": payload["payload"]["content"],
            "model_id": payload["payload"]["model_id"],
            "framework": payload["payload"]["framework"],
        }

        # Run LangGraph workflow
        if job_type == "chat_analyze":
            agent = ManagerAgent()
            result = await agent.execute(state)

        elif job_type == "chat_plan":
            agent = PlannerAgent()
            result = await agent.execute(state)

        elif job_type == "chat_todo":
            agent = TodoAgent()
            result = await agent.execute(state)

        # Publish progress event for THIS user's SSE stream
        await publish_event(conversation_id, {
            "type": "phase_update",
            "agent": "PlannerAgent",
            "status": "completed",
            "user_id": user_id,  # For logging only
        })

        return result
```

### 3.5 How Builder Writes Files to Correct User's Workspace

```python
# Brain/queues/workers/builder_worker.py

class BuilderWorker(BaseWorker):
    async def process(self, payload):
        """
        Builder receives a task like:
        {
            "job_id": "job_123",
            "user_id": "usr_abc",
            "conversation_id": "conv_xyz",
            "payload": {
                "task": {
                    "id": "task_0",
                    "title": "Create login component",
                    "category": "frontend",
                },
                "plan": [...]
            }
        }
        """

        user_id = payload["user_id"]
        conversation_id = payload["conversation_id"]
        task = payload["payload"]["task"]

        # CRITICAL: workspace path includes conversation_id
        workspace = f"/workspaces/{conversation_id}"

        print(f"[BUILDER] User {user_id}: Building task '{task['title']}' in {workspace}")

        # Create workspace if it doesn't exist
        os.makedirs(workspace, exist_ok=True)

        # Run builder agent with THIS user's workspace only
        agent = BuilderAgent()
        state = {
            "user_id": user_id,
            "conversation_id": conversation_id,
            "current_task": task,
            "workspace_path": workspace,  # ← Isolated workspace
        }

        # Agent writes files to THIS workspace only
        async for event in agent.execute(state):
            if isinstance(event, dict) and event.get("execute_sandbox"):
                for op in event["execute_sandbox"].get("workspace_ops", []):
                    file_path = op.get("path", "")

                    # Verify file is within THIS user's workspace
                    full_path = os.path.join(workspace, file_path)
                    if not full_path.startswith(workspace):
                        raise SecurityError(
                            f"Agent tried to write outside workspace: {file_path}"
                        )

                    # Write file
                    os.makedirs(os.path.dirname(full_path), exist_ok=True)
                    with open(full_path, "w") as f:
                        f.write(op.get("content", ""))

                    print(f"[BUILDER] User {user_id}: Created {file_path}")

                # Publish progress for THIS user
                await publish_event(conversation_id, {
                    "type": "task_completed",
                    "task_id": task["id"],
                    "task_title": task["title"],
                })

        return {"status": "completed", "task_id": task["id"]}
```

### 3.6 SSE Stream: Each User Gets Their Own Real-Time Updates

```python
# Brain/queues/sse_proxy.py

@router.get("/stream/{conversation_id}")
async def stream_events(conversation_id: str, request: Request):
    """
    Each user connects to their OWN SSE stream.
    User A connects to /brain/stream/conv_A
    User B connects to /brain/stream/conv_B
    They never see each other's events.
    """

    async def event_generator():
        pubsub = redis_client._client.pubsub()
        channel = f"brain:evt:{conversation_id}"
        await pubsub.subscribe(channel)

        try:
            # Sync: send current state if job exists
            active_job = await redis_client.get(f"conv:{conversation_id}:active_job")
            if active_job:
                state = await redis_client.get(f"job:{active_job}:state")
                if state:
                    yield f"data: {json.dumps({'type': 'state_sync', 'state': json.loads(state)})}\n\n"

            # Stream live events for THIS conversation only
            while True:
                message = await pubsub.get_message(
                    ignore_subscribe_messages=True, timeout=1.0
                )
                if message and message["type"] == "message":
                    yield f"data: {message['data']}\n\n"
                else:
                    yield ": keep-alive\n\n"
                    await asyncio.sleep(1)

                # Check if client disconnected
                    if await request.is_disconnected():
                        break
        finally:
            await pubsub.unsubscribe(channel)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
    )
```

### 3.7 Real Example: 5 Users Simultaneous

| Time | User A (free) | User B (pro) | User C (free) | User D (pro) | User E (free) |
|------|--------------|--------------|---------------|--------------|---------------|
| T+0s | Send request | Send request | Send request | Send request | Send request |
| T+0.1s | Job enqueued | Job enqueued | Job enqueued | Job enqueued | Job enqueued |
| T+1s | Worker picks up | Worker picks up | Waiting in queue | Worker picks up | Waiting in queue |
| T+30s | Planning done | Planning done | Worker picks up | Planning done | Worker picks up |
| T+60s | Building task 1 | Building task 1 | Planning done | Building task 1 | Planning done |
| T+120s | Building task 2 | Building task 3 | Building task 1 | Building task 2 | Building task 1 |
| T+180s | Deploy | Deploy | Building task 2 | Deploy | Building task 2 |
| T+240s | **DONE** | **DONE** | Building task 3 | **DONE** | Building task 3 |
| T+300s | - | - | Deploy | - | Deploy |
| T+360s | - | - | **DONE** | - | **DONE** |

### 3.8 Redis Keys for Multi-User Tracking

```redis
# Per-user rate limiting
rate:usr_A:rpm → "3"                          # User A made 3 requests this minute
rate:usr_A:concurrent → "1"                   # User A has 1 active job
rate:usr_B:rpm → "7"                          # User B made 7 requests this minute
rate:usr_B:concurrent → "2"                   # User B has 2 active jobs

# Per-conversation job tracking
conv:conv_A:active_job → "job_A"              # User A's active job
conv:conv_B:active_job → "job_B"              # User B's active job
conv:conv_C:active_job → "job_C"              # User C's active job

# Per-job metadata (contains user_id + conversation_id)
job:job_A:meta → {"user_id": "usr_A", "conversation_id": "conv_A", "status": "running"}
job:job_B:meta → {"user_id": "usr_B", "conversation_id": "conv_B", "status": "running"}
job:job_C:meta → {"user_id": "usr_C", "conversation_id": "conv_C", "status": "queued"}

# Per-conversation SSE channel
brain:evt:conv_A → (pub/sub channel for User A's real-time events)
brain:evt:conv_B → (pub/sub channel for User B's real-time events)
brain:evt:conv_C → (pub/sub channel for User C's real-time events)

# Stop signals (per conversation)
stop:conv_A → "true"                          # User A clicked Stop
```

### 3.9 Database Records for Multi-User

```sql
-- All records linked to their user

-- Conversations
INSERT INTO conversations (id, user_id, title) VALUES
('conv_A', 'usr_A', 'Build a todo app'),
('conv_B', 'usr_B', 'Build a blog site'),
('conv_C', 'usr_C', 'Fix my login bug');

-- Jobs
INSERT INTO brain_jobs (id, user_id, conversation_id, job_type, status) VALUES
('job_A', 'usr_A', 'conv_A', 'chat_analyze', 'completed'),
('job_B', 'usr_B', 'conv_B', 'chat_analyze', 'completed'),
('job_C', 'usr_C', 'conv_C', 'chat_analyze', 'running');

-- Tasks (each task knows which conversation it belongs to)
INSERT INTO brain_tasks (id, job_id, conversation_id, label, agent, status) VALUES
('task_A0', 'job_A', 'conv_A', 'Create backend API', 'BuilderAgent', 'completed'),
('task_A1', 'job_A', 'conv_A', 'Create frontend UI', 'BuilderAgent', 'running'),
('task_B0', 'job_B', 'conv_B', 'Create blog engine', 'BuilderAgent', 'completed'),
('task_C0', 'job_C', 'conv_C', 'Debug login flow', 'BuilderAgent', 'pending');

-- Query: "Show me all active jobs"
SELECT bj.id, bj.user_id, bj.conversation_id, bj.status, bj.job_type
FROM brain_jobs bj
WHERE bj.status IN ('queued', 'running')
ORDER BY bj.created_at;

-- Output:
-- id    | user_id | conversation_id | status  | job_type
-- ------|---------|-----------------|---------|----------
-- job_C | usr_C   | conv_C          | running | chat_analyze
```

### 3.10 Security: User A Never Sees User B's Data

```python
# Security checks at every layer

class MultiUserSecurity:
    """Ensures no cross-user data leakage."""

    @staticmethod
    def validate_workspace_access(user_id: str, conversation_id: str) -> bool:
        """Verify user owns this conversation."""
        db = SessionLocal()
        conv = db.query(Conversation).filter(
            Conversation.id == conversation_id,
            Conversation.userId == user_id
        ).first()
        db.close()
        return conv is not None

    @staticmethod
    def validate_file_path(workspace: str, file_path: str) -> bool:
        """Ensure file stays within workspace boundary."""
        full_path = os.path.normpath(os.path.join(workspace, file_path))
        return full_path.startswith(os.path.normpath(workspace))

    @staticmethod
    def validate_job_access(user_id: str, job_id: str) -> bool:
        """Verify user owns this job."""
        meta = redis_client.get(f"job:{job_id}:meta")
        if not meta:
            return False
        job = json.loads(meta)
        return job.get("user_id") == user_id
```

### 3.11 What If User A's Build Fails While User B Succeeds?

```mermaid
flowchart TD
    A["User A and User B both building"] --> B{"User A's task fails"}
    A --> C{"User B's task succeeds"}

    B --> D["BuilderAgent retries task A"]
    D --> E{"Retry < 3?"}
    E -->|"Yes"| F["Re-generate code with error context"]
    F --> D
    E -->|"No"| G["Mark task A as FAILED"]
    G --> H["User A sees: Task failed after 3 attempts"]
    H --> I["User A can retry or skip"]

    C --> J["User B's task approved"]
    J --> K["User B proceeds to next task"]
    K --> L["User B sees: Build complete!"]

    style G fill:#ffebee
    style L fill:#e8f5e9
    style H fill:#fff3e0
```

**Key point:** User A's failure does NOT affect User B. Each user's build is completely independent.

---

## 4. Concurrent Request Handling (100 Users)

### 2.1 How 100 Requests Flow Through the System

```mermaid
sequenceDiagram
    participant U1 as User 1-100
    participant API as API Gateway
    participant RQ as Redis Queue
    participant PW as Planner Workers
    participant BW as Builder Workers
    participant SB as Sandbox Pool

    loop 100 concurrent requests
        U1->>API: POST /brain/chat/submit
        API->>API: Rate limit check
        API->>RQ: Enqueue job
        API-->>U1: {job_id, stream_url}
    end

    Note over RQ: Jobs distributed by priority

    par Planner Phase (4 workers)
        PW->>RQ: Pick high-priority jobs
        PW->>PW: LangGraph workflow
        PW->>RQ: Enqueue build tasks
    end

    par Builder Phase (8 workers)
        BW->>RQ: Pick normal jobs
        BW->>SB: Execute in sandbox
        BW->>RQ: Report results
    end

    Note over U1: SSE stream receives events
```

### 2.2 Worker Allocation for 100 Users

| Scenario | Planner Workers | Builder Workers | Runner Workers | Total |
|----------|----------------|-----------------|----------------|-------|
| 100 simple chats (no build) | 4 | 0 | 0 | 4 |
| 100 build requests (planning) | 4 | 0 | 0 | 4 |
| 100 build requests (building) | 2 | 8 | 2 | 12 |
| Mixed (50 chat + 50 build) | 4 | 8 | 2 | 14 |

### 2.3 Queue Distribution Strategy

When 100 requests arrive simultaneously:

```mermaid
flowchart TD
    A["100 requests arrive"] --> B{"Request type?"}
    B -->|"Simple chat (30%)"| C["Enqueue to brain:q:high"]
    B -->|"Build request (60%)"| D["Enqueue to brain:q:high"]
    B -->|"Resume build (10%)"| E["Enqueue to brain:q:high"]

    C --> F["Planner workers process"]
    D --> F
    E --> G["Skip to brain:q:normal"]

    F --> H{"Needs clarification?"}
    H -->|"Yes (20%)"| I["Return questions to user"]
    H -->|"No (80%)"| J["Generate plan + todo"]
    J --> K["Enqueue build tasks to brain:q:normal"]

    K --> L["Builder workers process"]
    L --> M["Each task verified in sandbox"]
    M --> N["Enqueue deploy to brain:q:low"]
    N --> O["Runner workers deploy"]

    style A fill:#e1f5fe
    style I fill:#fff3e0
    style M fill:#e8f5e9
    style O fill:#f3e5f5
```

### 2.4 Memory & CPU Budget Per Request

| Phase | CPU Time | Memory | Timeout |
|-------|----------|--------|---------|
| Rate limit check | 1ms | negligible | 1s |
| Job enqueue | 5ms | negligible | 2s |
| Planner (analyze) | 10-30s | 512MB | 2min |
| Planner (plan) | 15-60s | 512MB | 3min |
| Planner (todo) | 5-15s | 256MB | 1min |
| Builder (per task) | 30-120s | 1GB | 5min |
| Runner (deploy) | 20-60s | 512MB | 3min |
| **Total per request** | **2-8 min** | **~1GB peak** | **15min** |

For 100 concurrent requests:
- **Worst case:** 100 × 1GB = 100GB RAM (impossible on single EC2)
- **With queue:** Only 8-14 active at once, rest queued → **8-14GB RAM** (feasible)

---

## 5. Agent Execution Without Hallucination

### 3.1 The Hallucination Problem

LLMs hallucinate in predictable ways:

| Hallucination Type | Example | Impact |
|-------------------|---------|--------|
| **Phantom API** | `import fancylib` (doesn't exist) | Code won't run |
| **Wrong function** | `app.get()` instead of `app.get()` | Syntax error |
| **Logic error** | Off-by-one in loop | Runtime bug |
| **Duplicate code** | Two files define same component | Build conflict |
| **Stale knowledge** | Uses deprecated API | Warning or failure |
| **Missing import** | Uses `useState` without importing React | Compile error |
| **Wrong file path** | Writes to `src/comps/Button.tsx` vs `src/components/Button.tsx` | File not found |

### 3.2 Anti-Hallucination Architecture: 5-Layer Defense

```mermaid
flowchart TD
    A["Agent generates output"] --> B["Layer 1: Syntax Validation"]
    B -->|"Pass"| C["Layer 2: Import/Dependency Check"]
    B -->|"Fail"| Z["Reject + Re-generate"]
    C -->|"Pass"| D["Layer 3: Type Checking"]
    C -->|"Fail"| Z
    D -->|"Pass"| E["Layer 4: Sandbox Execution"]
    D -->|"Fail"| Z
    E -->|"Pass"| F["Layer 5: Visual Verification"]
    E -->|"Fail"| Z
    F -->|"Pass"| G["Output approved"]
    Z --> H["Feed error back to agent"]
    H --> A

    style G fill:#e8f5e9
    style Z fill:#ffebee
    style A fill:#e1f5fe
```

### 3.3 Layer 1: Syntax Validation

Every code output is syntax-checked before acceptance:

```python
# Brain/queues/workers/validation/syntax_check.py

import ast
import subprocess
import tempfile
import os

class SyntaxValidator:
    """Validates code syntax before accepting agent output."""

    def validate_python(self, code: str) -> dict:
        try:
            ast.parse(code)
            return {"valid": True, "error": None}
        except SyntaxError as e:
            return {"valid": False, "error": f"Line {e.lineno}: {e.msg}"}

    def validate_javascript(self, code: str, file_path: str) -> dict:
        with tempfile.NamedTemporaryFile(
            suffix=".js", mode="w", delete=False
        ) as f:
            f.write(code)
            f.flush()
            try:
                result = subprocess.run(
                    ["node", "--check", f.name],
                    capture_output=True, text=True, timeout=10
                )
                if result.returncode == 0:
                    return {"valid": True, "error": None}
                return {"valid": False, "error": result.stderr[:500]}
            finally:
                os.unlink(f.name)

    def validate_typescript(self, code: str, file_path: str) -> dict:
        with tempfile.NamedTemporaryFile(
            suffix=".ts", mode="w", delete=False
        ) as f:
            f.write(code)
            f.flush()
            try:
                result = subprocess.run(
                    ["npx", "tsc", "--noEmit", f.name],
                    capture_output=True, text=True, timeout=30
                )
                if result.returncode == 0:
                    return {"valid": True, "error": None}
                return {"valid": False, "error": result.stderr[:500]}
            finally:
                os.unlink(f.name)
```

### 3.4 Layer 2: Import & Dependency Check

Verifies all imports/references actually exist:

```python
# Brain/queues/workers/validation/import_check.py

import re
import os

class ImportValidator:
    """Checks that all imports/references exist in the project."""

    def __init__(self, workspace_path: str):
        self.workspace = workspace_path

    def validate_imports(self, file_path: str, content: str) -> dict:
        errors = []

        # Python: check import statements
        if file_path.endswith(".py"):
            imports = re.findall(
                r'(?:from|import)\s+([\w.]+)', content
            )
            for imp in imports:
                top_module = imp.split(".")[0]
                if top_module in ("os", "sys", "json", "re", "datetime",
                                   "typing", "asyncio", "uuid", "pathlib"):
                    continue  # stdlib
                if not self._module_exists(top_module):
                    errors.append(f"Module '{top_module}' not found")

        # TypeScript/JSX: check import statements
        if file_path.endswith((".ts", ".tsx", ".js", ".jsx")):
            imports = re.findall(
                r"from\s+['\"]([^'\"]+)['\"]", content
            )
            imports += re.findall(
                r"import\s+['\"]([^'\"]+)['\"]", content
            )
            for imp in imports:
                if imp.startswith("."):
                    # Relative import — check file exists
                    base_dir = os.path.dirname(file_path)
                    target = os.path.join(base_dir, imp)
                    if not os.path.exists(target) and \
                       not os.path.exists(target + ".ts") and \
                       not os.path.exists(target + ".tsx") and \
                       not os.path.exists(target + ".js"):
                        errors.append(f"Relative import '{imp}' not found")
                elif not imp.startswith("@") and "/" not in imp:
                    # NPM package — check node_modules
                    pkg_path = os.path.join(
                        self.workspace, "node_modules", imp
                    )
                    if not os.path.exists(pkg_path):
                        errors.append(f"Package '{imp}' not installed")

        return {"valid": len(errors) == 0, "errors": errors}

    def _module_exists(self, module: str) -> bool:
        try:
            __import__(module)
            return True
        except ImportError:
            return False
```

### 3.5 Layer 3: Type Checking (TypeScript Projects)

```python
# Brain/queues/workers/validation/type_check.py

import subprocess
import os

class TypeChecker:
    """Runs TypeScript type checking on workspace."""

    def check(self, workspace_path: str) -> dict:
        tsconfig = os.path.join(workspace_path, "tsconfig.json")
        if not os.path.exists(tsconfig):
            return {"valid": True, "error": None, "skipped": True}

        result = subprocess.run(
            ["npx", "tsc", "--noEmit"],
            cwd=workspace_path,
            capture_output=True,
            text=True,
            timeout=60
        )

        if result.returncode == 0:
            return {"valid": True, "error": None}

        # Parse errors
        errors = []
        for line in result.stdout.split("\n"):
            if "error TS" in line:
                errors.append(line.strip())

        return {
            "valid": False,
            "error": result.stdout[:2000],
            "error_count": len(errors),
            "errors": errors[:20]  # First 20 errors
        }
```

### 3.6 Layer 4: Sandbox Execution

**The most critical layer.** Every code output is actually run in an isolated sandbox:

```mermaid
flowchart TD
    A["Agent outputs code"] --> B["Write to sandbox workspace"]
    B --> C{"File type?"}
    C -->|".py"| D["Run: python file.py"]
    C -->|".ts/.tsx"| E["Run: npx tsc --noEmit"]
    C -->|".js/.jsx"| F["Run: node --check file.js"]
    C -->|"package.json"| G["Run: npm install && npm run build"]

    D --> H{"Exit code 0?"}
    E --> H
    F --> H
    G --> H

    H -->|"Yes"| I["Output APPROVED"]
    H -->|"No"| J["Capture stderr"]
    J --> K["Feed error to agent"]
    K --> L["Agent re-generates with error context"]
    L --> A

    style I fill:#e8f5e9
    style J fill:#ffebee
```

**Sandbox execution rules:**
- Every file write triggers a syntax/compile check
- After all tasks complete, run `npm install && npm run build` (for JS/TS)
- After all tasks complete, run `python -m py_compile` for Python files
- If build fails, the builder agent gets the error and must fix it
- Maximum 3 retry attempts per task before marking as failed

### 3.7 Layer 5: Visual Verification (Future)

For UI components, render in sandbox and compare against expected output:
- Take screenshot of rendered component
- Compare dimensions, colors, layout against design spec
- Flag visual regressions

---

## 6. Request Lifecycle Under Load

### 4.1 Timeline: 100 Concurrent Build Requests

```mermaid
gantt
    title 100 Concurrent Build Requests Timeline
    dateFormat X
    axisFormat %s

    section Queue
    Requests 1-10 (planning)     :a1, 0, 30
    Requests 11-30 (planning)    :a2, 10, 40
    Requests 31-60 (queued)      :a3, 20, 50
    Requests 61-100 (queued)     :a4, 30, 60

    section Planning (4 workers)
    Batch 1 plan                 :b1, 0, 30
    Batch 2 plan                 :b2, 15, 45
    Batch 3 plan                 :b3, 30, 60
    Batch 4 plan                 :b4, 45, 75

    section Building (8 workers)
    Batch 1 build (tasks 1-5)    :c1, 30, 90
    Batch 2 build (tasks 6-10)   :c2, 45, 105
    Batch 3 build (tasks 11-15)  :c3, 60, 120
    Batch 4 build (tasks 16-20)  :c4, 75, 135

    section Deploy (2 workers)
    Batch 1 deploy               :d1, 90, 120
    Batch 2 deploy               :d2, 105, 135
    Batch 3 deploy               :d3, 120, 150
    Batch 4 deploy               :d4, 135, 165
```

### 4.2 Throughput Calculations

| Metric | Value |
|--------|-------|
| Planner throughput | ~3-4 requests/min per worker |
| Builder throughput | ~1-2 tasks/min per worker |
| Runner throughput | ~2-3 deploys/min per worker |
| **System throughput (14 workers)** | **~20-30 full builds/min** |
| **Time to process 100 requests** | **~3-5 minutes** |
| **P95 latency per request** | **~4-8 minutes** |

### 4.3 Priority Under Load

When 100 requests compete:

1. **Critical (stop signals)** — processed immediately, preempt other work
2. **High (planning)** — 4 workers dedicated, max 2min per job
3. **Normal (building)** — 8 workers, max 5min per task
4. **Low (deploy)** — 2 workers, max 3min per job
5. **Background (title gen, memory)** — runs when workers idle

---

## 7. Agent Validation Pipeline

### 5.1 Builder Agent Validation Flow

```mermaid
flowchart TD
    A["BuilderAgent receives task"] --> B["LLM generates code"]
    B --> C["Layer 1: Syntax check"]
    C -->|"Fail"| D["Re-prompt with syntax error"]
    D --> B
    C -->|"Pass"| E["Layer 2: Import check"]
    E -->|"Fail"| F["Re-prompt with missing imports"]
    F --> B
    E -->|"Pass"| G["Layer 3: Write file to workspace"]
    G --> H["Layer 4: Sandbox compile"]
    H -->|"Fail"| I["Capture error output"]
    I --> J{"Retry < 3?"}
    J -->|"Yes"| K["Feed error context to LLM"]
    K --> B
    J -->|"No"| L["Mark task FAILED"]
    H -->|"Pass"| M["Task APPROVED"]
    M --> N["Proceed to next task"]

    style M fill:#e8f5e9
    style L fill:#ffebee
    style D fill:#fff3e0
    style F fill:#fff3e0
    style K fill:#fff3e0
```

### 5.2 LLM Re-Prompting Strategy

When validation fails, the agent gets structured error context:

```python
# Template for re-prompting after validation failure

RETRY_PROMPT = """
The code you generated failed validation. Fix the error below.

## Failed File
{file_path}

## Error Type
{error_type}

## Error Message
{error_message}

## Current Code
```{lang}
{current_code}
```

## Instructions
1. Fix ONLY the error mentioned above
2. Do NOT change working parts of the code
3. Ensure all imports exist in the project
4. Ensure the file compiles/runs without errors

## Project Context
{project_context}
"""
```

### 5.3 Planner Agent Validation

The planner doesn't generate code, but its plans must be valid:

| Check | How | Fail Action |
|-------|-----|-------------|
| Task dependencies are acyclic | Topological sort | Re-generate plan |
| All referenced files exist | Filesystem check | Remove invalid tasks |
| Framework matches project | Config check | Adjust task types |
| No duplicate tasks | Set dedup | Merge duplicates |
| Task count reasonable (1-50) | Count check | Split or merge |

### 5.4 Runner Agent Validation

| Check | How | Fail Action |
|-------|-----|-------------|
| `package.json` exists | Filesystem | Skip npm install |
| `npm install` succeeds | Shell exec | Log error, continue |
| `npm run build` succeeds | Shell exec | Report build failure |
| Dev server starts | Port check | Report startup failure |
| Preview URL accessible | HTTP check | Report URL issue |

---

## 8. Sandbox-as-Proof Architecture

### 6.1 Principle: "If it doesn't run, it doesn't exist"

Every agent output is treated as **unverified** until it passes sandbox execution:

```mermaid
flowchart LR
    A["Agent Output"] -->|"Unverified"| B{"Sandbox Test"}
    B -->|"Pass"| C["Verified Code"]
    B -->|"Fail"| D["Rejected Code"]

    C --> E["Saved to workspace"]
    D --> F["Error fed back to agent"]

    E --> G["Available to user"]
    F --> H["Agent retries"]

    style C fill:#e8f5fe
    style D fill:#ffebee
```

### 6.2 Sandbox Execution Rules

| Rule | Implementation |
|------|---------------|
| **No trust** | Agent code is never trusted without execution |
| **Isolated** | Each workspace is isolated (separate directory) |
| **Timeout** | Max 30s per file check, 60s per build |
| **Resource limits** | CPU: 2 cores, RAM: 2GB per sandbox |
| **No network** | Sandboxes don't access external APIs during validation |
| **Clean state** | Fresh `node_modules` for each build (or cached) |

### 6.3 Error Feedback Loop

When sandbox execution fails:

```python
class ErrorFeedbackLoop:
    """Captures sandbox errors and formats them for LLM re-prompting."""

    def capture_error(self, error_output: str, file_path: str) -> dict:
        # Parse error type
        if "SyntaxError" in error_output:
            error_type = "syntax"
        elif "ModuleNotFoundError" in error_output:
            error_type = "missing_import"
        elif "TypeError" in error_output:
            error_type = "type_error"
        elif "is not defined" in error_output:
            error_type = "undefined_reference"
        else:
            error_type = "runtime_error"

        # Extract line number if possible
        line_match = re.search(r'line (\d+)', error_output)
        line_number = int(line_match.group(1)) if line_match else None

        return {
            "file": file_path,
            "error_type": error_type,
            "error_message": error_output[:500],
            "line_number": line_number,
            "suggestion": self._suggest_fix(error_type, error_output),
        }

    def _suggest_fix(self, error_type: str, error: str) -> str:
        suggestions = {
            "syntax": "Check for missing colons, brackets, or quotes",
            "missing_import": "Add the missing import statement",
            "type_error": "Check argument types match function signature",
            "undefined_reference": "Check spelling and ensure variable is defined",
            "runtime_error": "Review the error message for logic issues",
        }
        return suggestions.get(error_type, "Review the code carefully")
```

---

## 9. Rate Limiting & Fairness

### 7.1 Per-User Rate Limits

| Tier | Requests/min | Concurrent Jobs | Build Tasks |
|------|-------------|-----------------|-------------|
| Free | 5 | 1 | 10 |
| Pro | 20 | 3 | 50 |
| Enterprise | 100 | 10 | 200 |

### 7.2 Rate Limit Implementation

```python
# Brain/queues/rate_limiter.py

from Brain.config.redis import redis_client

class RateLimiter:
    """Token bucket rate limiter using Redis."""

    async def check_rate_limit(
        self, user_id: str, tier: str = "free"
    ) -> dict:
        limits = {
            "free": {"rpm": 5, "concurrent": 1, "tasks": 10},
            "pro": {"rpm": 20, "concurrent": 3, "tasks": 50},
            "enterprise": {"rpm": 100, "concurrent": 10, "tasks": 200},
        }
        limit = limits.get(tier, limits["free"])

        # Check requests per minute
        rpm_key = f"rate:{user_id}:rpm"
        current = await redis_client.incr(rpm_key)
        if current == 1:
            await redis_client.expire(rpm_key, 60)

        if current > limit["rpm"]:
            return {
                "allowed": False,
                "reason": "Rate limit exceeded",
                "retry_after": 60,
            }

        # Check concurrent jobs
        concurrent_key = f"rate:{user_id}:concurrent"
        concurrent = int(await redis_client.get(concurrent_key) or 0)
        if concurrent >= limit["concurrent"]:
            return {
                "allowed": False,
                "reason": "Too many concurrent jobs",
                "retry_after": 30,
            }

        return {"allowed": True}
```

### 7.3 Fairness: No Starvation

When 100 requests compete, ensure no request waits forever:

| Mechanism | Description |
|-----------|-------------|
| **Priority queue** | Planning > Building > Deploy > Background |
| **Aging** | Jobs waiting > 5min get priority boost |
| **Per-user cap** | Max 3 concurrent jobs per user |
| **Preemption** | Stop signals (priority=critical) preempt others |
| **Timeout** | Jobs stuck > 15min are failed and retried |

---

## 10. Memory & Context Isolation

### 8.1 Per-Request Isolation

Each concurrent request must have isolated:

| Resource | Isolation Method |
|----------|-----------------|
| **Conversation state** | Separate conversation_id in DB |
| **Workspace files** | Separate directory per conversation |
| **Memory context** | Separate MemoryGateway per session |
| **Sandbox** | Separate Docker container or directory |
| **Redis state** | Separate keys per job_id |

### 8.2 No Cross-Contamination

```mermaid
flowchart TD
    subgraph "User A Request"
        A1["Conversation A"]
        A2["Workspace /workspaces/A/"]
        A3["MemoryGateway A"]
        A4["Sandbox A"]
    end

    subgraph "User B Request"
        B1["Conversation B"]
        B2["Workspace /workspaces/B/"]
        B3["MemoryGateway B"]
        B4["Sandbox B"]
    end

    A1 -.->|"NEVER"| B2
    A3 -.->|"NEVER"| B3
    B1 -.->|"NEVER"| A2
    B3 -.->|"NEVER"| A3

    style A1 fill:#e1f5fe
    style B1 fill:#fff3e0
```

### 8.3 Context Window Management

Each agent call uses a fresh context:

| Agent | Context Source | Max Tokens |
|-------|---------------|------------|
| ManagerAgent | User message + conversation history | 4K |
| QuestionsAgent | Manager analysis + user history | 2K |
| PlannerAgent | Manager analysis + project context | 8K |
| TodoAgent | Planner output | 4K |
| BuilderAgent | Task description + file context | 16K |
| RunnerAgent | Build output + workspace state | 4K |

**Rule:** Agent context never includes other users' data.

---

## 11. Monitoring Under Load

### 9.1 Key Metrics at 100 Concurrent

| Metric | Healthy | Warning | Critical |
|--------|---------|---------|----------|
| Queue depth (high) | < 20 | 20-50 | > 50 |
| Queue depth (normal) | < 100 | 100-200 | > 200 |
| Worker CPU | < 60% | 60-80% | > 80% |
| Worker memory | < 70% | 70-85% | > 85% |
| Job latency (P95) | < 5min | 5-10min | > 10min |
| Sandbox failures | < 5% | 5-15% | > 15% |
| Redis memory | < 50% | 50-75% | > 75% |

### 9.2 Auto-Scaling Triggers

```mermaid
flowchart TD
    A["Monitor queue depth"] --> B{"depth > threshold?"}
    B -->|"Yes"| C["Scale up workers"]
    B -->|"No"| D{"depth < min_threshold?"}
    D -->|"Yes"| E["Scale down workers"]
    D -->|"No"| F["Maintain current"]

    C --> G["docker compose up -d --scale builder-worker=N+2"]
    E --> H["docker compose up -d --scale builder-worker=N-1"]

    style C fill:#fff3e0
    style E fill:#e8f5e9
```

---

## 12. Implementation Checklist

### Anti-Hallucination Pipeline

- [ ] Create `Brain/queues/workers/validation/` module
- [ ] Implement `SyntaxValidator` (Python, JS, TS)
- [ ] Implement `ImportValidator` (check imports exist)
- [ ] Implement `TypeChecker` (TypeScript noEmit)
- [ ] Implement `SandboxExecutor` (run code in isolation)
- [ ] Implement `ErrorFeedbackLoop` (format errors for LLM)
- [ ] Integrate validation into `BuilderWorker.process()`
- [ ] Add retry logic (max 3 attempts per task)
- [ ] Add validation metrics (pass/fail rates per layer)

### Concurrent Request Handling

- [ ] Implement `RateLimiter` in `Brain/queues/rate_limiter.py`
- [ ] Add rate limit check to `/brain/chat/submit` endpoint
- [ ] Implement job aging (priority boost for old jobs)
- [ ] Add per-user concurrent job cap
- [ ] Test with 100 concurrent requests (Locust/k6)
- [ ] Monitor queue depths and worker utilization
- [ ] Tune worker concurrency based on load test results

### Context Isolation

- [ ] Verify workspace isolation per conversation
- [ ] Verify MemoryGateway isolation per session
- [ ] Verify no cross-user data in agent context
- [ ] Add context size limits per agent type

### Request Tracking & Ownership

- [ ] Create `brain_jobs` table with `user_id` + `conversation_id` columns
- [ ] Create `brain_tasks` table with `conversation_id` + `agent` columns
- [ ] Create `brain_files` table with `task_id` + `conversation_id` columns
- [ ] Ensure `BrainState` always carries `user_id` + `conversation_id`
- [ ] Verify workspace path includes `conversation_id`
- [ ] Add Redis keys: `conv:{id}:active_job`, `rate:{user}:rpm`, `rate:{user}:concurrent`
- [ ] Test: 3 users simultaneous → verify no cross-contamination
- [ ] Test: query "whose job is this?" returns correct user_id

### Multi-User Request Handling

- [ ] Implement JWT auth middleware (extract `user_id` + `user_tier`)
- [ ] Implement `POST /brain/chat/submit` endpoint with rate limiting
- [ ] Implement SSE proxy per conversation (`/brain/stream/{conv_id}`)
- [ ] Add workspace security check (user can only access own workspace)
- [ ] Add file path validation (no path traversal outside workspace)
- [ ] Add job ownership validation (user can only query own jobs)
- [ ] Test: 5 users simultaneous → verify isolated workspaces
- [ ] Test: User A fails → User B unaffected
- [ ] Test: User A clicks Stop → only User A's build stops

---

*This document defines how Grizon AI handles concurrent load and ensures agent outputs are verified, not hallucinated. Every code output passes through 5 validation layers before reaching the user.*
