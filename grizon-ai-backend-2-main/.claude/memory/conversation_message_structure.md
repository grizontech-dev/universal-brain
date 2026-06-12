---
name: Conversation & Message Structure
description: How conversations and messages are structured — like ChatGPT/Claude Desktop with rich metadata
type: project
originSessionId: 0c9d0c8e-5e36-4f0a-89fe-e618574d9cee
---
**Conversation object key fields:**
- `title` — auto-generated or user-set (tracked via `title_generated_at`)
- `default_agent_slug` / `default_model_id` — null = auto-route per message
- `total_tokens_used` — running sum across all messages
- `summarised_up_to_message_id` + `summary_text` — context compaction state
- `pinned_at`, `tags`, `status` (active/archived)

**Message object key fields:**
- `attachedFiles` — files uploaded WITH this specific message (not conversation-level)
- `generatedArtifacts` — artifacts created IN RESPONSE to this message (linked)
- `featuresUsed` — flags: webSearch, fileAnalysis, codeExecution, voiceMode + which agent/model
- `citations` — JSONB array of search citations (if web search was used)
- `credits_deducted` — per-message credit cost displayed in UI
- `is_included_in_summary` — marks messages compacted into rolling summary
- `job_id` — links to BullMQ job for async tracking

**Long conversation handling:**
- 60% context window used → notify user: "Consider starting a new chat or summarising"
- 85% context window used → auto-compact oldest messages via cheap LLM (Haiku/Flash Lite)
- Summary stored in `conversation.summary_text`, compacted message IDs flagged

**Conversation list sidebar item includes:**
- lastMessagePreview (120 chars), messageCount, totalCreditsSpent, attachedFilesCount, hasArtifacts, agentUsed

**How to apply:** When building conversation UI or API endpoints, always include the feature tags and token/credit fields in message responses — the frontend needs these for the per-message metadata display (like ChatGPT's model tag or Claude's feature indicator).
