---
name: Credit Wallet & Pricing System
description: How the credit system works — formula, model rates, agent multipliers, plan discounts
type: project
originSessionId: 0c9d0c8e-5e36-4f0a-89fe-e618574d9cee
---
The platform uses a **Credit Unit** abstraction instead of raw tokens. This decouples user-facing pricing from provider token costs and allows repricing without code changes.

**Formula:** `credits = ceil( (input_tokens + output_tokens) × model_rate × agent_multiplier × plan_discount )`

**Model credit rates (per 1K tokens):**
- Nano (Haiku 4.5, GPT-4o-mini, Gemini Flash Lite): 0.5×
- Standard (Sonnet 4.6, Gemini Flash, GPT-4o): 1.0×
- Premium (GPT-4o complex, Gemini Pro): 2.0×
- Frontier (Opus 4.7, GPT-4, Gemini Ultra): 5.0×
- Reasoning (o1, Gemini 2.5 Pro Thinking): 8.0×

**Agent multipliers:**
- Chat, Writer: 1.0×
- Code Assistant: 1.2×
- Document, Data Analyst: 1.2–1.3×
- Research Agent: 1.5×
- Architect: 1.5×
- Deep Research: 2.0×

**Plan discounts:** Free=1.0×, Starter=0.95×, Pro=0.85×, Enterprise=0.70×

**All rates live in the `ai_models` and `agents` DB tables — editable from Admin Panel with no deploy needed.**

**Optimistic hold:** On job start, `wallet.pending += estimated_cost`. On completion, confirmed and moved to `lifetime_spent`. On failure, hold is released.

**Insufficient credits:** Return 402 with `{ creditsNeeded, creditsAvailable, topupUrl }`. Never call LLM.

**How to apply:** When estimating costs or building the credit calculator service, use this formula. When the user asks about pricing tweaks, always point to the DB config approach — not hardcoded values.
