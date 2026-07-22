# Grizon AI System Fix Prompt

## System Overview

You are working on **Grizon AI**, an autonomous AI agent orchestration system that builds full-stack applications from user prompts. The system uses a multi-agent architecture with a Brain (Python/FastAPI backend) and a Frontend (Next.js).

**Workspace Root:** `D:\C DRIVE DOWNLOAD\Grizon-AI`

**Key Directories:**
- `grizon-ai-backend-2-main/Brain/` - Python AI agents (Brain system)
- `Grizon-AI-Backend/` - Node.js/Express backend
- `Grizon-AI-Frontend-v2/` - Next.js frontend
- `Grizon-AI-Frontend-v2-api-2/` - Frontend with API integration

---

## Architecture: Agent Pipeline

The system follows this flow:
```
User Prompt → Manager/Leader → Questions (if needed) → Planner → Todo → Builder (sub-agents) → Runner → Watcher → Reporter
```

### Agent Files (all in `grizon-ai-backend-2-main/Brain/`):

1. **Manager Agent** (`agents/manager/manager_agent.py`)
   - Role: Analyzes user intent, decides if more context is needed
   - Output: JSON with `analysis`, `is_context_missing`, `next_agent`, `confidence`
   - System prompt embedded in code (lines 183-203)

2. **Questions Agent** (`agents/questions/questions_agent.py`)
   - Role: Asks clarifying questions to gather missing context
   - Output: JSON with `preamble` and `questions` array
   - System prompt embedded in code (lines 46-72)

3. **Planner Agent** (`agents/planner/planner_agent.py`)
   - Role: Creates technical architecture and project plan
   - Output: JSON with `project_name`, `markdown_plan`, `tech_stack`, `status`
   - System prompt embedded in code (lines 81-104)

4. **Todo Agent** (`agents/todo/todo_agent.py`)
   - Role: Converts plan into executable tasks (3-15 tasks)
   - Output: JSON array of tasks with `id`, `title`, `description`, `category`, `acceptance_criteria`
   - System prompt embedded in code (lines 122-173)

5. **Builder Agent** (`agents/builder/builder_agent.py`)
   - Role: Executes tasks, coordinates sub-agents, writes code
   - Uses `client_save_code` tool to write files
   - System prompts for frontend/backend embedded in code (lines 304-339)

6. **Runner Agent** (`agents/runner/runner_agent.py`)
   - Role: Deploys built project to remote sandbox MCP server
   - Handles Vite dev server on port 9999

### Shared Components:
- `shared/agent.py` - BaseAgent class with LLM interaction and JSON parsing
- `shared/build_standards.py` - Mandatory build standards (FULL_STACK_BUILD_STANDARDS)
- `shared/frontend_entry.py` - Normalizes App.jsx/App.tsx entry files
- `shared/review_loop.py` - QualityReviewer for code validation

---

## Critical Issues to Fix

### Issue 1: System Prompts Are Embedded in Python Code
Each agent has its system prompt hardcoded as a string inside the `execute()` method. This makes them:
- Hard to maintain
- Prone to inconsistencies
- Difficult for other AI agents to understand the full context

**Fix:** Extract all system prompts to a separate `prompts/` directory as markdown or JSON files.

### Issue 2: Builder Agent System Prompt Needs Clarity
The Builder Agent has TWO system prompts (frontend and backend) but they're not clearly separated. The prompts need to be:
- More specific about what files to create
- Clearer about the order of operations
- Explicit about error handling

**Fix:** Create separate prompt templates for frontend and backend tasks.

### Issue 3: Todo Agent Task Descriptions Are Too Vague
The Todo Agent generates tasks with descriptions like "Continue building per the approved plan" which gives the Builder Agent no guidance.

**Fix:** Enforce that every task description MUST include:
- Exact file paths to create/modify
- Specific UI elements or API endpoints to implement
- Dependencies to add to package.json

### Issue 4: Quality Review Loop Is Not Integrated into Builder
The `QualityReviewer` in `review_loop.py` exists but the Builder Agent doesn't call it after each task. The validation only happens via `_validate_saved_files()` which is basic.

**Fix:** Integrate `QualityReviewer.review_output()` into the Builder Agent's task execution loop.

### Issue 5: Missing Error Recovery in Agent Loop
The Builder Agent's `_run_agent_loop()` has timeouts and max tool calls but doesn't have proper error recovery or retry logic when the LLM generates invalid code.

**Fix:** Add a retry mechanism with specific error feedback to the LLM.

### Issue 6: No Centralized Prompt Management
All prompts are scattered across agent files. There's no single source of truth for:
- Build standards
- Task templates
- Validation rules

**Fix:** Create a `prompts/` directory with:
- `manager_system.md`
- `questions_system.md`
- `planner_system.md`
- `todo_system.md`
- `builder_frontend.md`
- `builder_backend.md`
- `build_standards.md`
- `validation_rules.md`

---

## What to Do

### Step 1: Create Prompt Files
Create a `grizon-ai-backend-2-main/Brain/prompts/` directory with all system prompts as separate files.

### Step 2: Update Agent Imports
Modify each agent to load prompts from files instead of hardcoded strings:
```python
import os
from pathlib import Path

PROMPTS_DIR = Path(__file__).parent.parent / "prompts"

def load_prompt(name: str) -> str:
    return (PROMPTS_DIR / f"{name}.md").read_text()
```

### Step 3: Enhance Builder Agent
Add the QualityReviewer call after each task:
```python
# After task completion
review_result = await self.reviewer.review_output(
    "Frontend Agent",
    task,
    skills_content,
    {"files": saved_files}
)
if not review_result.get("passed"):
    # Retry with feedback
```

### Step 4: Fix Task Descriptions
Update Todo Agent to enforce detailed task descriptions:
```python
TASK_DESCRIPTION_REQUIREMENTS:
- EXACT file paths (e.g., "frontend/src/components/Navbar.jsx")
- EXACT UI elements (e.g., "dark gradient background, logo, 3 nav links")
- EXACT dependencies (e.g., "lucide-react in package.json")
```

### Step 5: Add Error Recovery
Add retry logic to Builder Agent's agent loop:
```python
if validation_issues:
    # Inject specific fix instructions
    fix_prompt = f"Fix these issues: {validation_issues}. Resave the files."
    # Retry with fix prompt
```

---

## Testing Checklist

After fixes, verify:
1. [ ] Manager Agent correctly identifies missing context
2. [ ] Questions Agent asks non-redundant questions
3. [ ] Planner Agent creates detailed markdown plans
4. [ ] Todo Agent generates 3-15 granular tasks
5. [ ] Builder Agent writes code that passes validation
6. [ ] QualityReviewer catches React Router v5 syntax
7. [ ] QualityReviewer catches placeholder components
8. [ ] Runner Agent deploys to sandbox successfully
9. [ ] All imports in App.jsx match actual files
10. [ ] No orphan components in workspace

---

## Prompt Template for Other AI Agents

When asking another AI agent to fix this codebase, use this prompt:

```
You are working on Grizon AI, an autonomous AI agent system that builds full-stack apps from user prompts.

CONTEXT:
- The system uses Python (FastAPI) agents in grizon-ai-backend-2-main/Brain/
- Key files: agents/manager/, agents/builder/, agents/planner/, agents/todo/, shared/build_standards.py
- All system prompts are EMBEDDED in Python code (need to be extracted)
- Builder Agent has a QualityReviewer that's NOT being used
- Task descriptions are too vague for the Builder Agent

YOUR TASK:
1. Extract all system prompts from agent files to a prompts/ directory
2. Update agents to load prompts from files
3. Integrate QualityReviewer into Builder Agent's execution loop
4. Enforce detailed task descriptions in Todo Agent
5. Add error recovery to Builder Agent's agent loop

CONSTRAINTS:
- Keep all agent interfaces (execute method signature) unchanged
- Maintain backward compatibility with existing orchestrator.py
- Don't change the LLM provider (gpt-5.4) or model routing
- Keep the workspace_manager and websocket_manager integrations working

TESTING:
After fixes, the system should:
- Generate valid React Router v6 code (not v5)
- Never output placeholder components (<h1>Home Page</h1>)
- Always include App.jsx when creating components
- Deploy successfully to sandbox on port 9999
```
