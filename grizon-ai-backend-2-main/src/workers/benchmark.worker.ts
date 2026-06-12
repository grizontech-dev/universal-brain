import { Worker } from "bullmq";
import { randomUUID } from "crypto";

import { env } from "../config/env.js";
import { getPool } from "../db/pool.js";
import { logger } from "../utils/logger.js";
import type { BenchmarkJobPayload } from "../types/benchmarkJob.js";
import type { Plan } from "../types/plan.js";
import type { ToolId } from "../types/router.js";
import { runRouter, streamCompletion } from "../router/index.js";
import { assemblePrompt } from "../prompt/assembler.js";
import { runToolsBatch } from "../tools/executor.js";
import { toolSpecsFor } from "../router/tools.js";

function buildBenchmarkPlan(agentSlug: string): Plan {
  return {
    id: "benchmark",
    name: "Benchmark",
    slug: "benchmark",
    status: "active",
    isPublic: false,
    isIntroductory: false,
    pricing: { monthly: 0, annual: 0, currency: "inr" },
    credits: {
      included: 999999,
      rollover: false,
      maxRollover: null,
      topupEnabled: false,
      topupPackages: [],
      creditDiscount: 1,
    },
    limits: {
      hourly: 9999,
      daily: 9999,
      weekly: 9999,
      monthly: 9999,
      maxContextMessages: 20,
      maxFileSize: 50 * 1024 * 1024,
      maxFilesPerChat: 10,
      maxArtifactVersions: 5,
    },
    agentAccess: [agentSlug],
    featureFlags: {
      webSearch: true,
      webFetch: true,
      codeExecution: true,
      documentAnalysis: true,
      documentCreation: true,
      htmlPreview: true,
      chartGenerate: true,
      imageAnalyse: true,
      stockData: true,
      weatherData: true,
    },
    createdAt: new Date().toISOString(),
    archivedAt: null,
    createdBy: "benchmark",
  };
}

async function isRunCancelled(runId: string): Promise<boolean> {
  const pool = getPool();
  const r = await pool.query(
    `SELECT status FROM benchmark_runs WHERE id = $1 LIMIT 1`,
    [runId],
  );
  const status = (r.rows[0] as { status: string } | undefined)?.status;
  return status === "cancelled";
}

async function markRunProgress(runId: string, outcome: "completed" | "failed"): Promise<void> {
  const pool = getPool();
  const col = outcome === "completed" ? "completed_cases" : "failed_cases";
  await pool.query(
    `UPDATE benchmark_runs
        SET ${col} = ${col} + 1,
            status = CASE
              WHEN (completed_cases + failed_cases + 1) >= total_cases THEN 'completed'
              ELSE status
            END,
            completed_at = CASE
              WHEN (completed_cases + failed_cases + 1) >= total_cases THEN now()
              ELSE completed_at
            END
      WHERE id = $1 AND status NOT IN ('cancelled', 'completed')`,
    [runId],
  );
}

async function saveResult(args: {
  runId: string;
  caseId: string;
  status: "success" | "failed";
  responseText: string;
  modelUsed: string | null;
  toolsInvoked: string[];
  toolRounds: number;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  errorMessage: string | null;
}): Promise<void> {
  const pool = getPool();
  await pool.query(
    `INSERT INTO benchmark_results
       (run_id, case_id, status, response_text, model_used, tools_invoked, tool_rounds,
        input_tokens, output_tokens, latency_ms, error_message)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      args.runId,
      args.caseId,
      args.status,
      args.responseText,
      args.modelUsed,
      args.toolsInvoked,
      args.toolRounds,
      args.inputTokens,
      args.outputTokens,
      args.latencyMs,
      args.errorMessage,
    ],
  );
}

const BENCHMARK_USER_ID = "00000000-0000-0000-0000-000000000001";

async function processCase(payload: BenchmarkJobPayload): Promise<void> {
  const startedAt = Date.now();

  // Skip if run was cancelled before this job started
  if (await isRunCancelled(payload.runId)) {
    logger.info({ runId: payload.runId, caseId: payload.caseId }, "benchmark_case_skipped_cancelled");
    return;
  }

  const pool = getPool();
  const fakeConversationId = randomUUID();
  const fakeMessageId = randomUUID();

  // Create a temporary conversation row so runRouter's getRecentMessages check passes
  await pool.query(
    `INSERT INTO conversations (id, user_id, title, platform, status)
     VALUES ($1, $2, 'Benchmark Run', 'admin', 'active')`,
    [fakeConversationId, BENCHMARK_USER_ID],
  );

  try {
  const plan = buildBenchmarkPlan(payload.agentSlug);

  const chatPayload = {
    userId: BENCHMARK_USER_ID,
    conversationId: fakeConversationId,
    messageId: fakeMessageId,
    clientMessageId: randomUUID(),
    sessionId: randomUUID(),
    platform: "admin" as const,
    planSnapshot: plan,
    walletHoldId: "",
    content: payload.prompt,
    attachedFileIds: [],
    interactionMode: "agent" as const,
    agentSlug: payload.agentSlug,
    modelId: payload.modelId,
    options: {},
    estimatedTokens: 0,
  };

  logger.info(
    { runId: payload.runId, caseId: payload.caseId, agentSlug: payload.agentSlug, prompt: payload.prompt.slice(0, 80) },
    "benchmark_case_routing",
  );

  const decision = await runRouter(chatPayload);

  logger.info(
    {
      runId: payload.runId,
      caseId: payload.caseId,
      modelId: decision.modelId,
      modelProvider: decision.modelProvider,
      allowedTools: decision.allowedTools,
      agentSlug: decision.agentSlug,
    },
    "benchmark_case_router_decision",
  );

  const toolDefinitions = toolSpecsFor(decision.allowedTools);
  const assembled = await assemblePrompt({
    agentSlug: decision.agentSlug,
    systemPrompt: decision.systemPrompt,
    toolDefinitions,
    conversationHistory: [],
    userQuery: payload.prompt,
    planSlug: "benchmark",
    provider: decision.modelProvider,
    conversationId: fakeConversationId,
    modelId: decision.modelId,
  });

  const abortCtl = new AbortController();
  const ctx = {
    userId: BENCHMARK_USER_ID,
    conversationId: fakeConversationId,
    messageId: fakeMessageId,
    attachedFileIds: [],
    maxArtifactVersions: 5,
    agentSlug: decision.agentSlug,
    queryComplexity: decision.classification.complexity,
    modelId: decision.modelId,
  };

  let fullText = "";
  let modelUsed: string | null = null;
  let inputTokens = 0;
  let outputTokens = 0;
  const toolsInvoked = new Set<string>();
  let toolRounds = 0;
  let currentRoundHasTool = false;

  for await (const ev of streamCompletion(
    decision,
    assembled.messages,
    abortCtl.signal,
    ctx,
    assembled.system,
    {
      runTools: (calls) => {
        const toolIds = calls.map((c) => c.toolId as ToolId);
        toolIds.forEach((t) => toolsInvoked.add(t));
        currentRoundHasTool = true;
        logger.info(
          { runId: payload.runId, caseId: payload.caseId, tools: toolIds },
          "benchmark_case_tool_call",
        );
        return runToolsBatch(calls, ctx, decision.allowedTools);
      },
    },
  )) {
    switch (ev.type) {
      case "chunk":
        if (ev.phase !== "preamble") fullText += ev.delta;
        break;
      case "usage":
        inputTokens += ev.inputTokensFresh + ev.inputTokensCached;
        outputTokens += ev.outputTokens;
        break;
      case "finish":
        modelUsed = ev.modelUsed;
        if (currentRoundHasTool) {
          toolRounds++;
          currentRoundHasTool = false;
        }
        break;
    }
  }

  const latencyMs = Date.now() - startedAt;

  logger.info(
    {
      runId: payload.runId,
      caseId: payload.caseId,
      modelUsed,
      toolsInvoked: [...toolsInvoked],
      toolRounds,
      inputTokens,
      outputTokens,
      latencyMs,
    },
    "benchmark_case_complete",
  );

  await saveResult({
    runId: payload.runId,
    caseId: payload.caseId,
    status: "success",
    responseText: fullText,
    modelUsed,
    toolsInvoked: [...toolsInvoked],
    toolRounds,
    inputTokens,
    outputTokens,
    latencyMs,
    errorMessage: null,
  });
  await markRunProgress(payload.runId, "completed");
  } finally {
    // Always clean up the temporary conversation
    await pool.query(`DELETE FROM conversations WHERE id = $1`, [fakeConversationId]).catch(() => {});
  }
}

export function startBenchmarkWorker(): Worker {
  const worker = new Worker<BenchmarkJobPayload>(
    "benchmark",
    async (job) => {
      logger.info({ runId: job.data.runId, caseId: job.data.caseId }, "benchmark_case_start");
      try {
        await processCase(job.data);
        logger.info({ runId: job.data.runId, caseId: job.data.caseId }, "benchmark_case_done");
      } catch (err) {
        logger.error({ err, runId: job.data.runId, caseId: job.data.caseId }, "benchmark_case_error");
        await saveResult({
          runId: job.data.runId,
          caseId: job.data.caseId,
          status: "failed",
          responseText: "",
          modelUsed: null,
          toolsInvoked: [],
          toolRounds: 0,
          inputTokens: 0,
          outputTokens: 0,
          latencyMs: 0,
          errorMessage: err instanceof Error ? err.message : String(err),
        }).catch(() => {});
        await markRunProgress(job.data.runId, "failed").catch(() => {});
      }
    },
    {
      connection: { url: env.REDIS_URL },
      concurrency: 10,
    },
  );

  worker.on("error", (err) => logger.error({ err }, "benchmark_worker_error"));
  logger.info("benchmark_worker_started");
  return worker;
}
