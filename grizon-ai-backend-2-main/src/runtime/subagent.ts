import { getPool } from "../db/pool.js";
import { logger } from "../utils/logger.js";
import { callSystemModel, type SystemModelTier } from "./systemModel.js";
import { recordCostItem } from "../services/messageCostItems.service.js";

type SubagentTask = "summarise_pages" | "extract_facts" | "compare_documents";
type SubagentTier = "nano" | "standard" | "high";

const SUBAGENT_TIER_MAP: Record<SubagentTier, SystemModelTier> = {
  nano: "light",
  standard: "medium",
  high: "high",
};

export interface SubagentInput {
  task: SubagentTask;
  inputs: unknown;
  parentJobId: string;
  modelTier?: SubagentTier;
  maxOutputTokens?: number;
  /** Caller provides these so subagent runs are linked to the parent message */
  messageId?: string | null;
  userId?: string | null;
  conversationId?: string | null;
  agentSlug?: string | null;
}

export interface SubagentResult {
  summary: string;
  tokensUsed: number;
  creditsUsed: number;
  durationMs: number;
}

const TASK_PROMPTS: Record<SubagentTask, string> = {
  summarise_pages:
    "You are a concise summariser. Given web page content, produce a 3-bullet summary. Be factual and brief.",
  extract_facts: "You are a fact extractor. Given a document excerpt, list the key facts as bullet points.",
  compare_documents: "You are a document analyst. Given two document excerpts, compare them on key dimensions.",
};

function estimateCredits(inputTokens: number, outputTokens: number): number {
  return Number((((inputTokens * 0.001) + (outputTokens * 0.002)) / 1000).toFixed(4));
}

export async function spawnSubagent(input: SubagentInput): Promise<SubagentResult> {
  const start = Date.now();
  const userMessage = typeof input.inputs === "string" ? input.inputs : JSON.stringify(input.inputs);
  const maxTokens = Math.min(input.maxOutputTokens ?? 300, 800);

  const result = await callSystemModel({
    tier: SUBAGENT_TIER_MAP[input.modelTier ?? "standard"],
    systemPrompt: TASK_PROMPTS[input.task],
    userMessage,
    maxTokens,
  });

  const summary = result.text;
  const inputTokens = result.inputTokens;
  const outputTokens = result.outputTokens;
  const creditsUsed = estimateCredits(inputTokens, outputTokens);
  const durationMs = Date.now() - start;

  const pool = getPool();
  let subagentRunId: string | null = null;
  await pool
    .query(
      `
      INSERT INTO subagent_runs (parent_job_id, task, model, input_tokens, output_tokens, credits_used, duration_ms, message_id, job_id, agent_slug)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      RETURNING id
      `,
      [input.parentJobId, input.task, result.model, inputTokens, outputTokens, creditsUsed, durationMs,
       input.messageId ?? null, input.parentJobId, input.agentSlug ?? null],
    )
    .then((r: { rows: unknown[] }) => { subagentRunId = (r.rows[0] as { id: string } | undefined)?.id ?? null; })
    .catch((error: unknown) =>
      logger.warn({ err: error, parentJobId: input.parentJobId }, "subagent_run_insert_failed"),
    );

  await pool
    .query(
      `
      UPDATE api_calls
      SET metadata = jsonb_set(
        COALESCE(metadata, '{}'::jsonb),
        '{subagentCost}',
        to_jsonb(COALESCE((metadata->>'subagentCost')::numeric, 0) + $2::numeric)
      )
      WHERE request_id = $1
      `,
      [input.parentJobId, creditsUsed],
    )
    .catch((error: unknown) =>
      logger.warn({ err: error, parentJobId: input.parentJobId }, "subagent_cost_update_failed"),
    );

  if (input.messageId && input.userId) {
    recordCostItem({
      messageId: input.messageId,
      jobId: input.parentJobId,
      userId: input.userId,
      conversationId: input.conversationId,
      agentSlug: input.agentSlug,
      itemType: "subagent",
      component: input.task,
      modelId: result.model,
      inputTokens,
      outputTokens,
      latencyMs: durationMs,
      refTable: subagentRunId ? "subagent_runs" : null,
      refId: subagentRunId as unknown as string | null,
      metadata: { task: input.task, tier: input.modelTier ?? "standard" },
    });
  }

  return {
    summary,
    tokensUsed: inputTokens + outputTokens,
    creditsUsed,
    durationMs,
  };
}
