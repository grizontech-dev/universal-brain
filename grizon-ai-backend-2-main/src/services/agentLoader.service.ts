/**
 * DB-driven agent cache.
 *
 * Replaces the hardcoded AGENT_CATALOGUE TypeScript map.
 * Loaded once at app startup; refreshed every 5 minutes and on any admin write.
 *
 * Model priority is read from the `agent_model_priorities` join table
 * (already queried by modelSelector.ts via agentSlug — no duplicate query here).
 */

import { getPool } from "../db/pool.js";
import { logger } from "../utils/logger.js";
import type { AgentDescriptor, AgentHooks, ToolBudgets, ToolId } from "../types/router.js";

// Populated by Phase 4 hooks.ts import below (lazy to avoid circular deps).
let AGENT_HOOKS: Record<string, AgentHooks> = {};

/** Call once after initAgentLoader to register hook implementations. */
export function registerAgentHooks(hooks: Record<string, AgentHooks>): void {
  AGENT_HOOKS = hooks;
}

// ─── In-memory cache ──────────────────────────────────────────────────────────

let cache = new Map<string, AgentDescriptor>();
let refreshTimer: ReturnType<typeof setInterval> | null = null;

// ─── DB query ─────────────────────────────────────────────────────────────────

interface AgentRow {
  slug: string;
  display_name: string;
  description: string;
  system_prompt: string;
  allowed_tools: string[];
  fallback_agent: string | null;
  max_tool_rounds: number;
  tool_budgets: Record<string, unknown> | null;
  max_tokens_per_message: number | null;
  max_context_messages: number | null;
  cost_multiplier: string; // NUMERIC comes back as string from pg
  is_system: boolean;
  is_auto_eligible: boolean;
  model_priority: string[]; // aggregated from agent_model_priorities
}

const KNOWN_TOOL_IDS: ToolId[] = [
  "web_search",
  "web_fetch",
  "code_execution",
  "file_read",
  "file_gen",
  "html_generate",
  "chart_generate",
  "image_analyse",
  "stock_data",
  "get_weather",
];

function normaliseToolBudgets(input: Record<string, unknown> | null | undefined): ToolBudgets {
  const out: ToolBudgets = {};
  if (!input || typeof input !== "object") return out;
  for (const id of KNOWN_TOOL_IDS) {
    const raw = input[id];
    if (raw === undefined || raw === null) continue;
    const n = Number(raw);
    if (Number.isFinite(n)) out[id] = Math.max(0, Math.floor(n));
  }
  return out;
}

const LOAD_QUERY = `
  SELECT
    a.slug,
    a.display_name,
    a.description,
    a.system_prompt,
    a.allowed_tools,
    a.fallback_agent,
    a.max_tool_rounds,
    a.tool_budgets,
    a.max_tokens_per_message,
    a.max_context_messages,
    a.cost_multiplier,
    a.is_system,
    a.is_auto_eligible,
    COALESCE(
      ARRAY_AGG(amp.model_id ORDER BY amp.priority ASC)
        FILTER (WHERE amp.model_id IS NOT NULL AND amp.is_active = true),
      ARRAY[]::text[]
    ) AS model_priority
  FROM agents a
  LEFT JOIN agent_model_priorities amp ON amp.agent_id = a.id
  WHERE a.is_active = true
  GROUP BY
    a.id, a.slug, a.display_name, a.description, a.system_prompt, a.allowed_tools, a.fallback_agent,
    a.max_tool_rounds, a.tool_budgets, a.max_tokens_per_message, a.max_context_messages,
    a.cost_multiplier, a.is_system, a.is_auto_eligible
  ORDER BY a.slug
`;

function rowToDescriptor(row: AgentRow): AgentDescriptor {
  const base: AgentDescriptor = {
    slug: row.slug,
    displayName: row.display_name,
    description: row.description,
    systemPrompt: row.system_prompt,
    allowedTools: Array.isArray(row.allowed_tools) ? row.allowed_tools : [],
    modelPriority: Array.isArray(row.model_priority) ? row.model_priority : [],
    fallbackAgent: row.fallback_agent ?? null,
    costMultiplier: Number(row.cost_multiplier ?? 1.0),
    maxToolRounds: Number(row.max_tool_rounds ?? 10),
    toolBudgets: normaliseToolBudgets(row.tool_budgets),
    maxTokensPerMessage: row.max_tokens_per_message != null ? Number(row.max_tokens_per_message) : null,
    maxContextMessages: row.max_context_messages != null ? Number(row.max_context_messages) : null,
    isSystem: Boolean(row.is_system),
    isAutoEligible: Boolean(row.is_auto_eligible),
  };

  // Attach runtime hooks (preflight / postProcess) if registered for this slug.
  const hooks = AGENT_HOOKS[row.slug];
  if (hooks?.preflight) base.preflight = hooks.preflight;
  if (hooks?.postProcess) base.postProcess = hooks.postProcess;

  return base;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Load all active agents from DB into the in-memory cache.
 * Call once at app startup before the HTTP server starts.
 * Automatically schedules a 5-minute background refresh.
 */
export async function initAgentLoader(): Promise<void> {
  await reloadAgentCache();

  if (!refreshTimer) {
    refreshTimer = setInterval(
      () => {
        reloadAgentCache().catch((err) =>
          logger.warn({ err }, "agent_loader:refresh_failed"),
        );
      },
      5 * 60 * 1000, // 5 minutes
    );
    // Don't prevent Node from exiting if only the timer remains.
    refreshTimer.unref?.();
  }

  logger.info({ agentCount: cache.size }, "agent_loader:initialized");
}

/** Reload cache from DB immediately (call after admin CREATE/UPDATE/DELETE). */
export async function reloadAgentCache(): Promise<void> {
  try {
    const pool = getPool();
    const res = await pool.query(LOAD_QUERY);
    const rows = res.rows as AgentRow[];

    const next = new Map<string, AgentDescriptor>();
    for (const row of rows) {
      next.set(row.slug, rowToDescriptor(row));
    }
    cache = next;
    logger.debug({ agentCount: cache.size }, "agent_loader:cache_refreshed");
  } catch (err) {
    logger.error({ err }, "agent_loader:reload_failed");
    // Keep the stale cache rather than wiping it on transient DB errors.
  }
}

/** Synchronous lookup — returns undefined if slug not found or cache not yet initialised. */
export function getAgentDescriptor(slug: string): AgentDescriptor | undefined {
  return cache.get(slug);
}

/** All active agents (system + catalogue). */
export function getAllAgentDescriptors(): AgentDescriptor[] {
  return [...cache.values()];
}

/** Slugs of system-internal agents (is_system = true). */
export function getSystemAgentSlugs(): string[] {
  return [...cache.values()].filter((a) => a.isSystem).map((a) => a.slug);
}
