# Prompt for Other AI Agents to Fix Grizon AI System

Use this prompt when asking another AI agent (like Claude, GPT, etc.) to fix the Grizon AI codebase.

---

## THE PROMPT

```
You are working on Grizon AI, an autonomous AI agent system that builds full-stack web applications from user prompts. The system uses a multi-agent pipeline with Python (FastAPI) backend agents and a Next.js frontend.

## Workspace
- Root: D:\C DRIVE DOWNLOAD\Grizon-AI
- Brain (Python agents): grizon-ai-backend-2-main/Brain/
- Frontend: Grizon-AI-Frontend-v2-api-2/brain/

## Agent Pipeline Flow
User Prompt → Manager/Leader Agent → Questions Agent (if needed) → Planner Agent → Todo Agent → Builder Agent → Runner Agent → Watcher Agent → Reporter Agent

## Key Files to Understand

1. **Orchestrator**: `Brain/orchestrator/orchestrator.py` - State machine that routes to agents
2. **Base Agent**: `Brain/shared/agent.py` - BaseAgent class with LLM interaction
3. **Build Standards**: `Brain/shared/build_standards.py` - FULL_STACK_BUILD_STANDARDS constant
4. **Quality Review**: `Brain/shared/review_loop.py` - QualityReviewer class

## Agent Files (ALL have embedded system prompts)
- `Brain/agents/manager/manager_agent.py` - Lines 183-203: Intent analysis
- `Brain/agents/questions/questions_agent.py` - Lines 46-72: Clarification questions
- `Brain/agents/planner/planner_agent.py` - Lines 81-104: Strategic planning
- `Brain/agents/todo/todo_agent.py` - Lines 122-173: Task generation
- `Brain/agents/builder/builder_agent.py` - Lines 304-339: Frontend/Backend code generation

## CRITICAL ISSUES TO FIX

### Issue 1: System Prompts Are Embedded in Python Code
Each agent has its system prompt hardcoded as a string inside execute(). This makes maintenance impossible.

**Fix**: Create `Brain/prompts/` directory with separate markdown files for each agent's system prompt.

### Issue 2: Builder Agent Has TWO System Prompts But They're Incomplete
The Builder Agent has frontend and backend prompts but they lack:
- Specific file creation order
- Error handling instructions
- Quality validation steps

**Fix**: Enhance both prompts with explicit instructions.

### Issue 3: Todo Agent Task Descriptions Are Too Vague
Tasks like "Continue building per the approved plan" give Builder Agent no guidance.

**Fix**: Enforce that every task MUST include:
- Exact file paths (e.g., "frontend/src/components/Navbar.jsx")
- Exact UI elements (e.g., "dark gradient background, logo, 3 nav links")
- Exact dependencies (e.g., "lucide-react in package.json")

### Issue 4: Quality Reviewer Is NOT Being Used
`Brain/shared/review_loop.py` has a QualityReviewer class but Builder Agent doesn't call it.

**Fix**: Add QualityReviewer.review_output() call after each task completion in Builder Agent.

### Issue 5: No Error Recovery in Agent Loop
Builder Agent's _run_agent_loop() has timeouts but no retry with fix instructions.

**Fix**: Add retry mechanism that feeds validation errors back to LLM.

### Issue 6: React Router v5 vs v6 Issues
Builder Agent keeps generating v5 syntax (Switch, component={}) instead of v6 (Routes, element={}).

**Fix**: Add explicit v6 examples in Builder Agent's frontend system prompt.

### Issue 7: Placeholder Components
Builder Agent generates `<h1>Home Page</h1>` instead of real UI.

**Fix**: Add explicit examples of real UI in Builder Agent's system prompt.

## YOUR TASK

1. **Extract system prompts** from all agent files to `Brain/prompts/` directory as separate markdown files
2. **Update agents** to load prompts from files instead of hardcoded strings
3. **Enhance Builder Agent prompts** with:
   - React Router v6 examples (Routes, element={})
   - Real UI examples (not placeholders)
   - File creation order
   - Error handling instructions
4. **Integrate QualityReviewer** into Builder Agent's task execution loop
5. **Update Todo Agent** to enforce detailed task descriptions
6. **Add error recovery** to Builder Agent's agent loop

## CONSTRAINTS
- Keep all agent interfaces (execute method signature) unchanged
- Maintain backward compatibility with orchestrator.py
- Don't change the LLM provider (gpt-5.4) or model routing
- Keep workspace_manager and websocket_manager integrations working

## TESTING CHECKLIST
After fixes, verify:
- [ ] Manager Agent correctly identifies missing context
- [ ] Questions Agent asks non-redundant questions
- [ ] Planner Agent creates detailed markdown plans
- [ ] Todo Agent generates 3-15 granular tasks with file paths
- [ ] Builder Agent writes React Router v6 code (NOT v5)
- [ ] Builder Agent generates real UI (NOT placeholders)
- [ ] QualityReviewer catches issues before task completion
- [ ] All imports in App.jsx match actual files
- [ ] No orphan components in workspace
- [ ] Runner Agent deploys to sandbox successfully on port 9999
```

---

## Quick Reference: What's Broken

| Issue | File | Line | Problem |
|-------|------|------|---------|
| Embedded prompts | All agent files | execute() | System prompts hardcoded in Python |
| Vague tasks | todo_agent.py | 122-173 | Task descriptions too generic |
| Unused reviewer | builder_agent.py | - | QualityReviewer never called |
| No error recovery | builder_agent.py | 86-165 | Agent loop has no retry |
| Router v5 syntax | builder_agent.py | 304-326 | Frontend prompt lacks v6 examples |
| Placeholder UI | builder_agent.py | 304-326 | No real UI examples in prompt |

---

## Expected Output

After the fix, the system should:
1. Generate valid React Router v6 code (Routes, element={} NOT Switch, component={})
2. Never output placeholder components (<h1>Home Page</h1>)
3. Always include App.jsx when creating components
4. Deploy successfully to sandbox on port 9999
5. Have all system prompts in separate markdown files
6. Use QualityReviewer to validate each task
