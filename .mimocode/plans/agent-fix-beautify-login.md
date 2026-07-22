# Fix Agents + Beautify Login + Improve Code Generation

## Context

The user has a Grizon AI workspace with a Node.js backend and Next.js frontend. Two critical issues:
1. **Backend agents produce weak code** — system prompts are 1-liners, no guidance on file structure, modular output, or artifact format
2. **Auth modal is visually plain** — just basic form fields, needs glassmorphism/glow effects to match the rest of the premium UI

## Root Cause Analysis

### Backend Agent Prompts (THE BIG ISSUE)
- `agentData.ts` seeds agents with minimal prompts like "You are an expert software engineer. Write clean, well-documented code."
- `router/index.ts:173` injects `agent.systemPrompt` but there's **no per-agent code generation instructions**
- No guidance on: output format, file structure, component separation, artifact tags, tech stack preference
- The UI agent (`ui.agent.ts`) has 94 lines of detailed rules — all other agents have ~1 line
- Result: agents produce short, unfocused responses and don't generate full modular files

### Frontend Auth Modal
- `AuthModal.tsx` uses basic `rounded-2xl border bg-input` styling — no gradient, no glass, no glow
- Rest of the app uses premium glassmorphism (`glass-container`, `stream-glow`, gradient borders)
- Auth modal is the **first thing users see** — needs to match the premium brand

## Plan

### 1. Backend: Add Comprehensive Agent Instructions (agentInstructions.ts)
**File**: `src/agents/agentInstructions.ts` (NEW)

Create a mapping of agent slugs to detailed generation instructions. Each agent gets:
- **Role definition**: What it does and its specialty
- **Code generation format**: How to structure output (files, components, modules)
- **Artifact/output guidance**: When to use code blocks, when to create full files
- **Quality rules**: Modularity, naming, documentation standards
- **Tech preferences**: Stack choices (React, Tailwind, etc.)

Agents to cover:
- `code` — Full-stack code generation with file structure
- `general` / `chat` — General assistant with code capability
- `ui` — Already has good rules, keep as reference
- `architect` — System design and architecture
- `debugger` — Bug analysis and fixes
- `analyst` — Data analysis with charts
- `research` — Research with citations
- `writer` — Document generation
- `document` — Document specialist

### 2. Backend: Inject Agent Instructions into System Prompt
**File**: `src/router/index.ts`

Modify `runRouter()` to append agent-specific instructions from the new mapping:
```typescript
import { getAgentInstructions } from '../agents/agentInstructions.js';

// After line 173 (systemPrompt assembly):
const agentInstructions = getAgentInstructions(agent.slug);
if (agentInstructions) {
  systemPrompt += `\n\n${agentInstructions}`;
}
```

### 3. Frontend: Redesign AuthModal
**File**: `components/auth/AuthModal.tsx`

Upgrade the modal to match the premium design system:
- **Glass background**: `backdrop-blur-xl bg-surface-1/80` with gradient border
- **Logo section**: Add Grizon AI logo with glow effect at top
- **Gradient accent**: Subtle purple-to-blue gradient on the header area
- **Input styling**: Glass-style inputs with focus glow (`focus:shadow-[0_0_20px_rgba(151,109,248,0.15)]`)
- **Button**: Premium gradient button with hover glow
- **Transitions**: Smooth step transitions with fade-in animations
- **Error states**: Red glow on validation errors

Keep ALL existing logic (email check flow, password validation, cooldown, etc.) — purely visual upgrade.

### 4. Frontend: Improve Landing Hero Input
**File**: `components/landing/Hero.tsx`

Minor polish to the landing input:
- Add subtle glow shadow on the send button
- Improve the glass container border with gradient

### 5. Backend: Update DB Agent Prompts (seed.ts)
**File**: `src/db/seed.ts`

Update the `systemPrompt` values in `SYSTEM_AGENT_SEEDS` to be more descriptive (not just 1-liners). These serve as the base prompts that get loaded into the DB.

## Files to Touch

| File | Action | Purpose |
|------|--------|---------|
| `grizon-ai-backend-2-main/src/agents/agentInstructions.ts` | CREATE | Per-agent code generation instructions |
| `grizon-ai-backend-2-main/src/router/index.ts` | EDIT | Inject agent instructions into system prompt |
| `grizon-ai-backend-2-main/src/db/seed.ts` | EDIT | Update agent systemPrompt values |
| `Grizon-AI-Frontend-v2-api-2/components/auth/AuthModal.tsx` | EDIT | Beautiful glassmorphism login redesign |

## Verification

1. **Backend**: After changes, the system prompt for each agent should contain both the base prompt AND the detailed instructions
2. **Frontend**: Auth modal should show glass background, gradient accents, logo, and premium button styling
3. **No regressions**: Auth flow (email check → login/register → forgot password) must still work
4. **Tailwind**: All new classes must use the existing `@theme inline` tokens (accent, surface-*, border-*, text-*)
