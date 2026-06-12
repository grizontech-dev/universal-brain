# Orchestration Engine — Deep Implementation Spec

> **Version:** 1.0  
> **Purpose:** Production-grade orchestration engine design for the AI OS runtime kernel.  
> **Status:** Complete implementation specification with code examples, architecture diagrams, and deployment guidance.

---

## Table of Contents

1. [Role of the Orchestration Engine](#1-role-of-the-orchestration-engine)
2. [Architecture Overview](#2-architecture-overview)
3. [Core Subsystems](#3-core-subsystems)
   - 3.1 [Global State Management](#31-global-state-management)
   - 3.2 [Task Dependency Graph (DAG)](#32-task-dependency-graph-dag)
   - 3.3 [Self-Healing Loop](#33-self-healing-loop)
   - 3.4 [Intelligent Retry Logic](#34-intelligent-retry-logic)
   - 3.5 [Failure Escalation System](#35-failure-escalation-system)
4. [Execution Pipeline](#4-execution-pipeline)
5. [Orchestrator Control Loop](#5-orchestrator-control-loop)
6. [Integration with BAMAS](#6-integration-with-bamas)
7. [Safety Enforcement](#7-safety-enforcement)
8. [Common Failure Cases](#8-common-failure-cases)
9. [Security & Threat Model](#9-security--threat-model)
10. [Production Readiness Gaps](#10-production-readiness-gaps)
11. [Recommended Technology Stack](#11-recommended-technology-stack)
12. [LangGraph Integration Guide](#12-langgraph-integration-guide)
13. [Appendices](#13-appendices)

---

## 1. Role of the Orchestration Engine

The Orchestration Engine is the **runtime kernel** of the AI OS. It is responsible for:

- **Coordinating all agents:** Managing the lifecycle and execution order of every agent in the system.
- **Maintaining system state:** Ensuring a consistent, recoverable view of all ongoing work.
- **Enforcing execution rules:** Applying guardrails, permissions, and validation at every step.
- **Handling failures and retries:** Implementing self-healing, intelligent retry, and escalation strategies.
- **Ensuring deterministic workflow execution:** Converting non-deterministic AI outputs into reliable, repeatable processes.

> **Core Principle:** Convert AI from a "random generator" into a "reliable system" through deterministic workflow control.

The Orchestration Engine operates as the central nervous system of the AI OS. Without it, agents would act independently without coordination, state would become inconsistent, failures would cascade unchecked, and the entire system would degrade into chaos. The engine ensures that even when individual components fail, the overall system remains stable and recoverable.

**Key Responsibilities in Detail:**

1. **Agent Lifecycle Management:** Spawn, monitor, pause, resume, and terminate agents as workflow demands.
2. **State Consistency:** Ensure that all agents observe a consistent view of the global state, preventing split-brain scenarios.
3. **Rule Enforcement:** Validate that agents only access authorized tools, stay within action boundaries, and respect budget limits.
4. **Failure Recovery:** When an agent fails, the engine decides whether to retry, heal, escalate, or abort — never leaving the system in an undefined state.
5. **Determinism:** Given the same inputs and state, the engine must produce the same execution trace (modulo non-deterministic AI outputs which are contained and validated).

---

## 2. Architecture Overview

```mermaid
graph TB
    subgraph Frontend["Frontend Layer"]
        UI[User Interface / CLI / API]
    end
    
    subgraph APIServer["API Server"]
        API[Auth, Rate Limiting, Routing]
    end
    
    subgraph Orchestrator["Orchestrator Engine"]
        DAG[DAG Engine]
        State[State Manager]
        Retry[Retry Logic]
        Escalation[Escalation System]
        ControlLoop[Control Loop]
    end
    
    subgraph LiveState["Live State"]
        Redis[Redis<br/>• Pub/Sub<br/>• Locks<br/>• Caching]
    end
    
    subgraph TaskQueue["Task Queue"]
        BullMQ[BullMQ<br/>• Scheduling<br/>• Retries<br/>• Priorities]
    end
    
    subgraph PersistentDB["Persistent DB"]
        Postgres[PostgreSQL<br/>• Projects<br/>• History<br/>• DAG Structure]
    end
    
    subgraph LangGraph["LangGraph DAG"]
        Node1[Research] --> Node2[Design]
        Node2 --> Node3[Code]
        Node1 -.->|fanout| Node4[Test]
        Node3 -.-> Node4
    end
    
    subgraph AgentLayer["Agent Layer"]
        Research[Research Analyst]
        Design[Design Expert]
        Code[Code Architect]
        Test[Test Engineer]
    end
    
    subgraph Sandbox["Sandbox / MCP Layer"]
        MicroVM[Isolated microVM<br/>File isolation<br/>Network restrictions<br/>Resource limits]
    end
    
    subgraph QCLayer["Output & QC Layer"]
        QC[Validation, Fact-Checking, Approval]
    end
    
    UI --> API
    API --> ControlLoop
    ControlLoop --> DAG
    DAG --> State
    ControlLoop --> Retry
    ControlLoop --> Escalation
    
    ControlLoop --> Redis
    ControlLoop --> BullMQ
    ControlLoop --> Postgres
    
    ControlLoop --> LangGraph
    LangGraph --> Research
    LangGraph --> Design
    LangGraph --> Code
    LangGraph --> Test
    
    Research --> MicroVM
    Design --> MicroVM
    Code --> MicroVM
    Test --> MicroVM
    
    MicroVM --> QC
    QC --> UI
    
    classDef frontend fill:#e1f5fe
    classDef api fill:#f3e5f5
    classDef orchestrator fill:#e8f5e8
    classDef state fill:#fff3e0
    classDef agents fill:#fce4ec
    classDef sandbox fill:#ffebee
    classDef qc fill:#e0f2f1
```

**Data Flow:**

```mermaid
sequenceDiagram
    participant U as User
    participant L as Leader Agent
    participant O as Orchestrator
    participant G as LangGraph
    participant A as Agent
    participant S as Sandbox
    participant V as Validator
    
    U->>L: Request
    L->>O: PRD + Task Plan
    O->>G: Build/Validate DAG
    G->>A: Dispatch via BullMQ
    A->>S: Execute in microVM
    S->>V: Raw output
    V->>O: Validated result
    O->>G: Trigger next nodes
    G->>U: Final delivery
```

```text
User Request
  ↓
Leader Agent creates PRD + Task Plan
  ↓
Orchestrator validates plan + builds DAG
  ↓
LangGraph executes DAG nodes
  ↓
Each node dispatches to Agent via BullMQ
  ↓
Agent executes in Sandbox
  ↓
Output validated + state updated
  ↓
Next nodes triggered
  ↓
Final output delivered to user
```

---

## 3. Core Subsystems

### 3.1 Global State Management

#### 3.1.1 Purpose

Maintain a **single source of truth** across all agents, tasks, and sessions. The state must be:
- **Fast:** Sub-millisecond reads for active execution
- **Durable:** Survive crashes and restarts
- **Consistent:** All agents see the same data
- **Observable:** Full audit trail of changes

#### 3.1.2 Data Model

```json
{
  "project_id": "P123",
  "user_id": "U456",
  "status": "running",
  "created_at": "2024-01-15T10:00:00Z",
  "updated_at": "2024-01-15T10:30:00Z",
  "tasks": [
    {
      "task_id": "T1",
      "agent": "Research Analyst",
      "status": "completed",
      "output": "...",
      "depends_on": [],
      "retry_count": 0,
      "checkpoint_id": "cp_001"
    }
  ],
  "budget": {
    "allocated": 10000,
    lock_key = f"lock:{task_id}"
    lock_acquired = redis.set(lock_key, "locked", nx=True, ex=30)

    if not lock_acquired:
        raise ConcurrencyError(f"Task {task_id} is already locked")

    try:
        result = agent_fn()
        validate_output(result)
        update_state(task_id, result)
        return result
    finally:
        redis.delete(lock_key)
```

**Optimistic Concurrency:**

```json
{
  "task_id": "T3",
  "version": 5,
  "status": "running"
}
```

Update only if version matches:
```sql
UPDATE tasks SET status = 'completed', version = 6
WHERE task_id = 'T3' AND version = 5;
```

#### 3.1.7 Idempotency

**Problem:** Retrying a task causes duplicate side effects (API called twice, DB written twice).

**Solution: Idempotency Keys**

```json
{
  "task_id": "T3",
  "execution_id": "550e8400-e29b-41d4-a716-446655440000",
  "idempotency_key": "task_T3_attempt_2"
}
```

**Implementation:**

```python
def execute_task(task):
    key = task["idempotency_key"]

    if redis.get(f"idempotency:{key}"):
        return get_cached_result(key)

    result = run_agent(task)
    redis.setex(f"idempotency:{key}", 86400, "done")
    store_result(key, result)
    return result
```

#### 3.1.8 Checkpointing & Recovery

**Problem:** System crash mid-execution loses all progress.

**Solution:** Checkpoint after every task completion.

```json
{
  "checkpoint_id": "cp_007",
  "project_id": "P123",
  "last_completed_task": "T3",
  "remaining_tasks": ["T4", "T5"],
  "state_snapshot": { ... },
  "timestamp": "2024-01-15T10:05:00Z"
}
```

**Recovery Flow:**

```text
System Restart
  ↓
Load last checkpoint from PostgreSQL
  ↓
Restore state to Redis
  ↓
Resume from next pending task
```

**Checkpoint Triggers:**
- After every task completion
- Before expensive operations
- On graceful shutdown signal
- Every N minutes (configurable)

---

### 3.2 Task Dependency Graph (DAG)

#### 3.2.1 Purpose

Control **which task runs**, **when it runs**, and **what it depends on** using a Directed Acyclic Graph.

#### 3.2.2 Technology Selection

| Tool | Best For | Complexity | Recommendation |
|------|----------|------------|----------------|
| **LangGraph** | AI agents, LLM integration, stateful DAG | Medium | **PRIMARY** |
| Temporal | Long-running workflows, durability | High | Alternative |
| Apache Airflow | Batch ETL, scheduled jobs | Medium | NOT for real-time AI |
| Custom | Full control | Very High | NOT recommended |

#### 3.2.3 DAG Structure

**Example: Build SaaS App**

```mermaid
graph LR
    T1[Research T1] --> T2[Design T2]
    T1 --> T3[Code T3]
    T2 --> T4[Frontend T4]
    T3 --> T4
    T4 --> T5[Testing T5]
    
    classDef research fill:#e3f2fd
    classDef design fill:#f3e5f5
    classDef code fill:#e8f5e8
    classDef frontend fill:#fff3e0
    classDef testing fill:#fce4ec
    
    class T1 research
    class T2,T4 design
    class T3 code
    class T5 testing
```

#### 3.2.4 Task Object Schema

```json
{
  "task_id": "T3",
  "agent": "Code Architect",
  "agent_type": "code_generation",
  "depends_on": ["T1", "T2"],
  "status": "pending",
  "priority": "high",
  "retry_count": 0,
  "max_retries": 5,
  "timeout_seconds": 60,
  "output": null,
  "error": null,
  "metadata": {
    "model": "qwen-coder",
    "temperature": 0.2,
    "budget_limit": 500
  }
}
```

#### 3.2.5 Execution Logic

```python
def get_runnable_tasks(dag):
    runnable = []
    for task in dag.tasks:
        if task.status != "pending":
            continue
        deps = task.depends_on
        if all(dag.get_task(d).status == "completed" for d in deps):
            runnable.append(task)
    return runnable

def execute_dag(dag):
    while dag.has_pending_tasks():
        runnable = get_runnable_tasks(dag)

        if not runnable:
            if dag.has_failed_tasks():
                raise DependencyError("DAG has unresolvable failures")
            break

        # Execute independent tasks in parallel
        with ThreadPoolExecutor() as executor:
            futures = [executor.submit(execute_task, t) for t in runnable]
            for future in as_completed(futures):
                result = future.result()
                update_task_state(result)
```

#### 3.2.6 Parallel Execution Rules

**Allowed:** Tasks with no shared dependencies run simultaneously.

```text
T1 → T2 + T3 (parallel) → T4 → T5
```

**Not Allowed:** Task starts before all dependencies complete.

```text
T5 MUST wait for T3 AND T4
```

**Fan-Out / Fan-In Pattern:**

```text
       ┌→ T2 ─┐
  T1 ──┤      ├──→ T5
       └→ T3 ─┘
       └→ T4 ─┘
```

#### 3.2.7 Event-Driven Execution

**Event Types:**

```text
TASK_CREATED    → task enters pending state
TASK_STARTED    → agent begins execution
TASK_COMPLETED  → output validated, state updated
TASK_FAILED     → error recorded, retry or escalate
TASK_CANCELLED  → aborted by user or system
```

**Event Flow:**

```text
T1 completed
  ↓
Event Bus publishes TASK_COMPLETED
  ↓
Orchestrator checks dependents:
  T2 depends on T1 → READY
  T3 depends on T1 → READY
  ↓
Publishes TASK_STARTED for T2 and T3
  ↓
Agents pick up tasks from queue
```

**Implementation with Redis Pub/Sub:**

```python
def on_task_completed(task_id):
    task = db.get_task(task_id)
    dependents = db.get_dependents(task_id)

    for dep in dependents:
        if all_dependencies_completed(dep):
            redis.publish("task_queue", json.dumps({
                "event": "TASK_STARTED",
                "task_id": dep.task_id
            }))
```

#### 3.2.8 Dynamic DAG Modification

**Problem:** Fixed plans cannot adapt to new information discovered during execution.

**Solution:** Inject new tasks mid-run.

```text
IF research reveals new requirement:
  → inject new task into DAG
  → update dependencies
  → continue execution
```

**Implementation:**

```python
def inject_task(dag, new_task, after_task_id):
    """Insert new_task after after_task_id completes."""
    new_task.depends_on = [after_task_id]
    dag.add_node(new_task)

    # Update downstream tasks that depended on after_task_id
    for task in dag.tasks:
        if after_task_id in task.depends_on:
            task.depends_on.append(new_task.task_id)

    dag.validate()  # Ensure no cycles introduced
```

#### 3.2.9 DAG Validation Rules

1. **Acyclic:** No circular dependencies
2. **Reachable:** All tasks reachable from entry point
3. **Deterministic:** Same input always produces same DAG
4. **Immutable after approval:** Only orchestrator can modify post-approval

**Cycle Detection:**

```python
def has_cycle(dag):
    visited = set()
    rec_stack = set()

    def dfs(node):
        visited.add(node)
        rec_stack.add(node)

        for neighbor in dag.get_dependencies(node):
            if neighbor not in visited:
                if dfs(neighbor):
                    return True
            elif neighbor in rec_stack:
                return True

        rec_stack.remove(node)
        return False

    return any(dfs(node) for node in dag.nodes if node not in visited)
```

---

### 3.3 Self-Healing Loop Handling

#### 3.3.1 Definition

> **Self-Healing:** Automatically detect failure → understand error → fix → retry → repeat until success or escalation.

#### 3.3.2 Example Flow

```text
Agent generates code
  ↓
Sandbox runs code
  ↓
Error occurs (SyntaxError)
  ↓
System captures stderr
  ↓
Fix Agent receives code + error
  ↓
Fix Agent produces corrected code
  ↓
Sandbox runs corrected code
  ↓
Success → continue workflow
```

#### 3.3.3 Core Components

| Component | Input | Output | Responsibility |
|-----------|-------|--------|----------------|
| Execution Layer (Sandbox) | Code to run | stdout, stderr, exit_code | Safe code execution |
| Error Analyzer | stderr | Error classification | Categorize: syntax, runtime, logic |
| Fix Agent (Debugger) | Code + Error + Context | Fixed code | Generate corrected solution |
| Loop Controller | Execution results | Next action | Manage retries, decide escalate |

#### 3.3.4 Error Classification

| Type | Example | Severity | Auto-Fixable |
|------|---------|----------|--------------|
| Syntax | `SyntaxError: unexpected EOF` | Low | Yes |
| Runtime | `ZeroDivisionError`, `IndexError` | Medium | Yes |
| Import | `ModuleNotFoundError` | Medium | Sometimes |
| Type | `TypeError: unsupported operand` | Medium | Yes |
| Logic | Output does not match spec | High | Partially |
| Timeout | Execution exceeded time limit | High | No (requires redesign) |

#### 3.3.5 Loop Controller Implementation

```python
MAX_RETRIES = 5
TIMEOUT_SECONDS = 30

def self_healing_loop(task):
    """
    Execute task with automatic error correction.
    Returns: (success: bool, result: dict, metadata: dict)
    """
    code = task.get_initial_code()
    error_history = []
    fix_history = []

    for attempt in range(1, MAX_RETRIES + 1):
        # Execute in sandbox
        result = sandbox.execute(
            code=code,
            timeout=TIMEOUT_SECONDS,
            memory_limit="512MB"
        )

        # Success path
        if result["exit_code"] == 0:
            return {
                "success": True,
                "result": result,
                "metadata": {
                    "attempts": attempt,
                    "error_history": error_history,
                    "fix_history": fix_history
                }
            }

        # Failure path
        error = result["stderr"]
        error_type = classify_error(error)
        error_history.append({
            "attempt": attempt,
            "error": error,
            "type": error_type,
            "stdout": result["stdout"]
        })

        # Attempt fix
        code = fix_agent.correct(
            original_code=task.get_initial_code(),
            current_code=code,
            error=error,
            error_type=error_type,
            attempt=attempt,
            previous_errors=error_history,
            previous_fixes=fix_history
        )

        fix_history.append({
            "attempt": attempt,
            "code_diff": diff(task.get_initial_code(), code),
            "strategy": get_strategy(attempt, error_type)
        })

        # Log healing attempt
        log_healing_attempt(task.task_id, attempt, error_type)

    # All retries exhausted
    return {
        "success": False,
        "result": None,
        "metadata": {
            "attempts": MAX_RETRIES,
            "error_history": error_history,
            "fix_history": fix_history,
            "final_error": error
        }
    }
```

#### 3.3.6 Fix Agent Prompt

```text
You are an expert debugger. Fix the following code based on the error.

ORIGINAL CODE:
{original_code}

CURRENT CODE:
{current_code}

ERROR (Attempt {attempt}):
{error}

ERROR TYPE: {error_type}

PREVIOUS ERRORS:
{previous_errors}

PREVIOUS FIXES APPLIED:
{previous_fixes}

INSTRUCTIONS:
1. Identify the root cause
2. Provide the minimal fix
3. Do not change functionality unrelated to the error
4. Return ONLY the corrected code, no explanations

FIXED CODE:
```

#### 3.3.7 Progressive Fix Strategy

| Attempt | Strategy | Model | Context |
|---------|----------|-------|---------|
| 1 | Simple fix (syntax, obvious error) | Cheap (Qwen) | Current error only |
| 2 | Deeper analysis (add types, checks) | Cheap (Qwen) | Error + stdout |
| 3 | Rewrite logic section | Better (DeepSeek) | All previous errors |
| 4 | Change approach entirely | Best (GPT-4) | Full history + spec |
| 5 | Escalate to supervisor | — | Full context |

#### 3.3.8 Safety Controls

```python
SAFETY_LIMITS = {
    "max_retries": 5,
    "timeout_seconds": 30,
    "max_execution_time_total": 300,  # 5 minutes total per task
    "max_token_cost_per_task": 2000,
    "forbidden_patterns": [
        "rm -rf", "format", "drop table", "delete from"
    ]
}

def validate_safety(code):
    for pattern in SAFETY_LIMITS["forbidden_patterns"]:
        if pattern in code.lower():
            raise SecurityError(f"Forbidden pattern detected: {pattern}")
```

#### 3.3.9 State Tracking During Healing

```json
{
  "task_id": "T3",
  "healing_session": "hs_001",
  "attempt": 3,
  "status": "healing",
  "errors": [
    {"attempt": 1, "type": "SyntaxError", "message": "..."},
    {"attempt": 2, "type": "RuntimeError", "message": "..."}
  ],
  "fixes": [
    {"attempt": 1, "strategy": "syntax_fix", "lines_changed": 2},
    {"attempt": 2, "strategy": "null_check", "lines_changed": 5}
  ],
  "models_used": ["qwen", "qwen", "deepseek"],
  "tokens_consumed": 850,
  "started_at": "2024-01-15T10:00:00Z"
}
```

#### 3.3.10 LangGraph Integration

```python
from langgraph.graph import StateGraph

class HealingState(TypedDict):
    code: str
    error: Optional[str]
    attempt: int
    success: bool

def execute_node(state):
    result = sandbox.run(state["code"])
    return {
        "error": result["stderr"] if result["exit_code"] != 0 else None,
        "success": result["exit_code"] == 0
    }

def fix_node(state):
    if state["error"] is None:
        return state
    fixed = fix_agent.correct(state["code"], state["error"])
    return {"code": fixed, "attempt": state["attempt"] + 1}

def route_healing(state):
    if state["success"]:
        return "complete"
    if state["attempt"] >= MAX_RETRIES:
        return "escalate"
    return "fix"

graph = StateGraph(HealingState)
graph.add_node("execute", execute_node)
graph.add_node("fix", fix_node)
graph.add_conditional_edges("execute", route_healing, {
    "complete": END,
    "fix": "fix",
    "escalate": "escalate_node"
})
graph.add_edge("fix", "execute")
graph.set_entry_point("execute")
```

---

### 3.4 Intelligent Retry Logic

#### 3.4.1 Definition

> **Intelligent Retry:** Adaptive retry system that changes strategy on each failure instead of blindly repeating the same action.

#### 3.4.2 Retry State Object

```json
{
  "task_id": "T3",
  "attempt": 2,
  "error_type": "runtime",
  "last_error": "division by zero",
  "strategy": "logic_fix",
  "model_used": "qwen-14b",
  "model_tier": "cheap",
  "max_retries": 5,
  "base_delay_ms": 1000,
  "tokens_used": 450,
  "budget_remaining": 9550,
  "context_injected": true
}
```

#### 3.4.3 Attempt-Based Strategy Progression

| Attempt | Action | Model Tier | Delay | Context |
|---------|--------|------------|-------|---------|
| 1 | Retry same with minor fix | Cheap | 1s | Current error |
| 2 | Add error context + stdout | Cheap | 2s | Error + logs |
| 3 | Change prompt / constraints | Medium | 4s | All errors + spec |
| 4 | Switch to better model | Best | 8s | Full history |
| 5 | Escalate to supervisor | — | — | Complete dump |

#### 3.4.4 Error-Based Strategy

```python
ERROR_STRATEGIES = {
    "syntax": {
        "fixable": True,
        "model_tier": "cheap",
        "prompt_addon": "Check brackets, quotes, colons, and indentation."
    },
    "runtime": {
        "fixable": True,
        "model_tier": "medium",
        "prompt_addon": "Add null checks, boundary checks, and type validation."
    },
    "timeout": {
        "fixable": False,
        "model_tier": "best",
        "prompt_addon": "Optimize algorithm complexity. Reduce iterations."
    },
    "api_error": {
        "fixable": True,
        "model_tier": "medium",
        "prompt_addon": "Check API endpoint, parameters, and retry with fallback."
    },
    "hallucination": {
        "fixable": True,
        "model_tier": "best",
        "prompt_addon": "Strictly follow the schema. Do not invent fields."
    }
}
```

#### 3.4.5 Exponential Backoff

```text
Formula: delay = base * (2 ^ attempt)

Attempt 1: 1000ms  * (2^0) = 1s
Attempt 2: 1000ms  * (2^1) = 2s
Attempt 3: 1000ms  * (2^2) = 4s
Attempt 4: 1000ms  * (2^3) = 8s
Attempt 5: 1000ms  * (2^4) = 16s

Maximum delay capped at 60s to prevent excessive waits.
```

**Implementation:**

```python
import time
import random

def calculate_delay(attempt, base_ms=1000, max_ms=60000):
    delay = base_ms * (2 ** (attempt - 1))
    jitter = random.randint(0, delay // 4)  # 25% jitter
    return min(delay + jitter, max_ms) / 1000.0
```

#### 3.4.6 Model Switching Strategy

```text
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Qwen / Local   │────→│   DeepSeek-V3   │────→│  GPT-4 / Claude │
│   (cheap)       │     │   (medium)      │     │   (expensive)   │
└─────────────────┘     └─────────────────┘     └─────────────────┘
     Attempt 1-2             Attempt 3-4              Attempt 5+
```

**Model Selection Logic:**

```python
MODEL_TIERS = {
    "cheap": ["qwen-14b", "qwen-coder"],
    "medium": ["deepseek-v3", "deepseek-coder"],
    "best": ["gpt-4", "claude-3-opus"]
}

def select_model(attempt, error_type, budget_remaining):
    if attempt <= 2:
        tier = "cheap"
    elif attempt <= 4:
        tier = "medium"
    else:
        tier = "best"

    # Override for complex errors
    if error_type in ["hallucination", "logic"]:
        tier = "best"

    # Budget check
    if budget_remaining < 1000:
        tier = "cheap"

    return random.choice(MODEL_TIERS[tier])
```

#### 3.4.7 Context Augmentation

Each retry enriches the prompt with cumulative context:

```json
{
  "task_id": "T3",
  "attempt": 3,
  "original_prompt": "Generate a login function",
  "previous_errors": [
    {"attempt": 1, "error": "SyntaxError: invalid syntax"},
    {"attempt": 2, "error": "NameError: 'user' is not defined"}
  ],
  "previous_outputs": [
    {"attempt": 1, "output": "def login(): ..."},
    {"attempt": 2, "output": "def login(user): ..."}
  ],
  "accumulated_instructions": [
    "Fix syntax errors",
    "Ensure all variables are defined before use",
    "Add type hints"
  ],
  "current_instruction": "Fix the NameError and ensure the function handles edge cases"
}
```

#### 3.4.8 Full Retry Implementation

```python
class IntelligentRetryController:
    def __init__(self, max_retries=5, base_delay=1.0):
        self.max_retries = max_retries
        self.base_delay = base_delay
        self.attempt_history = []

    def execute_with_retry(self, task_fn, task_state):
        for attempt in range(1, self.max_retries + 1):
            start_time = time.time()

            try:
                # Execute task
                result = task_fn(task_state)

                # Validate result
                if self.validate_result(result):
                    return {
                        "success": True,
                        "result": result,
                        "attempts": attempt,
                        "history": self.attempt_history
                    }

                # Result invalid but no exception
                error = "Validation failed: output does not match schema"

            except Exception as e:
                error = str(e)

            # Classify error
            error_type = self.classify_error(error)

            # Record attempt
            self.attempt_history.append({
                "attempt": attempt,
                "error": error,
                "error_type": error_type,
                "duration": time.time() - start_time
            })

            # Check budget
            if task_state.get("budget_remaining", 0) <= 0:
                return {"success": False, "reason": "budget_exhausted"}

            # Last attempt failed
            if attempt == self.max_retries:
                break

            # Update state for next retry
            task_state = self.update_state_for_retry(
                task_state, error, error_type, attempt
            )

            # Calculate and apply delay
            delay = self.calculate_delay(attempt)
            time.sleep(delay)

        return {
            "success": False,
            "result": None,
            "reason": "max_retries_exceeded",
            "history": self.attempt_history
        }

    def update_state_for_retry(self, state, error, error_type, attempt):
        state["attempt"] = attempt + 1
        state["previous_error"] = error
        state["error_type"] = error_type
        state["previous_output"] = state.get("output")
        state["model"] = select_model(attempt + 1, error_type, state.get("budget_remaining", 0))

        # Inject error-specific instructions
        strategy = ERROR_STRATEGIES.get(error_type, {})
        if "prompt_addon" in strategy:
            state["instructions"] = state.get("instructions", "") + "\n" + strategy["prompt_addon"]

        return state
```

#### 3.4.9 BAMAS Integration

```python
def check_budget_before_retry(state, estimated_cost):
    remaining = state.get("budget_remaining", 0)

    if remaining < estimated_cost * 2:
        # Not enough budget for another retry + escalation
        return {"can_retry": False, "action": "escalate_early"}

    if remaining < estimated_cost:
        return {"can_retry": False, "action": "fail"}

    return {"can_retry": True}
```

#### 3.4.10 Failure Patterns

| Pattern | Detection | Action |
|---------|-----------|--------|
| Same error repeating | Error message similarity > 90% | Change model + strategy immediately |
| Looping without improvement | No change in output quality | Escalate early |
| Partial success | Some validations pass | Continue with corrected state |
| Cascading failures | Multiple tasks fail in sequence | Pause DAG, alert supervisor |

---

### 3.5 Failure Escalation System

#### 3.5.1 Definition

> **Failure Escalation:** Controlled fallback mechanism that transfers responsibility from automation → higher intelligence → human when confidence drops.

#### 3.5.2 Escalation Levels

| Level | Name | Trigger Conditions | Actions | Latency |
|-------|------|-------------------|---------|---------|
| 0 | Normal Execution | — | Agent runs; success → continue | Immediate |
| 1 | Self-Healing | Minor, auto-fixable error | Fix + retry internally | <10s |
| 2 | Intelligent Retry | Retry needed with strategy change | Change model, prompt, context | <60s |
| 3 | Supervisor | Retries exhausted, loop stuck, conflicting outputs | Simplify task, override agent logic, force structured output | <5min |
| 4 | Leader Agent | Ambiguity, missing information, logical conflict, plan failure | Re-analyze problem, create new PRD, ask user clarifying questions | <15min |
| 5 | Human-in-the-Loop | Critical decision, unsafe action, security risk, high uncertainty | Pause execution, request human approval | User-dependent |

#### 3.5.3 Trigger Conditions

```python
ESCALATION_TRIGGERS = {
    "retry_exhausted": {
        "condition": lambda s: s["attempt"] >= MAX_RETRIES,
        "default_level": 3
    },
    "logic_loop": {
        "condition": lambda s: s["same_error_count"] >= 3,
        "default_level": 3
    },
    "budget_critical": {
        "condition": lambda s: s.get("budget_remaining", 0) / s.get("budget_allocated", 1) < 0.1,
        "default_level": 4
    },
    "security_risk": {
        "condition": lambda s: s.get("security_score", 1.0) < 0.3,
        "default_level": 5
    },
    "conflicting_outputs": {
        "condition": lambda s: s.get("output_divergence", 0) > 0.5,
        "default_level": 4
    },
    "timeout_stuck": {
        "condition": lambda s: s.get("time_since_start", 0) > s.get("max_allowed_time", 3600),
        "default_level": 3
    },
    "user_override": {
        "condition": lambda s: s.get("user_requested_hitl") is True,
        "default_level": 5
    }
}
```

#### 3.5.3.1 Trigger Evaluation Logic

```python
def evaluate_escalation(task_state):
    """
    Evaluate all triggers and return the highest escalation level.
    Returns: None (no escalation) or dict with 'trigger' and 'level'.
    """
    triggered = []

    for name, config in ESCALATION_TRIGGERS.items():
        if config["condition"](task_state):
            triggered.append({
                "trigger": name,
                "level": config["default_level"]
            })

    if not triggered:
        return None

    # Highest level wins
    highest = max(triggered, key=lambda x: x["level"])
    return highest
```

#### 3.5.4 Escalation Routing Logic

Escalation uses LangGraph conditional edges for dynamic routing:

```text
┌─────────────┐
│   TASK      │
│   FAILED    │
└──────┬──────┘
       │ Evaluate triggers
       ▼
┌──────▼──────┐
│ Escalation  │
│ Controller  │
└──────┬──────┘
       │
┌─────▼─────┐  ┌─────▼─────┐  ┌─────▼─────┐
│Level 1-2  │  │ Level 3   │  │ Level 4   │
│Self-Healing│  │Supervisor │  │ Leader    │
│/ Retry     │  └─────┬────┘  └─────┬─────┘
└────────────┘         │            │
                       │            │
                       └─────▼──────┼─────▼──────┐
                             │      │            │
                       ┌─────▼──────┘            │
                       │  Level 5                │
                       │ Human HITL              │
                       │ (Final Gate)            │
                       └─────────────────────────┘
```

**Routing Code:**

```python
from langgraph.graph import END

def escalation_router(state):
    trigger = evaluate_escalation(state)

    if trigger is None:
        return "retry_task"

    level = trigger["level"]
    
    routing = {
        1: "simple_retry",
        2: "self_healing_loop",
        3: "supervisor_node",
        4: "leader_agent_node", 
        5: "human_hitl_node"
    }
    
    return routing.get(level, "human_hitl_node")
```

#### 3.5.5 Supervisor Node Implementation

**Level 3**: Simplifies complex tasks by breaking them into atomic sub-tasks with strict schemas.

**Supervisor Prompt Template:**

```text
You are the Supervisor Agent. A task failed after multiple retries.

TASK: {task_description}
ERRORS: {error_history[-3:]}
CONTEXT: {project_blackboard}

SIMPLIFY THIS:
1. Break into 2-4 atomic sub-tasks
2. Define JSON schema for each output
3. Recommend model tier (cheap/medium/best)
4. Limit to verified tools only

OUTPUT (strict JSON):
{
  "analysis": "Why original task failed",
  "subtasks": [
    {
      "id": "unique-id",
      "description": "One sentence",
      "schema": { "type": "object", "properties": {...} },
      "model_tier": "cheap",
      "max_retries": 3
    }
  ]
}
```

**Supervisor Node:**

```python
def supervisor_node(state):
    prompt = build_supervisor_prompt(state)
    result = llm.invoke(prompt, model="claude-3-sonnet-20240229")
    
    plan = parse_json(result.content)
    
    # Inject subtasks into DAG
    for sub in plan["subtasks"]:
        new_task = create_subtask(
            parent_id=state["task_id"],
            plan=sub
        )
        dag.add_task(new_task)
    
    state.update({
        "status": "simplified",
        "escalation_level": 3,
        "supervisor_plan": plan
    })
    
    return state
```

#### 3.5.6 Leader Agent Escalation (Level 4)

**Trigger**: Supervisor failed or strategic mismatch detected.

**Leader Responsibilities:**
- Re-analyze PRD vs current project state
- Identify missing requirements
- Request user clarification if needed
- Recompile DAG with corrected plan
- Force structured output schemas

**Leader Decision Matrix:**

| Scenario | Action | Latency |
|----------|--------|---------|
| Missing info | User questionnaire | 5min |
| Flawed approach | New DAG | 3min |
| Conflicting outputs | Conflict resolution | 2min |
| No clear path | Force HITL | Immediate |

#### 3.5.7 Human-in-the-Loop Protocol (Level 5)

**Final safety gate** - pauses execution for human approval.

**HITL Workflow:**

```text
Task fails critically
  ↓
Controller detects Level 5 trigger
  ↓
Send HITL request to UI (WebSocket)
  ↓
User sees: "Manual Review Required"
  ↓
Options: [Approve] [Reject] [Modify] [Abort]
  ↓
Update task state → Resume/Stop
```

**HITL Request Schema:**

```json
{
  "hitl_id": "uuid",
  "project_id": "P123",
  "task_id": "T3",
  "reason": "security_risk",
  "context": {
    "task": "string",
    "error": "string",
    "proposed_action": "string",
    "cost": 15.50,
    "risks": ["potential_leak"]
  },
  "options": ["approve", "reject", "modify", "abort"],
  "timeout": 600,
  "status": "pending"
}
```

**HITL Handler:**

```python
def human_hitl_node(state):
    hitl_request = create_hitl_request(state)
    
    db.store_hitl_request(hitl_request)
    redis.publish("hitl_events", json.dumps(hitl_request))
    
    state.update({
        "status": "hitl_pending",
        "hitl_id": hitl_request["hitl_id"]
    })
    
    return state
```

#### 3.5.8 Escalation Controller Implementation

**Central controller integrating all levels:**

```python
class EscalationController:
    def __init__(self):
        self.triggers = ESCALATION_TRIGGERS
        self.history = []

    async def handle_failure(self, state: dict) -> dict:
        trigger = evaluate_escalation(state)
        
        if not trigger:
            return self.retry(state)
            
        state["escalation"] = trigger
        self.history.append(trigger)
        
        # Route by level
        router = {
            1: self.retry,
            2: self.heal,
            3: self.supervise,
            4: self.lead,
            5: self.human_hitl
        }
        
        return await router[trigger["level"]](state)

    async def supervise(self, state):
        """Level 3 - Supervisor node."""
        plan = await supervisor_llm.invoke(build_supervisor_prompt(state))
        # Inject subtasks...
        return state

    async def human_hitl(self, state):
        """Level 5 - Final gate."""
        return human_hitl_node(state)
```

#### 3.5.9 Metrics & Observability

**Escalation Dashboard Metrics:**

| Metric | Description | Threshold |
|--------|-------------|-----------|
| `escalation_rate` | % of tasks that escalate | <5% |
| `avg_escalation_level` | Average escalation level | <2.5 |
| `hitl_frequency` | Human interventions per hour | <1 |
| `supervisor_success` | % of tasks fixed by supervisor | >70% |

**Prometheus Alerts:**
```yaml
- alert: HighEscalationRate
  expr: rate(escalation_total[5m]) > 0.1
  for: 5m
  labels:
    severity: critical
```

---

## 4. Execution Pipeline

#### 4.1 Pre-flight Validation

Every task passes through **5 mandatory checks** before execution:

1. **DAG Consistency** - Dependencies satisfied
2. **BAMAS Budget Check** - Sufficient tokens remaining
3. **Security Pre-scan** - No obvious forbidden patterns
4. **Resource Availability** - Sandbox capacity
5. **Context Window Fit** - Token count < model limit

**Pre-flight Code:**

```python
async def preflight_validation(task):
    checks = await asyncio.gather(
        validate_dag_deps(task),
        bamas_check_budget(task),
        security_prescan(task),
        resource_check(task),
        context_window_check(task)
    )
    
    failures = [c for c in checks if not c["passed"]]
    
    if failures:
        raise PreFlightError(f"{len(failures)} checks failed: {[c['reason'] for c in failures]}")
```

#### 4.2 Agent Dispatch

Tasks are dispatched to BullMQ with priority and retry policies:

```python
def dispatch_task(task):
    job_data = {
        "task_id": task["task_id"],
        "agent": task["agent"],
        "prompt": build_agent_prompt(task),
        "context": get_context(task),
        "max_retries": task.get("max_retries", 3)
    }
    
    bullmq.add(
        queue="agent_tasks",
        job_data=job_data,
        opts={
            "priority": PRIORITY[task["priority"]],
            "delay": calculate_backoff(task["attempt"]),
            "removeOnComplete": 100,
            "removeOnFail": 50
        }
    )
```

#### 4.3 Sandbox Execution

**Firecracker MicroVM provisioning and execution:**

```python
async def sandbox_execute(code, context):
    vm = await microvm.provision({
        "cpu": 2,
        "memory_mb": 512,
        "filesystem": context["workspace"],
        "network_policy": "restrict_outbound"
    })
    
    try:
        result = await vm.execute(code, timeout=60)
        
        # Validate execution result
        if result["exit_code"] != 0:
            raise SandboxError(result["stderr"])
            
        return result
    finally:
        await vm.cleanup()
```

#### 4.4 Output Validation

**Multi-stage validation pipeline:**

1. **JSON Schema Compliance**
2. **Security Scan**
3. **QC Agent Review**
4. **PRD Alignment Check**

```python
async def validate_output(output, task):
    validations = [
        schema_validator(output, task["output_schema"]),
        security_scanner(output),
        qc_agent_review(output, task),
        prd_alignment_check(output, task["project_prd"])
    ]
    
    failed = [v for v in validations if not v["valid"]]
    
    if failed:
        return {"valid": False, "errors": [f["reason"] for f in failed]}
    
    return {"valid": True, "metrics": {v["metric"]: v["score"] for v in validations}}
```

#### 4.5 State Commit

**Two-phase commit (Redis + Postgres):**

```python
@transactional
def commit_task_result(task_id, result):
    # Phase 1: Optimistic Redis write (fast path)
    redis.hset(f"task:{task_id}", mapping=result)
    
    # Phase 2: Durable Postgres commit
    db.update_task_result(task_id, result)
    
    # Phase 3: Publish completion event
    redis.publish("task_events", json.dumps({
        "event": "TASK_COMPLETED",
        "task_id": task_id,
        "project_id": result["project_id"]
    }))
    
    # Phase 4: Checkpoint project state
    checkpoint_project(result["project_id"])
```

#### 4.6 Error Handling Flow

Errors are routed through **3 parallel paths**:

```
┌─────────────┐
│   ERROR     │
└──────┬──────┘
       │
┌─────▼─────┐  ┌─────▼─────┐  ┌─────▼─────┐
│ Store     │  │ Retry     │  │ Escalate  │
│ History   │  │ Policy    │  │ Controller│
└──────┬────┘  └─────┬────┘  └─────┬─────┘
       │                │            │
       └────────────────┼────────────┼──────┐
                        │            │      │
                 ┌───────▼────────────▼──────▼──────┐
                 │           Orchestrator           │
                 │       Resumes from Checkpoint    │
                 └──────────────────────────────────┘
```

---

## 5. Orchestrator Control Loop

#### 5.1 Main Control Loop

**Infinite loop with graceful termination:**

```python
async def orchestrator_main_loop():
    """
    Main orchestrator loop - never exits except on shutdown signal.
    """
    while not shutdown_signal.is_set():
        # 1. Find runnable tasks
        runnable = await find_runnable_tasks()
        
        if not runnable:
            if await all_tasks_completed():
                logger.info("All tasks completed")
                break
            else:
                await asyncio.sleep(0.1)  # Avoid busy loop
                continue
        
        # 2. Execute in parallel (max concurrency)
        semaphore = asyncio.Semaphore(CONFIG["max_concurrent"])
        tasks = [execute_task_with_semaphore(t, semaphore) for t in runnable]
        
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        # 3. Process results and trigger next wave
        await process_results(results)
        
        # 4. Health check
        await health_check()
        
        await asyncio.sleep(0.01)  # Yield control
```

#### 5.2 Runnable Task Discovery

**Dependency resolution algorithm:**

```python
async def find_runnable_tasks():
    """
    Find all tasks with satisfied dependencies.
    """
    all_tasks = await db.get_pending_tasks()
    runnable = []
    
    for task in all_tasks:
        deps_satisfied = await all_dependencies_completed(task["depends_on"])
        resources_available = await check_resources(task)
        
        if deps_satisfied and resources_available:
            runnable.append(task)
    
    # Sort by priority
    runnable.sort(key=lambda t: PRIORITY_MAP[t["priority"]])
    
    return runnable[:CONFIG["max_batch_size"]]
```

#### 5.3 Parallel Execution

**Concurrent execution with resource isolation:**

```python
async def execute_task_with_semaphore(task, semaphore):
    async with semaphore:
        try:
            await preflight_validation(task)
            result = await agent_dispatch(task)
            await validate_and_commit(result)
            return {"status": "success", "task_id": task["task_id"]}
        except Exception as e:
            return await handle_failure(task, e)
```

#### 5.4 Event-Driven Architecture

**Redis Pub/Sub for cross-system coordination:**

```python
class EventHandler:
    def __init__(self):
        self.sub = redis.pubsub()
        self.sub.subscribe("task_events", "hitl_events", "project_events")
    
    async def listen_forever(self):
        for message in self.sub.listen():
            event = json.loads(message["data"])
            await self.handle_event(event)
    
    async def handle_event(self, event):
        if event["event_type"] == "TASK_COMPLETED":
            await trigger_dependents(event["task_id"])
        elif event["event_type"] == "HITL_RESOLVED":
            await resume_from_hitl(event["hitl_id"])
```

#### 5.5 Graceful Shutdown

**Checkpoint-aware shutdown:**

```python
async def graceful_shutdown():
    logger.info("Shutdown signal received")
    
    # 1. Set drain mode (no new tasks)
    CONFIG["drain_mode"] = True
    
    # 2. Complete in-flight tasks
    await drain_queue()
    
    # 3. Final checkpoint
    for project in active_projects():
        await checkpoint_project(project)
    
    # 4. Close connections
    await redis.close()
    await db.close()
    
    logger.info("Shutdown complete")
```

#### 5.6 Health Checks

**K8s-ready liveness/readiness probes:**

```python
async def health_check():
    checks = {
        "redis_connected": await redis.ping(),
        "postgres_connected": await db.ping(),
        "queue_depth": await bullmq.get_queue_length(),
        "sandbox_capacity": await microvm.get_available_capacity(),
        "memory_usage": psutil.virtual_memory().percent < 90
    }
    
    if not all(checks.values()):
        logger.warning(f"Health degraded: {checks}")
        raise HealthCheckFailed(checks)
```

---

## 6. Integration with BAMAS

#### 6.1 Model Auction Logic

**Intelligence auction for optimal model selection:**

```python
MODEL_TIERS = {
    "cheap": {"models": ["qwen-14b", "gpt-4o-mini"], "cost_per_million": 0.15},
    "medium": {"models": ["claude-3-sonnet", "deepseek-v2"], "cost_per_million": 3.0},
    "best": {"models": ["gpt-4o", "claude-3-opus", "o1-preview"], "cost_per_million": 15.0}
}

def auction_model(task_complexity, budget_remaining):
    """
    Bid system for intelligence allocation.
    """
    bids = []
    
    for tier, info in MODEL_TIERS.items():
        estimated_cost = estimate_tokens(task) * info["cost_per_million"] / 1e6
        
        if estimated_cost > budget_remaining * 0.8:
            continue
            
        bids.append({
            "tier": tier,
            "model": random.choice(info["models"]),
            "estimated_cost": estimated_cost,
            "success_probability": complexity_to_success(task_complexity, tier)
        })
    
    return max(bids, key=lambda b: b["success_probability"] / b["estimated_cost"])
```

#### 6.2 Budget Pre-flight Checks

**Hard blocks before expensive LLM calls:**

```python
async def bamas_preflight(task):
    remaining = await bamas.get_project_budget(task["project_id"])
    
    if remaining < 0.1 * task.get("budget_limit", 1000):
        raise BudgetCriticalError("Insufficient budget for task")
    
    if task.get("estimated_cost", 0) > remaining * 0.5:
        # Request user approval for high-cost tasks
        await trigger_hitl(task, "high_cost_warning")
    
    return True
```

#### 6.3 Real-time Cost Tracking

**Live token accounting:**

```python
class BAMASCostTracker:
    def __init__(self, redis_client):
        self.redis = redis_client
    
    async def track_llm_usage(self, request_id, tokens_used, model):
        cost = calculate_cost(tokens_used, model)
        
        self.redis.hincrbyfloat(
            f"project_budget:{request_id}", 
            "tokens_used", tokens_used
        )
        
        self.redis.hincrbyfloat(
            f"project_budget:{request_id}", 
            "dollars_spent", cost
        )
        
        # Check thresholds
        if self.redis.hget(f"project_budget:{request_id}", "budget_warning_sent") != "true":
            await self.check_thresholds(request_id)
```

#### 6.4 Loop Detection & Kill Switch

**Economic loop detection:**

```python
async def detect_loops(task_history):
    """
    Detect if agent is stuck in reasoning loop.
    """
    recent_calls = task_history[-10:]
    
    # Same tool same input 3+ times
    tool_patterns = group_by_tool_input(recent_calls)
    
    looping_tools = [t for t, count in tool_patterns.items() if count >= 3]
    
    if looping_tools:
        await trigger_kill_switch(task_history[-1]["task_id"])
        return True
    
    return False
```

#### 6.5 Intelligence Escalation

**Automatic model upscaling on failure:**

```
Attempts 1-2: cheap (qwen-14b)
Attempts 3-4: medium (claude-sonnet)
Attempt 5: best (gpt-4o)
```

#### 6.6 BAMAS State Schema

```json
{
  "project_id": "P123",
  "tier": "pro",
  "budget": {
    "allocated": 10000,
    "spent": 4500,
    "remaining": 5500,
    "warning_threshold": 0.8
  },
  "current_model_tier": "medium",
  "escalations_today": 2,
  "loop_detections": 0
}
```

---

## 7. Safety Enforcement

#### 7.1 Sandbox Resource Limits

**Cgroups v2 enforcement:**

```python
SANDBOX_LIMITS = {
    "cpu_quota": "200000",  # 2 vCPUs
    "memory_max": "536870912",  # 512MB
    "io_max": "10000",  # IOPS
    "pids_max": 1024
}
```

#### 7.2 Forbidden Pattern Detection

**Regex-based security scanner:**

```python
FORBIDDEN_PATTERNS = [
    r"rm\s+-rf\s+/",
    r"format\s+/",
    r"DROP\s+(DATABASE|TABLE)\s+\*",
    r"(delete|remove|del)\s+from\s+\*\s*=\s*\*",
    r"eval\s*\(",
    r"__import__\s*\('os'\)",
    r"curl\s+.*\|.*bash"
]

def scan_forbidden_patterns(code):
    for pattern in FORBIDDEN_PATTERNS:
        if re.search(pattern, code, re.IGNORECASE):
            return False
    return True
```

#### 7.3 HITL Gates

**Mandatory human approval for high-risk actions:**

| Risk Level | Examples | HITL Required |
|------------|----------|---------------|
| Critical | `rm -rf`, production deploy | Always |
| High | Database writes, secrets access | User preference |
| Medium | External API calls | First 3 calls |
| Low | Read-only operations | Never |

#### 7.4 Kill Switch Implementation

**Global emergency stop:**

```python
async def trigger_kill_switch(reason="manual"):
    redis.set("global_kill_switch", "ACTIVE", ex=3600)
    redis.publish("system_events", json.dumps({
        "event": "KILL_SWITCH_ACTIVATED",
        "reason": reason,
        "timestamp": datetime.utcnow().isoformat()
    }))
    
    # Terminate all sandboxes
    await microvm.terminate_all()
```

#### 7.5 Immutable Audit Trail

**Event sourcing for every action:**

```json
{
  "event_id": "uuid",
  "timestamp": "2024-01-15T10:00:00Z",
  "actor": "code_architect",
  "action": "write_file",
  "target": "/app/auth.js",
  "hash_before": "sha256:...",
  "hash_after": "sha256:...",
  "signature": "ed25519:...",
  "validated": true
}
```

---

## 8. Common Failure Cases

#### 8.1 Cascading Failures

**Problem:** One task failure blocks entire dependency chain.

**Solution:** Dependency isolation + parallel independent paths.

```python
def isolate_cascade(failed_task):
    # Mark dependents as "parent_failed"
    dependents = dag.get_dependents(failed_task["task_id"])
    
    for dep in dependents:
        dep["status"] = "blocked_cascade"
        dag.schedule_alternative_path(dep)
```

#### 8.2 Deadlock Detection

**Problem:** Circular dependencies or resource contention.

**Solution:** DAG cycle detection + resource fair-share.

```python
def detect_deadlock(active_tasks):
    visited = set()
    stack = set()
    
    for task in active_tasks:
        if await has_cycle(task, visited, stack):
            await break_deadlock(task)
```

#### 8.3 Resource Exhaustion

**Problem:** Sandbox pool depleted.

**Solution:** Dynamic scaling + queue prioritization.

#### 8.4 Agent Hallucination

**Problem:** Agent generates incorrect code/logic.

**Solution:** Fact Checker + structured schemas + QC peer review.

#### 8.5 Recovery Patterns

**Pattern Matrix:**

| Failure Type | Recovery Strategy | Success Rate |
|--------------|-------------------|--------------|
| Syntax Error | Self-healing loop | 95% |
| Logic Error | Supervisor + QC | 85% |
| External API | Exponential backoff | 70% |
| Resource | Queue + scale | 90% |

---

## 9. Security & Threat Model

#### 9.1 Threat Model (STRIDE)

**Spoofing:** Fake agent identity
**Tampering:** Code injection via prompt
**Repudiation:** Unlogged actions
**Information Disclosure:** Data leaks
**Denial of Service:** Resource exhaustion
**Elevation of Privilege:** Sandbox escape

#### 9.2 Prompt Injection Mitigation

**Defense Layers:**
1. **Gateway filtering** (regex/BERT)
2. **Agent isolation** (separate context windows)
3. **Structured output enforcement** (JSON schemas)
4. **Post-execution validation** (Security Brain)

#### 9.3 Sandbox Escape Prevention

**Multi-layer containment:**
- **Firecracker MicroVM** (dedicated kernel)
- **NVIDIA OpenShell** (policy enforcement)
- **Landlock/seccomp** (syscall filtering)
- **eBPF network jail**

#### 9.4 Data Exfiltration Controls

**Outbound traffic monitoring:**
```python
# eBPF program drops:
# - High entropy payloads
# - DNS tunneling
# - Unapproved destinations
```

#### 9.5 Cryptographic Audit Trail

**Immutable event log with signatures:**
- Every state change cryptographically signed
- Tamper-proof event sourcing in PostgreSQL
- Merkle tree verification for integrity

---

## 10. Production Readiness Gaps

#### 10.1 Monitoring & Alerting

**Missing:**
- OpenTelemetry traces for full request flow
- Custom Prometheus metrics for agent performance
- Grafana dashboards for escalation rates

#### 10.2 Disaster Recovery

**Missing:**
- Multi-region Redis/Postgres replication
- Cross-DC failover orchestration
- Automated backup validation

#### 10.3 Chaos Engineering

**Missing:**
- Chaos Mesh for fault injection testing
- Gremlin integration for resilience testing

#### 10.4 Capacity Planning

**Missing:**
- Predictive scaling based on queue depth
- Cost forecasting for token consumption

---

## 11. Recommended Technology Stack

#### 11.1 Core Stack

| Component | Technology | Reason |
|-----------|------------|--------|
| State | Redis Cluster | Sub-ms latency |
| Tasks | BullMQ | Built-in retries |
| Persistence | PostgreSQL + Timescale | Event sourcing |
| DAG Engine | LangGraph | Agent-native |
| Sandbox | Firecracker | Kernel isolation |
| Budget | Custom BAMAS | Intelligence auction |

#### 11.2 Deployment Patterns

```
K8s Cluster:
├── Gateway (Node.js) - 10 replicas
├── Orchestrator (Python) - 20 replicas  
├── Sandbox Operator (Go) - 50 replicas
├── Redis Cluster - 3 nodes
└── Postgres HA - 5 nodes
```

#### 11.3 Alternatives

| Conservative | Performance | Cost |
|--------------|-------------|------|
| Temporal | ✅ | ❌ |
| Airflow | ❌ | ❌ |
| Custom | ✅ | ❌ |

---

## 12. LangGraph Integration Guide

#### 12.1 State Schema Definition

```python
from typing import TypedDict, Optional, List, Dict
from datetime import datetime

class OrchestratorState(TypedDict):
    project_id: str
    task_id: str
    agent: str
    status: str  # pending|running|completed|failed|hitl_pending
    result: Optional[Dict]
    error: Optional[str]
    attempt: int
    escalation_level: int
    checkpoint_id: str
    created_at: datetime
    updated_at: datetime
```

#### 12.2 Core Node Patterns

```python
def agent_node(state):
    # Execute agent logic
    result = await llm_agent.invoke(state)
    return {"result": result, "status": "completed"}

def validation_node(state):
    # Schema + security validation
    valid = await validate_output(state["result"])
    return {"validation": valid}

def escalation_node(state):
    # Route to appropriate escalation level
    return escalation_router(state)
```

#### 12.3 Conditional Edge Routing

```python
graph = StateGraph(OrchestratorState)

# Add nodes
graph.add_node("agent", agent_node)
graph.add_node("validate", validation_node)
graph.add_node("escalate", escalation_node)

# Add edges
graph.add_edge("agent", "validate")
graph.add_conditional_edges(
    "validate",
    lambda state: "escalate" if not state["validation"]["valid"] else END,
    {
        "escalate": "escalate",
        END: END
    }
)
```

#### 12.4 Streaming & Checkpointing

```python
app = graph.compile(checkpointer=PostgresSaver("postgres://..."))

# Streaming execution
async for event in app.astream_events(input, project_id, version="1"):
    await websocket.send(json.dumps(event))
```

#### 12.5 Complete Example: SaaS App DAG

```python
# Simplified SaaS app workflow
graph = StateGraph(SaaSState)

graph.add_node("research", research_node)
graph.add_node("design", design_node)
graph.add_node("code", code_architect_node)
graph.add_node("test", test_node)
graph.add_node("security", security_brain_node)
graph.add_node("qc", qc_node)

# Parallel branches
graph.add_edge("research", "design")
graph.add_edge("design", "code")
graph.add_edge("code", ["test", "security"])  # Parallel
graph.add_conditional_edges("test", test_router)
graph.add_conditional_edges("security", security_router)
graph.add_edge("qc", END)

app = graph.compile()
```

---

## 13. Appendices

#### 13.1 Glossary

| Term | Definition |
|------|------------|
| BAMAS | Budget & Model Allocation System |
| HITL | Human-in-the-Loop |
| DAG | Directed Acyclic Graph |
| Firecracker | MicroVM runtime |

#### 13.2 Complete Data Schemas

**Task Schema:**
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["task_id", "agent", "status"],
  "properties": {
    "task_id": {"type": "string"},
    "agent": {"type": "string"},
    "status": {"enum": ["pending", "running", "completed", "failed"]},
    "escalation_level": {"type": "integer", "minimum": 0, "maximum": 5}
  }
}
```

#### 13.3 Error Codes

| Code | Description | Action |
|------|-------------|--------|
| `E001` | Dependency not satisfied | Wait for parent |
| `E002` | Budget exceeded | Escalate to HITL |
| `E003` | Sandbox unavailable | Queue retry |
| `E005` | Security violation | Abort + alert |

#### 13.4 Changelog

```
v1.0 (2024-01-15): Initial implementation specification
- Complete core subsystems 1-3
- Architecture diagrams and code examples

v1.1 (2024-01-16): Complete spec ✅
- Sections 4-13 added
- Full escalation system
- Production deployment guidance
```

**Status:** ✅ COMPLETE IMPLEMENTATION SPECIFICATION
