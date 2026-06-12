/**
 * Typed seed data for all agents (system + catalogue).
 * Aligned with migration 041 DB schema.
 *
 * This file is NOT automatically applied to the DB.
 * To seed: insert/update rows in the `agents` table using these values,
 * and populate `agent_model_priorities` for each agent.
 *
 * allowed_tools uses feature-flag camelCase keys (same namespace as allowed_features):
 *   web_search → webSearch | code_execution → codeExecution | file_read → documentAnalysis
 *   file_gen   → documentCreation | web_fetch → webFetch    | html_generate → htmlPreview
 *   chart_generate → chartGenerate | image_analyse → imageAnalyse
 *   stock_data → stockData | get_weather → weatherData
 */

export interface AgentSeedRow {
  slug: string;
  displayName: string;
  description: string;
  systemPrompt: string;
  /** Feature-flag camelCase keys (e.g. "webSearch", "imageAnalyse"). */
  allowedTools: string[];
  /** Ordered model IDs for agent_model_priorities — index = priority (0 = highest). */
  modelPriority: string[];
  fallbackAgent: string | null;
  maxToolRounds: number;
  maxTokensPerMessage: number | null;
  maxContextMessages: number | null;
  costMultiplier: number;
  isSystem: boolean;
}

// ─── System agents (is_system = true) ────────────────────────────────────────

export const SYSTEM_AGENT_SEEDS: AgentSeedRow[] = [
  {
    slug: "chat",
    displayName: "Chat",
    description: "General-purpose conversational assistant.",
    systemPrompt: "You are a helpful, thoughtful AI assistant. Be concise and clear.",
    allowedTools: ["weatherData", "stockData"],
    modelPriority: ["claude-haiku-4-5"],
    fallbackAgent: null,
    maxToolRounds: 10,
    maxTokensPerMessage: null,
    maxContextMessages: 20,
    costMultiplier: 1.0,
    isSystem: true,
  },
  {
    slug: "research",
    displayName: "Research",
    description: "Deep research with web search and citations.",
    systemPrompt:
      "You are a research assistant. Prefer authoritative sources; cite URLs when using web search results. Use inline [1], [2] citations tied to web_search results where appropriate.",
    allowedTools: ["webSearch", "webFetch", "documentCreation"],
    modelPriority: ["claude-sonnet-4-6", "claude-haiku-4-5"],
    fallbackAgent: "chat",
    maxToolRounds: 15,
    maxTokensPerMessage: null,
    maxContextMessages: 20,
    costMultiplier: 1.5,
    isSystem: true,
  },
  {
    slug: "deep_research",
    displayName: "Deep Research",
    description: "Exhaustive research with file reading and extended search.",
    systemPrompt:
      "You are an expert research analyst. Conduct thorough research using multiple sources. Read files, fetch web pages, and generate comprehensive reports with proper citations [1], [2], etc.",
    allowedTools: ["webSearch", "webFetch", "documentAnalysis", "documentCreation"],
    modelPriority: ["claude-sonnet-4-6", "claude-haiku-4-5"],
    fallbackAgent: "research",
    maxToolRounds: 20,
    maxTokensPerMessage: null,
    maxContextMessages: 30,
    costMultiplier: 2.0,
    isSystem: true,
  },
  {
    slug: "code",
    displayName: "Code",
    description: "Code generation, review, and execution.",
    systemPrompt:
      "You are an expert software engineer. Write clean, well-documented code. Use code_execution to test your solutions when needed.",
    allowedTools: ["codeExecution", "documentAnalysis"],
    modelPriority: ["claude-sonnet-4-6", "claude-haiku-4-5"],
    fallbackAgent: "chat",
    maxToolRounds: 10,
    maxTokensPerMessage: null,
    maxContextMessages: 20,
    costMultiplier: 1.2,
    isSystem: true,
  },
  {
    slug: "writer",
    displayName: "Writer",
    description: "Long-form writing, editing, and document creation.",
    systemPrompt:
      "You are a professional writer and editor. Produce well-structured, engaging content tailored to the user's tone and goals.",
    allowedTools: ["documentCreation", "weatherData"],
    modelPriority: ["claude-sonnet-4-6", "claude-haiku-4-5"],
    fallbackAgent: "chat",
    maxToolRounds: 10,
    maxTokensPerMessage: null,
    maxContextMessages: 20,
    costMultiplier: 1.0,
    isSystem: true,
  },
  {
    slug: "analyst",
    displayName: "Analyst",
    description: "Data analysis, charts, and insights.",
    systemPrompt:
      "You are a data analyst. Analyse data, produce charts, and provide actionable insights. Use code_execution for calculations and chart_generate for visualisations.",
    allowedTools: ["documentAnalysis", "codeExecution", "chartGenerate", "stockData", "documentCreation"],
    modelPriority: ["claude-sonnet-4-6", "claude-haiku-4-5"],
    fallbackAgent: "chat",
    maxToolRounds: 10,
    maxTokensPerMessage: null,
    maxContextMessages: 20,
    costMultiplier: 1.3,
    isSystem: true,
  },
  {
    slug: "architect",
    displayName: "Architect",
    description: "System design, architecture planning, and technical decisions.",
    systemPrompt:
      "You are a senior software architect. Design scalable, maintainable systems. Research best practices, analyse trade-offs, and provide clear diagrams and documentation.",
    allowedTools: ["webSearch", "documentAnalysis"],
    modelPriority: ["claude-sonnet-4-6", "claude-haiku-4-5"],
    fallbackAgent: "chat",
    maxToolRounds: 10,
    maxTokensPerMessage: null,
    maxContextMessages: 20,
    costMultiplier: 1.5,
    isSystem: true,
  },
  {
    slug: "debugger",
    displayName: "Debugger",
    description: "Bug hunting, root cause analysis, and fixes.",
    systemPrompt:
      "You are an expert debugger. Identify root causes systematically, reproduce issues, and provide precise fixes with explanations.",
    allowedTools: ["codeExecution", "documentAnalysis"],
    modelPriority: ["claude-sonnet-4-6", "claude-haiku-4-5"],
    fallbackAgent: "chat",
    maxToolRounds: 10,
    maxTokensPerMessage: null,
    maxContextMessages: 20,
    costMultiplier: 1.2,
    isSystem: true,
  },
  {
    slug: "ui",
    displayName: "UI Generator",
    description: "Generate complete, self-contained HTML/CSS/JS interfaces.",
    systemPrompt: `You are a UI Generator AI. You create clean, working HTML/CSS/JS interfaces.

RULES:
- Output complete, self-contained HTML (no external CDN dependencies unless explicitly requested)
- Use modern CSS (flexbox/grid) — no Bootstrap or Tailwind by default
- JavaScript should be vanilla or minimal (no React/Vue unless requested)
- The output will be rendered in a sandboxed iframe — no localStorage, cookies, or fetch calls

ALWAYS use html_generate to output the interface. Never output raw HTML in the chat message.

After generating, describe what you built in 1-2 sentences.`,
    allowedTools: ["htmlPreview"],
    modelPriority: ["claude-sonnet-4-6"],
    fallbackAgent: "code",
    maxToolRounds: 4,
    maxTokensPerMessage: null,
    maxContextMessages: 10,
    costMultiplier: 1.3,
    isSystem: true,
  },
  {
    slug: "document",
    displayName: "Document",
    description: "Read, analyse, and generate documents and files.",
    systemPrompt:
      "You are a document specialist. Read, summarise, and generate documents. Extract key information, identify patterns, and produce structured outputs.",
    allowedTools: ["documentAnalysis", "documentCreation", "imageAnalyse"],
    modelPriority: ["claude-sonnet-4-6", "claude-haiku-4-5"],
    fallbackAgent: "chat",
    maxToolRounds: 10,
    maxTokensPerMessage: null,
    maxContextMessages: 20,
    costMultiplier: 1.2,
    isSystem: true,
  },
];

// ─── Catalogue agents — UPDATE values (is_system = false already) ─────────────
// These are the product-facing agents already in the DB.
// Run UPDATE statements to set allowed_tools, fallback_agent, max_tool_rounds.

export const CATALOGUE_AGENT_UPDATES: Array<Pick<
  AgentSeedRow,
  "slug" | "allowedTools" | "modelPriority" | "fallbackAgent" | "maxToolRounds" | "maxContextMessages"
>> = [
  {
    slug: "general",
    // allowed_features already has ["webSearch","imageAnalyse"] — aligned
    allowedTools: ["webSearch", "imageAnalyse"],
    modelPriority: ["claude-sonnet-4-6", "claude-haiku-4-5"],
    fallbackAgent: "chat",
    maxToolRounds: 10,
    maxContextMessages: 20,
  },
  {
    slug: "claude-haiku",
    allowedTools: ["weatherData", "stockData"],
    modelPriority: ["claude-haiku-4-5"],
    fallbackAgent: "chat",
    maxToolRounds: 10,
    maxContextMessages: 20,
  },
  {
    slug: "gemini-flash",
    allowedTools: ["weatherData", "stockData"],
    modelPriority: ["gemini-2.5-flash", "gemini-flash"],
    fallbackAgent: "chat",
    maxToolRounds: 10,
    maxContextMessages: 20,
  },
];
