-- Migration 042: Seed system agents into the agents table.
-- System agents are internal routing agents (is_system = true, is_visible = false).
-- They power auto-routing but never appear in the user-facing catalogue.
--
-- After this migration, agentLoader.service.ts will load them from DB on startup
-- and the static *.agent.ts fallback bridge (agentDispatcher.ts) can be removed.
--
-- Run migration 041 first (adds allowed_tools, fallback_agent, max_tool_rounds,
-- max_tokens_per_message, is_system columns).

INSERT INTO agents (
  slug, display_name, description, system_prompt,
  allowed_tools, fallback_agent, max_tool_rounds, max_tokens_per_message,
  is_system, is_visible, is_active, is_auto_eligible,
  cost_multiplier, max_context_messages, sort_order
)
VALUES
  -- chat
  (
    'chat',
    'Chat',
    'General-purpose conversational assistant.',
    'You are a helpful assistant. Be concise, accurate, and friendly. Follow the user''s instructions.',
    ARRAY['weatherData','stockData'],
    NULL,
    10, NULL, true, false, true, true,
    1.0, 20, 0
  ),
  -- research
  (
    'research',
    'Research',
    'Web research with citations.',
    'You are a research assistant. Prefer authoritative sources; cite URLs when using web search results. Use inline [1], [2] citations tied to web_search results where appropriate.',
    ARRAY['webSearch','webFetch','documentCreation'],
    'chat',
    15, NULL, true, false, true, true,
    1.5, 20, 0
  ),
  -- deep_research
  (
    'deep_research',
    'Deep Research',
    'Exhaustive multi-step research with file reading.',
    'You are a Deep Research Agent. Conduct thorough, multi-step research.

RESEARCH PROCESS:
1. Search using web_search with priority="high" when helpful for richer results.
2. Identify the most relevant URLs from search results (typically 3–5).
3. Use web_fetch to read key URLs in depth where needed.
4. Use file_read when the user attached documents or needs corpus context.
5. Synthesise across sources. Present findings with inline citations [1], [2], etc.

STRICT GROUNDING:
Only state facts supported by retrieved sources or attachments. If a source lacks the answer, say so.

OUTPUT FORMAT (suggested):
## Summary
Brief overview.

## Findings
Detailed findings with [n] citations.

## Sources
[1] Title — URL',
    ARRAY['webSearch','webFetch','documentAnalysis','documentCreation'],
    'research',
    20, NULL, true, false, true, true,
    2.0, 30, 0
  ),
  -- code
  (
    'code',
    'Code',
    'Code generation, review, and execution.',
    'You are a coding assistant. Prefer readable, idiomatic code and explain trade-offs briefly.',
    ARRAY['codeExecution','documentAnalysis'],
    'chat',
    10, NULL, true, false, true, true,
    1.2, 20, 0
  ),
  -- writer
  (
    'writer',
    'Writer',
    'Long-form writing, editing, and document creation.',
    'You are a writing assistant focused on clarity, tone, and structure.',
    ARRAY['documentCreation','weatherData'],
    'chat',
    10, NULL, true, false, true, true,
    1.0, 20, 0
  ),
  -- analyst
  (
    'analyst',
    'Analyst',
    'Data analysis, charts, and insights.',
    'You are a Data Analyst AI. You analyse data, generate charts, and provide insights.',
    ARRAY['documentAnalysis','codeExecution','chartGenerate','stockData','documentCreation'],
    'chat',
    10, NULL, true, false, true, true,
    1.3, 20, 0
  ),
  -- architect
  (
    'architect',
    'Architect',
    'System design, architecture planning, and technical decisions.',
    'You are a System Architecture AI. You design scalable, production-ready systems.',
    ARRAY['webSearch','documentAnalysis'],
    'chat',
    10, NULL, true, false, true, true,
    1.5, 20, 0
  ),
  -- debugger
  (
    'debugger',
    'Debugger',
    'Bug hunting, root cause analysis, and fixes.',
    'You are a debugging assistant. Reproduce issues mentally, narrow causes, and suggest minimal fixes.',
    ARRAY['codeExecution','documentAnalysis'],
    'code',
    10, NULL, true, false, true, true,
    1.2, 20, 0
  ),
  -- ui
  (
    'ui',
    'UI Generator',
    'Generate complete, self-contained HTML/CSS/JS interfaces.',
    'You are a UI Generator AI. You create clean, working HTML/CSS/JS interfaces.

RULES:
- Output complete, self-contained HTML (no external CDN dependencies unless explicitly requested)
- Use modern CSS (flexbox/grid) — no Bootstrap or Tailwind by default
- JavaScript should be vanilla or minimal (no React/Vue unless requested)
- The output will be rendered in a sandboxed iframe — no localStorage, cookies, or fetch calls

ALWAYS use html_generate to output the interface. Never output raw HTML in the chat message.

After generating, describe what you built in 1-2 sentences.',
    ARRAY['htmlPreview'],
    'code',
    4, NULL, true, false, true, true,
    1.3, 10, 0
  ),
  -- document
  (
    'document',
    'Document',
    'Read, analyse, and generate documents and files.',
    'You are a document assistant. Produce structured outputs and export artifacts when requested.',
    ARRAY['documentAnalysis','documentCreation','imageAnalyse'],
    'chat',
    10, NULL, true, false, true, true,
    1.2, 20, 0
  )
ON CONFLICT (slug) DO UPDATE SET
  allowed_tools           = EXCLUDED.allowed_tools,
  fallback_agent          = EXCLUDED.fallback_agent,
  max_tool_rounds         = EXCLUDED.max_tool_rounds,
  is_system               = EXCLUDED.is_system,
  is_visible              = EXCLUDED.is_visible,
  cost_multiplier         = EXCLUDED.cost_multiplier,
  max_context_messages    = EXCLUDED.max_context_messages,
  updated_at              = now();
