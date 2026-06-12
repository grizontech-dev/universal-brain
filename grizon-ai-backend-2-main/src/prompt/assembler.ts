import { getPool } from "../db/pool.js";
import { hydrateSession } from "../memory/session.memory.js";
import { summariserService } from "../services/summariser.service.js";
import type { ProviderMessage, ToolSpec } from "../types/router.js";
import { logger } from "../utils/logger.js";

const DEFAULT_MAX_CONTEXT_MESSAGES = 20;
const DEFAULT_MODEL_CONTEXT_TOKENS = 80000;

interface AgentPromptLimits {
  maxContextMessages: number;
  maxContextTokens: number;
}

type AnthropicSystemBlock = {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral" };
};

export interface PromptAssemblyContext {
  agentSlug: string;
  systemPrompt: string;
  toolDefinitions: ToolSpec[];
  conversationHistory: ProviderMessage[];
  userQuery: string;
  retrievedContext?: string;
  planSlug: string;
  provider: string;
  conversationId?: string;
  modelId?: string;
}

export interface PromptSectionEstimates {
  /** Conversation history passed to LLM (estimated) */
  contextTokens: number;
  /** Current user query + retrieved context (estimated) */
  messageTokens: number;
  /** System prompt + tool definitions (estimated) */
  systemTokens: number;
}

export interface AssembledPrompt {
  system: string | AnthropicSystemBlock[];
  messages: ProviderMessage[];
  estimatedTokens: number;
  compactionApplied: boolean;
  sectionEstimates: PromptSectionEstimates;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

async function getAgentLimits(agentSlug: string): Promise<AgentPromptLimits> {
  const pool = getPool();
  const res = await pool.query(
    `SELECT max_context_messages, max_context_tokens FROM agents WHERE slug = $1 LIMIT 1`,
    [agentSlug],
  );
  if (!res.rowCount) {
    return {
      maxContextMessages: DEFAULT_MAX_CONTEXT_MESSAGES,
      maxContextTokens: DEFAULT_MODEL_CONTEXT_TOKENS,
    };
  }
  const row = res.rows[0] as { max_context_messages?: number; max_context_tokens?: number };
  return {
    maxContextMessages: Number(row.max_context_messages ?? DEFAULT_MAX_CONTEXT_MESSAGES),
    maxContextTokens: Number(row.max_context_tokens ?? DEFAULT_MODEL_CONTEXT_TOKENS),
  };
}

async function getModelContextLimit(modelId?: string): Promise<number> {
  if (!modelId) return DEFAULT_MODEL_CONTEXT_TOKENS;
  const pool = getPool();
  const res = await pool.query(`SELECT context_window FROM ai_models WHERE model_id = $1 LIMIT 1`, [modelId]);
  if (!res.rowCount) return DEFAULT_MODEL_CONTEXT_TOKENS;
  const row = res.rows[0] as { context_window?: number | null };
  return Number(row.context_window ?? DEFAULT_MODEL_CONTEXT_TOKENS);
}

/** Used ONLY for token estimation — tool specs are passed natively via the `tools` API param. */
function estimateToolTokens(toolDefinitions: ToolSpec[]): number {
  if (!toolDefinitions.length) return 0;
  return estimateTokens(JSON.stringify(toolDefinitions));
}

function trimHistory(history: ProviderMessage[], limit: number): ProviderMessage[] {
  if (history.length <= limit) return history;
  return history.slice(-limit);
}

function historyToText(history: ProviderMessage[]): string {
  return history.map((m) => `${m.role}: ${m.content}`).join("\n");
}

function estimatePromptBody(ctx: PromptAssemblyContext, history: ProviderMessage[]): number {
  return (
    estimateTokens(`${ctx.systemPrompt}\n${historyToText(history)}\n${ctx.retrievedContext ?? ""}\n${ctx.userQuery}`) +
    estimateToolTokens(ctx.toolDefinitions)
  );
}

function estimateSections(ctx: PromptAssemblyContext, history: ProviderMessage[]): PromptSectionEstimates {
  return {
    systemTokens: estimateTokens(ctx.systemPrompt) + estimateToolTokens(ctx.toolDefinitions),
    contextTokens: estimateTokens(historyToText(history)),
    messageTokens: estimateTokens(`${ctx.retrievedContext ?? ""}\n${ctx.userQuery}`),
  };
}

function applyAnthropicBreakpoints(
  systemPrompt: string,
  _toolDefinitions: ToolSpec[],
  messages: ProviderMessage[],
): { system: AnthropicSystemBlock[]; messages: ProviderMessage[] } {
  // Tool specs are passed natively via the `tools` API param — do NOT repeat them in the system text.
  const stableSystem = systemPrompt;
  const outMessages = [...messages];
  const currentUserIdx = outMessages.length - 1;
  const stableHistoryIdx = currentUserIdx > 0 ? currentUserIdx - 1 : -1;
  if (stableHistoryIdx >= 0 && outMessages[stableHistoryIdx]?.role === "user") {
    outMessages[stableHistoryIdx] = {
      ...outMessages[stableHistoryIdx],
      content: JSON.stringify({
        text: outMessages[stableHistoryIdx].content,
        cache_control: { type: "ephemeral" },
      }),
    };
  }
  return {
    system: [{ type: "text", text: stableSystem, cache_control: { type: "ephemeral" } }],
    messages: outMessages,
  };
}

export async function assemblePrompt(ctx: PromptAssemblyContext): Promise<AssembledPrompt> {
  const limits = await getAgentLimits(ctx.agentSlug);
  const modelContextLimit = await getModelContextLimit(ctx.modelId);
  const threshold = Math.floor(modelContextLimit * 0.6);

  let history = trimHistory(
    ctx.conversationHistory.filter((m) => m.role === "user" || m.role === "assistant"),
    limits.maxContextMessages,
  );
  let compactionApplied = false;

  let estimatedTokens = estimatePromptBody(ctx, history);

  if (estimatedTokens > threshold) {
    compactionApplied = true;
    if (ctx.conversationId) {
      try {
        if (estimatedTokens > threshold * 1.1) {
          await summariserService.run(ctx.conversationId);
        }
        const refreshed = await hydrateSession(ctx.conversationId, { bypassCache: true });
        history = trimHistory(
          refreshed.filter((m) => m.role === "user" || m.role === "assistant"),
          limits.maxContextMessages,
        );
      } catch (error) {
        logger.warn(
          { err: error, conversationId: ctx.conversationId },
          "prompt_assembler_compaction_failed_falling_back",
        );
        history = history.slice(-Math.max(2, Math.floor(limits.maxContextMessages / 2)));
      }
    } else {
      history = history.slice(-Math.max(2, Math.floor(limits.maxContextMessages / 2)));
    }
    estimatedTokens = estimatePromptBody(ctx, history);
  }

  const hardLimit = Math.floor(modelContextLimit * 0.85);
  if (estimatedTokens > hardLimit) {
    history = history.slice(-3);
    estimatedTokens = estimatePromptBody(ctx, history);
    logger.warn(
      { agentSlug: ctx.agentSlug, estimatedTokens, hardLimit },
      "prompt_assembler_hard_context_limit_triggered",
    );
  }

  const augmentedQuery = ctx.retrievedContext
    ? `KNOWN ABOUT USER:\n${ctx.retrievedContext}\n\nUser query:\n${ctx.userQuery}`
    : ctx.userQuery;
  const messages: ProviderMessage[] = [...history, { role: "user", content: augmentedQuery }];

  const sectionEstimates = estimateSections(ctx, history);

  if (ctx.provider === "anthropic") {
    const anth = applyAnthropicBreakpoints(ctx.systemPrompt, ctx.toolDefinitions, messages);
    return {
      system: anth.system,
      messages: anth.messages,
      estimatedTokens,
      compactionApplied,
      sectionEstimates,
    };
  }

  // Tool specs are passed natively via the `tools` API param — do NOT repeat them in the system text.
  return {
    system: ctx.systemPrompt,
    messages,
    estimatedTokens,
    compactionApplied,
    sectionEstimates,
  };
}
