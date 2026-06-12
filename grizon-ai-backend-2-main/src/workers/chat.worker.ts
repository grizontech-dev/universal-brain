import { Worker } from "bullmq";

import { env } from "../config/env.js";
import { QUEUE_NAMES, WORKER_CONCURRENCY } from "../config/queue.js";
import { STREAM_INACTIVITY_TIMEOUT_MS, STREAM_ABSOLUTE_TIMEOUT_MS } from "../config/streamLimits.js";
import { getPool } from "../db/pool.js";
import { createRedisSubscriber } from "../infra/redis.js";
import { queueEvents } from "../events/queue.events.js";
import { creditCalculator } from "../services/creditCalculator.service.js";
import { getModelRates, getAgentPrimaryRates } from "../services/modelRates.service.js";
import { conversationService } from "../services/conversation.service.js";
import { summariserService } from "../services/summariser.service.js";
import { liveMetricsService } from "../services/liveMetrics.service.js";
import { fileService } from "../services/file.service.js";
import { messageService } from "../services/message.service.js";
import { sseHub } from "../services/sseHub.service.js";
import { usageTracker } from "../services/usageTracker.service.js";
import { walletService } from "../services/wallet.service.js";
import { logger } from "../utils/logger.js";
import type { ChatJobPayload, SummariseJobPayload } from "../types/chatJob.js";
import type { PostProcessCitation, ProviderMessage, ToolId } from "../types/router.js";
import { getAgent } from "../agents/index.js";
import { accumulateWebSearchCitations } from "../agents/researchSources.js";
import { runRouter, streamCompletion } from "../router/index.js";
import { runToolsBatch } from "../tools/executor.js";
import { toolSpecsFor } from "../router/tools.js";
import { assemblePrompt } from "../prompt/assembler.js";
import {
  inferContentType,
  lookupSemanticCache,
  recordSemanticCacheHit,
  writeSemanticCache,
} from "../cache/semantic.cache.js";
import { hydrateSession, persistSession } from "../memory/session.memory.js";
import { extractAndStoreFacts, recallFacts } from "../memory/vector.memory.js";
import { createJourneyTracer, type JourneyTracer } from "../services/messageJourney.service.js";
import { capturePromptRequest, capturePromptResponse } from "../services/promptCapture.service.js";
import { generateConversationTitle } from "../services/titleGenerator.service.js";
import type { PromptSectionEstimates } from "../prompt/assembler.js";

type TerminalKind =
  | { kind: "failed"; code: string; message: string }
  | { kind: "cancelled" }
  | { kind: "timeout" };

// Per-1k rates come from services/modelRates.service.ts (TTL-cached, so price
// changes in ai_models take effect without a worker restart — plan §4.4).
async function computeCostUsd(model: string, usage: {
  inputFresh: number;
  inputCached: number;
  output: number;
}): Promise<number> {
  const rates = await getModelRates(model);
  return (
    usage.inputFresh * rates.inputRate +
    usage.inputCached * rates.inputCachedRate +
    usage.output * rates.outputRate
  ) / 1000;
}

async function writeApiCallTelemetry(args: {
  requestId: string;
  userId: string;
  provider: string;
  model: string;
  agentSlug: string;
  messageId?: string | null;
  inputFresh: number;
  inputCached: number;
  output: number;
  cacheWrite: number;
  creditsCharged: number;
  cacheLayer: "semantic" | "prompt" | "none";
  toolCount: number;
  latencyMs: number;
  metadata: Record<string, unknown>;
}) {
  try {
    const pool = getPool();
    const costUsd = await computeCostUsd(args.model, {
      inputFresh: args.cacheLayer === "semantic" ? 0 : args.inputFresh,
      inputCached: args.cacheLayer === "semantic" ? 0 : args.inputCached,
      output: args.output,
    });
    await pool.query(
      `
      INSERT INTO api_calls (
        request_id, user_id, provider, model, agent_slug, message_id,
        input_fresh, input_cached, output, cache_write,
        cost_usd_billed_to_us, credits_charged_to_user,
        cache_layer, tool_count, latency_ms, metadata
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
      ON CONFLICT (request_id) DO NOTHING
      `,
      [
        args.requestId,
        args.userId,
        args.provider,
        args.model,
        args.agentSlug,
        args.messageId ?? null,
        args.inputFresh,
        args.inputCached,
        args.output,
        args.cacheWrite,
        costUsd,
        args.creditsCharged,
        args.cacheLayer,
        args.toolCount,
        args.latencyMs,
        args.metadata,
      ],
    );
  } catch (error) {
    logger.error({ err: error, requestId: args.requestId }, "api_calls_insert_failed");
  }
}

async function updateJobStatus(
  jobId: string,
  status: "processing" | "streaming" | "completed" | "failed" | "cancelled" | "timeout",
) {
  const pool = getPool();
  await pool.query(`UPDATE chat_jobs SET status = $1, updated_at = now() WHERE id = $2`, [status, jobId]);
}

async function markProcessing(jobId: string) {
  const pool = getPool();
  await pool.query(
    `
    UPDATE chat_jobs
    SET status = 'processing', started_at = COALESCE(started_at, now()), updated_at = now()
    WHERE id = $1
  `,
    [jobId],
  );
}

async function isCancelRequested(jobId: string): Promise<boolean> {
  const pool = getPool();
  const r = await pool.query(`SELECT cancel_requested, status FROM chat_jobs WHERE id = $1 LIMIT 1`, [jobId]);
  if (!r.rowCount) return false;
  const row = r.rows[0] as { cancel_requested?: boolean; status?: string };
  return Boolean(row.cancel_requested) || row.status === "cancelled";
}

function logChatJobFinished(args: Record<string, unknown>) {
  logger.info(args, "chat_job_finished");
}

async function getSemanticCacheOptout(userId: string): Promise<boolean> {
  const pool = getPool();
  const res = await pool.query(`SELECT semantic_cache_optout FROM users WHERE id = $1 LIMIT 1`, [userId]);
  if (!res.rowCount) return false;
  return Boolean((res.rows[0] as { semantic_cache_optout?: boolean }).semantic_cache_optout);
}

async function handleSemanticCacheHit(args: {
  job: { id?: string; data: ChatJobPayload };
  startedAt: number;
  estimatedCreditsEnqueued: number;
  answer: string;
  cacheId: string;
  similarity: number;
  agentSlug: string;
  tracer: JourneyTracer;
}) {
  // Credits are INTEGER in DB; semantic-cache surcharge is 5% of enqueue estimate — round up like calculateCost.
  const cacheCredits = Math.max(0, Math.ceil(args.estimatedCreditsEnqueued * 0.05));
  const modelId = args.job.data.modelId ?? "semantic_cache";
  const provider = "semantic_cache";

  const assistant = await messageService.createAssistantPlaceholder({
    conversationId: args.job.data.conversationId,
    userId: args.job.data.userId,
    jobId: args.job.id!,
    agentSlug: args.agentSlug,
    modelId,
  });

  await walletService.confirmDeduction(args.job.data.walletHoldId, {
    actualCost: cacheCredits,
    inputTokens: Math.max(1, Math.ceil(args.job.data.content.length / 4)),
    outputTokens: Math.max(1, Math.ceil(args.answer.length / 4)),
    modelId,
    agentSlug: args.agentSlug,
    messageId: assistant.id,
    jobId: args.job.id!,
    agentMultiplier: creditCalculator.multiplierFor(args.agentSlug),
  });

  await messageService.finalise({
    messageId: assistant.id,
    status: "complete",
    finalContent: args.answer,
    inputTokens: Math.max(1, Math.ceil(args.job.data.content.length / 4)),
    outputTokens: Math.max(1, Math.ceil(args.answer.length / 4)),
    creditsDeducted: cacheCredits,
    agentSlug: args.agentSlug,
    modelId,
    modelProvider: provider,
    latencyMs: Date.now() - args.startedAt,
  });

  await usageTracker.record({
    userId: args.job.data.userId,
    conversationId: args.job.data.conversationId,
    messageId: assistant.id,
    requestId: args.job.id!,
    modelId,
    agentSlug: args.agentSlug,
    modelProvider: provider,
    platform: args.job.data.platform,
    status: "success",
    interactionMode: args.job.data.interactionMode,
    latencyMs: Date.now() - args.startedAt,
    inputTokens: Math.max(1, Math.ceil(args.job.data.content.length / 4)),
    outputTokens: Math.max(1, Math.ceil(args.answer.length / 4)),
    creditsDeducted: cacheCredits,
    estimatedCredits: args.estimatedCreditsEnqueued,
    finishReason: "stop",
    semanticCacheHit: true,
    promptCacheHit: false,
    hadFiles: args.job.data.attachedFileIds.length > 0,
    hadVoice: false,
    cacheHitLayer: "semantic",
    inputTokensFresh: 0,
    inputTokensCached: Math.max(1, Math.ceil(args.job.data.content.length / 4)),
    cacheWriteTokens: 0,
    metadata: { cacheId: args.cacheId, similarity: args.similarity },
  });

  await recordSemanticCacheHit({
    userId: args.job.data.userId,
    cacheId: args.cacheId,
    similarity: args.similarity,
    savedCredits: Math.max(0, args.estimatedCreditsEnqueued - cacheCredits),
  });

  await writeApiCallTelemetry({
    requestId: args.job.id!,
    userId: args.job.data.userId,
    provider,
    model: modelId,
    agentSlug: args.agentSlug,
    inputFresh: 0,
    inputCached: Math.max(1, Math.ceil(args.job.data.content.length / 4)),
    output: Math.max(1, Math.ceil(args.answer.length / 4)),
    cacheWrite: 0,
    creditsCharged: cacheCredits,
    cacheLayer: "semantic",
    toolCount: 0,
    latencyMs: Date.now() - args.startedAt,
    metadata: { semanticCacheHit: true, cacheId: args.cacheId, similarity: args.similarity },
  });

  await persistSession(args.job.data.conversationId, [
    { role: "user", content: args.job.data.content },
    { role: "assistant", content: args.answer },
  ]);

  // Start concurrently with DB update so title is ready before "done".
  const titlePromise = generateConversationTitle(args.job.data.conversationId, args.job.data.content)
    .catch((err) => {
      logger.warn({ err, conversationId: args.job.data.conversationId }, "title_generation_failed");
      return null;
    });

  const pool = getPool();
  await pool.query(
    `
      UPDATE chat_jobs
      SET status = 'completed', completed_at = now(), result_message_id = $2, updated_at = now()
      WHERE id = $1
    `,
    [args.job.id, assistant.id],
  );

  const generatedTitle = await titlePromise;

  sseHub.publish(args.job.id!, "processing", { agentSlug: args.agentSlug, modelId, modelProvider: provider });
  sseHub.publish(args.job.id!, "chunk", { content: args.answer });
  sseHub.publish(args.job.id!, "usage", {
    tokensUsed: {
      inputFresh: 0,
      inputCached: Math.max(1, Math.ceil(args.job.data.content.length / 4)),
      output: Math.max(1, Math.ceil(args.answer.length / 4)),
      cacheWrite: 0,
    },
    creditsDeducted: cacheCredits,
  });
  sseHub.publish(args.job.id!, "done", {
    messageId: assistant.id,
    conversationId: args.job.data.conversationId,
    status: "completed",
    title: generatedTitle ?? undefined,
  });
  queueEvents.emit("chat.completed", {
    jobId: args.job.id,
    status: "completed",
    durationMs: Date.now() - args.startedAt,
  });

  void liveMetricsService.recordSemanticHit(args.agentSlug);

  const finishedAt = Date.now();
  void args.tracer.finish({
    status: "completed",
    finishedAt,
    totalDurationMs: finishedAt - args.startedAt,
    modelId,
    modelProvider: provider,
    cacheLayer: "semantic",
    inputTokens: Math.max(1, Math.ceil(args.job.data.content.length / 4)),
    outputTokens: Math.max(1, Math.ceil(args.answer.length / 4)),
    toolCount: 0,
  });
}

export function startChatWorker() {
  return new Worker<ChatJobPayload | SummariseJobPayload>(
    QUEUE_NAMES.chat,
    async (job) => {
      if (job.name === "summarise") {
        const data = job.data as SummariseJobPayload;
        try {
          await summariserService.run(data.conversationId);
          logger.info({ conversationId: data.conversationId, jobId: job.id }, "summarise_job_completed");
        } catch (error) {
          logger.error(
            { err: error, conversationId: data.conversationId, jobId: job.id },
            "summarise_job_failed",
          );
          throw error;
        }
        return;
      }

      const chatPayload = job.data as ChatJobPayload;
      const chatJobRef = { id: job.id, data: chatPayload };
      const startedAt = Date.now();
      const tracer = createJourneyTracer(job.id!);
      void tracer.start({
        userId: chatPayload.userId,
        conversationId: chatPayload.conversationId,
        agentSlug: chatPayload.agentSlug ?? undefined,
        modelId: chatPayload.modelId ?? undefined,
        startedAt,
      });
      void tracer.event("job.received", "chat.worker", {
        agentSlug: chatPayload.agentSlug,
        modelId: chatPayload.modelId,
        attachedFileCount: chatPayload.attachedFileIds.length,
        platform: chatPayload.platform,
      });
      const abortCtl = new AbortController();
      let redisSub: Awaited<ReturnType<typeof createRedisSubscriber>> = null;
      let absoluteTimer: ReturnType<typeof setTimeout> | null = null;
      let inactivityTimer: ReturnType<typeof setTimeout> | null = null;

      const clearTimers = () => {
        if (absoluteTimer) clearTimeout(absoluteTimer);
        if (inactivityTimer) clearTimeout(inactivityTimer);
        absoluteTimer = null;
        inactivityTimer = null;
      };

      const agentSlugForEstimate = chatPayload.agentSlug ?? "general";
      const estimatedCreditsEnqueued =
        chatPayload.estimatedCredits ??
        creditCalculator.calculateCost({
          inputFreshTokens: chatPayload.estimatedTokens,
          inputCachedTokens: 0,
          outputTokens: chatPayload.estimatedTokens,
          rates: await getAgentPrimaryRates(agentSlugForEstimate),
          agentSlug: agentSlugForEstimate,
        });
      let assistantId: string | null = null;
      let decision: Awaited<ReturnType<typeof runRouter>> | null = null;

      try {
        const pool0 = getPool();
        const pre = await pool0.query(`SELECT status FROM chat_jobs WHERE id = $1 LIMIT 1`, [job.id!]);
        if (pre.rows[0] && String((pre.rows[0] as { status: string }).status) === "cancelled") {
          const finishedAt = Date.now();
          void tracer.event("job.cancelled", "chat.worker", { reason: "pre_existing_cancel" });
          void tracer.finish({
            status: "cancelled",
            finishedAt,
            totalDurationMs: finishedAt - startedAt,
            errorCode: "USER_CANCELLED",
            errorMessage: "cancelled",
          });
          queueEvents.emit("chat.completed", { jobId: job.id, status: "cancelled", durationMs: Date.now() - startedAt });
          return;
        }

        await markProcessing(job.id!);

        redisSub = await createRedisSubscriber();
        if (redisSub) {
          const ch = `chat:cancel:${job.id!}`;
          await redisSub.subscribe(ch, () => {
            abortCtl.abort("user_cancelled");
          });
        }

        const resetInactivity = () => {
          if (inactivityTimer) clearTimeout(inactivityTimer);
          inactivityTimer = setTimeout(() => {
            abortCtl.abort("stream_timeout");
          }, STREAM_INACTIVITY_TIMEOUT_MS);
        };
        // Hard safety cap — kills truly runaway jobs regardless of activity.
        absoluteTimer = setTimeout(() => {
          abortCtl.abort("stream_timeout");
        }, STREAM_ABSOLUTE_TIMEOUT_MS);
        resetInactivity();

        const userQuery = chatPayload.content;
        const cacheAgentSlug = chatPayload.agentSlug ?? "chat";
        const userCacheOptout = await getSemanticCacheOptout(chatPayload.userId);
        const semanticHit = await lookupSemanticCache({
          agentSlug: cacheAgentSlug,
          query: userQuery,
          hasFileAttachments: chatPayload.attachedFileIds.length > 0,
          userOptedOut: userCacheOptout,
        });
        void tracer.event("cache.checked", "semantic.cache", {
          hit: Boolean(semanticHit),
          similarity: semanticHit?.similarity,
        });
        if (semanticHit) {
          await handleSemanticCacheHit({
            job: chatJobRef,
            startedAt,
            estimatedCreditsEnqueued,
            answer: semanticHit.answer,
            cacheId: semanticHit.cacheId,
            similarity: semanticHit.similarity,
            agentSlug: cacheAgentSlug,
            tracer,
          });
          return;
        }

        decision = await runRouter(chatPayload);
        void tracer.event("router.classified", "router", {
          intent: decision.classification.intent,
          complexity: decision.classification.complexity,
          classifierSource: decision.classification.classifierSource,
          confidence: decision.classification.confidence,
        });
        void tracer.event("router.decided", "router", {
          agentSlug: decision.agentSlug,
          modelId: decision.modelId,
          modelProvider: decision.modelProvider,
          allowedTools: decision.allowedTools,
          source: decision.source,
          routerLatencyMs: decision.routerLatencyMs,
        });

        if (await isCancelRequested(job.id!)) {
          const finishedAt = Date.now();
          void tracer.event("job.cancelled", "chat.worker", { reason: "post_router" });
          void tracer.finish({
            status: "cancelled",
            finishedAt,
            totalDurationMs: finishedAt - startedAt,
            modelId: decision.modelId,
            modelProvider: decision.modelProvider,
            errorCode: "USER_CANCELLED",
            errorMessage: "cancelled",
          });
          await finishCancelledWithoutAssistant(chatJobRef, startedAt, decision, estimatedCreditsEnqueued);
          return;
        }

        const agentDescPreflight = getAgent(decision.agentSlug);
        if (agentDescPreflight?.preflight) {
          const conv = await conversationService.getById(chatPayload.userId, chatPayload.conversationId);
          const pf = agentDescPreflight.preflight(chatPayload.content, {
            userId: chatPayload.userId,
            planSlug: chatPayload.planSnapshot.slug,
            messageCount: conv.messageCount,
          });
          if (!pf.ok) {
            void tracer.event("preflight.failed", decision.agentSlug, { reason: pf.reason });
            void tracer.finish({
              status: "failed",
              finishedAt: Date.now(),
              totalDurationMs: Date.now() - startedAt,
              modelId: decision.modelId,
              modelProvider: decision.modelProvider,
              errorCode: "PREFLIGHT_FAILED",
              errorMessage: pf.reason ?? "Request rejected.",
            });
            await finishPreflightFailed(
              chatJobRef,
              startedAt,
              decision,
              estimatedCreditsEnqueued,
              pf.reason ?? "Request rejected.",
            );
            return;
          }
        }
        void tracer.event("preflight.validated", decision.agentSlug);

        sseHub.publish(job.id!, "processing", {
          agentSlug: decision.agentSlug,
          modelId: decision.modelId,
          modelProvider: decision.modelProvider,
        });

        const assistant = await messageService.createAssistantPlaceholder({
          conversationId: chatPayload.conversationId,
          userId: chatPayload.userId,
          jobId: job.id!,
          agentSlug: decision.agentSlug,
          modelId: decision.modelId,
        });
        assistantId = assistant.id;

        if (await isCancelRequested(job.id!)) {
          const finishedAt = Date.now();
          void tracer.event("job.cancelled", "chat.worker", { reason: "post_placeholder" });
          void tracer.finish({
            status: "cancelled",
            finishedAt,
            totalDurationMs: finishedAt - startedAt,
            modelId: decision.modelId,
            modelProvider: decision.modelProvider,
            errorCode: "USER_CANCELLED",
            errorMessage: "cancelled",
          });
          await finishCancelledWithAssistant(chatJobRef, assistantId, decision, startedAt, estimatedCreditsEnqueued, "");
          return;
        }

        const recentMessages = await hydrateSession(chatPayload.conversationId);

        let userContent = decision.rewrittenQuery ?? chatPayload.content;
        if (chatPayload.attachedFileIds.length > 0) {
          const attachedFiles = await fileService.getReadyFiles(chatPayload.userId, chatPayload.attachedFileIds);
          if (attachedFiles.length > 0) {
            const fileBlocks = attachedFiles
              .filter((f) => f.extractedText)
              .map((f) => `<file id="${f.id}" type="${f.mimeType}">\n${f.extractedText}\n</file>`)
              .join("\n\n");
            if (fileBlocks) {
              userContent = `${userContent}\n\n${fileBlocks}`;
            }
          }
        }
        const history: ProviderMessage[] = recentMessages
          .filter((m) => m.role === "user" || m.role === "assistant")
          .map((m) => ({
            role: m.role === "assistant" ? "assistant" : "user",
            content: m.content,
          }));

        let base = history;
        const last = base[base.length - 1];
        if (last?.role === "user" && last.content === userContent) {
          base = base.slice(0, -1);
        }
        // Memory recall is currently disabled — facts are still extracted and stored
        // (see extractAndStoreFacts below) but we don't inject them into the prompt.
        // Re-enable by restoring the recallFacts call and passing retrievedContext to
        // assemblePrompt. Kept commented intentionally; we plan to use this later.
        // const recalledFacts = await recallFacts(chatPayload.userId, userContent);
        // const retrievedContext =
        //   recalledFacts.length > 0 ? recalledFacts.map((fact) => `- ${fact}`).join("\n") : undefined;
        const recalledFacts: string[] = [];
        const retrievedContext: string | undefined = undefined;
        const toolDefinitionsForPrompt = toolSpecsFor(decision.allowedTools);
        const assembledPrompt = await assemblePrompt({
          agentSlug: decision.agentSlug,
          systemPrompt: decision.systemPrompt,
          toolDefinitions: toolDefinitionsForPrompt,
          conversationHistory: base,
          userQuery: userContent,
          retrievedContext,
          planSlug: chatPayload.planSnapshot.slug,
          provider: decision.modelProvider,
          conversationId: chatPayload.conversationId,
          modelId: decision.modelId,
        });
        const promptSectionEstimates: PromptSectionEstimates = assembledPrompt.sectionEstimates;
        // Accumulates tool result tokens across multi-round turns (estimated char/4)
        let toolResultTokensAccum = 0;

        const promptCaptureId = await capturePromptRequest({
          jobId: job.id!,
          userId: chatPayload.userId,
          conversationId: chatPayload.conversationId,
          messageId: assistant.id,
          planSlug: chatPayload.planSnapshot.slug,
          decision,
          toolDefinitions: toolDefinitionsForPrompt,
          assembledPrompt,
          userQueryRaw: chatPayload.content,
          rewrittenQuery: decision.rewrittenQuery,
          recalledFacts,
          retrievedContext,
          attachedFileIds: chatPayload.attachedFileIds,
          conversationHistory: base,
          startedAt,
        }).catch(() => null);

        let fullText = "";
        let lastUsage: {
          inputTokensFresh: number;
          inputTokensCached: number;
          outputTokens: number;
          cacheWriteTokens: number;
        } | null = null;
        let finish:
          | {
              reason: "stop" | "length" | "content_filter" | "tool_use" | "error";
              modelUsed: string;
              provider: import("../types/router.js").ProviderId;
            }
          | null = null;

        const toolCounts: Partial<Record<ToolId, number>> = {};
        let webSearchEngine: string | null = null;
        let subagentCost = 0;
        const researchCitations: PostProcessCitation[] = [];
        const citationUrlsSeen = new Set<string>();
        let toolResultCount = 0;

        let firstChunkAt: number | null = null;
        let lastChunkAt: number | null = null;
        let sawStreamChunk = false;
        // Speculative-preamble buffer: text emitted before a tool_use in a given
        // round is tagged `phase: "preamble"` by the Anthropic provider. We stream
        // it to the UI on the `status` channel but do NOT persist it. If the round
        // ends without a tool_use (i.e. it was actually the final answer), we
        // promote the buffered preamble to the assistant message on `finish`.
        let preambleText = "";
        const providerStart = Date.now();

        const routingDecision = decision;
        const ctx = {
          userId: chatPayload.userId,
          conversationId: chatPayload.conversationId,
          jobId: job.id!,
          messageId: assistant.id,
          attachedFileIds: chatPayload.attachedFileIds,
          maxArtifactVersions: chatPayload.planSnapshot.limits?.maxArtifactVersions ?? 5,
          agentSlug: routingDecision.agentSlug,
          queryComplexity: routingDecision.classification.complexity,
          modelId: routingDecision.modelId,
          tracer,
        };

        void tracer.event("llm.stream.started", routingDecision.modelProvider, {
          modelId: routingDecision.modelId,
          allowedTools: routingDecision.allowedTools,
        });

        let terminal: TerminalKind | null = null;

        try {
          for await (const ev of streamCompletion(
            routingDecision,
            assembledPrompt.messages,
            abortCtl.signal,
            ctx,
            assembledPrompt.system,
            {
              runTools: (calls) => runToolsBatch(calls, ctx, routingDecision.allowedTools),
            },
          )) {
            if (await isCancelRequested(job.id!)) {
              abortCtl.abort("user_cancelled");
            }

            if (ev.type === "chunk") {
              if (!sawStreamChunk) {
                sawStreamChunk = true;
                firstChunkAt = Date.now();
                await updateJobStatus(job.id!, "streaming");
              }
              lastChunkAt = Date.now();
              resetInactivity();
              if (ev.phase === "preamble") {
                preambleText += ev.delta;
                sseHub.publish(job.id!, "status", { content: ev.delta });
              } else {
                fullText += ev.delta;
                await messageService.append(assistant.id, ev.delta);
                sseHub.publish(job.id!, "chunk", { content: ev.delta });
              }
            } else if (ev.type === "tool_call") {
              // Buffered preamble was confirmed as a tool-use announcement —
              // drop it so it doesn't leak into the persisted answer.
              preambleText = "";
              // Any text the model emitted in this round BEFORE the tool_call is
              // pre-tool narration ("Let me search…", "Let me fetch…", etc.).
              // Strip it from both the in-memory accumulator and the DB so it
              // never ends up in the saved final message.
              //
              // Note: this fires once per tool_call event in a batch.  For
              // providers that emit all tool_calls at the end of a round (OpenAI,
              // DeepSeek) fullText will be reset on the first tool_call of the
              // batch and remain empty for subsequent ones — which is correct.
              if (fullText.length > 0) {
                fullText = "";
                await messageService.resetContent(assistant.id);
              }
              // Reset inactivity: the model is actively dispatching a tool.
              resetInactivity();
              void tracer.event("llm.tool_call_requested", ev.toolId, {
                callId: ev.callId,
                arguments: ev.arguments,
              });
              sseHub.publish(job.id!, "tool_call", {
                toolId: ev.toolId,
                arguments: ev.arguments,
                callId: ev.callId,
              });
            } else if (ev.type === "tool_result") {
              resetInactivity();
              toolResultCount += 1;
              toolCounts[ev.toolId] = (toolCounts[ev.toolId] ?? 0) + 1;
              // Accumulate estimated tokens for tool results fed back into the LLM
              toolResultTokensAccum += Math.ceil(JSON.stringify(ev.output ?? "").length / 4);
              const out = ev.output as { engine?: string; subagentCost?: number } | null;
              if (out && typeof out === "object") {
                if ("engine" in out && typeof out.engine === "string") {
                  webSearchEngine = out.engine;
                }
                if ("subagentCost" in out && typeof out.subagentCost === "number") {
                  subagentCost += out.subagentCost;
                }
              }
              accumulateWebSearchCitations(ev.output, researchCitations, citationUrlsSeen);
              sseHub.publish(job.id!, "tool_result", {
                callId: ev.callId,
                toolId: ev.toolId,
                output: ev.output,
                durationMs: ev.durationMs,
              });
              // Publish dedicated SSE event when file_gen creates an artifact so the
              // frontend can render a download card immediately, before conversation reload.
              if (ev.toolId === "file_gen") {
                const fileGenOut = ev.output as { artifactId?: string; kind?: string } | null;
                if (fileGenOut?.artifactId) {
                  sseHub.publish(job.id!, "artifact", {
                    artifactId: fileGenOut.artifactId,
                    kind: fileGenOut.kind ?? "unknown",
                    messageId: assistant.id,
                  });
                }
              }
            } else if (ev.type === "usage") {
              lastUsage = ev;
            } else if (ev.type === "finish") {
              finish = ev;
              void tracer.event("llm.stream.finished", ev.provider, {
                reason: ev.reason,
                modelUsed: ev.modelUsed,
              });
            } else if (ev.type === "error") {
              if (ev.code === "STREAM_TIMEOUT") {
                terminal = { kind: "timeout" };
              } else if (ev.code === "USER_CANCELLED") {
                terminal = { kind: "cancelled" };
              } else {
                terminal = { kind: "failed", code: ev.code, message: ev.message };
                sseHub.publish(job.id!, "error", {
                  code: ev.code,
                  message: ev.message,
                  retryable: ev.retryable,
                });
              }
              break;
            }
          }
        } catch (err) {
          if (abortCtl.signal.aborted) {
            const r = abortCtl.signal.reason;
            terminal = r === "stream_timeout" ? { kind: "timeout" } : { kind: "cancelled" };
          } else {
            terminal = { kind: "failed", code: "INTERNAL_ERROR", message: String(err) };
            logger.error({ err, jobId: job.id }, "chat_worker_stream_threw");
          }
        }

        if (!terminal && abortCtl.signal.aborted) {
          const r = abortCtl.signal.reason;
          terminal = r === "stream_timeout" ? { kind: "timeout" } : { kind: "cancelled" };
        }

        if (!terminal && !finish) {
          terminal = { kind: "failed", code: "NO_FINISH", message: "Stream ended without a terminal event." };
        }

        const usageFallback = !lastUsage;
        const inputFresh = lastUsage?.inputTokensFresh ?? chatPayload.estimatedTokens;
        const inputCached = lastUsage?.inputTokensCached ?? 0;
        const outputTok = lastUsage?.outputTokens ?? Math.max(1, Math.ceil(fullText.length / 4));
        const cacheWrite = lastUsage?.cacheWriteTokens ?? 0;

        const modelUsed = finish?.modelUsed ?? decision.modelId;
        const providerUsed = finish?.provider ?? decision.modelProvider;

        const llmFirstTokenMs = firstChunkAt !== null ? firstChunkAt - providerStart : null;
        const llmTotalMs = lastChunkAt !== null ? lastChunkAt - providerStart : null;
        const webSearchCount = toolCounts.web_search ?? 0;
        const webFetchCount = toolCounts.web_fetch ?? 0;
        const codeExecutionCount = toolCounts.code_execution ?? 0;
        const toolCountTotal = Object.values(toolCounts).reduce((sum, n) => sum + (n ?? 0), 0);

        const metadataBase = {
          classifierSource: decision.classification.classifierSource,
          confidence: decision.classification.confidence,
          intent: decision.classification.intent,
          complexity: decision.classification.complexity,
          subagentCost: Number(subagentCost.toFixed(4)),
          toolCounts,
          ...(usageFallback ? { usageFallback: true as const } : {}),
        };

        if (!terminal && finish) {
          // Start title generation concurrently with post-processing so it's
          // ready (or close to it) by the time we publish the "done" event.
          const titlePromise = generateConversationTitle(chatPayload.conversationId, chatPayload.content)
            .catch((err) => {
              logger.warn({ err, conversationId: chatPayload.conversationId }, "title_generation_failed");
              return null;
            });

          // If the last round produced text but no tool_use, the speculative
          // preamble was actually the final answer. Promote it now.
          if (preambleText.length > 0) {
            fullText += preambleText;
            await messageService.append(assistant.id, preambleText);
            sseHub.publish(job.id!, "chunk", { content: preambleText });
            preambleText = "";
          }
          let finalContent = fullText;
          const agentForPost = getAgent(decision.agentSlug);
          if (agentForPost?.postProcess) {
            finalContent = agentForPost.postProcess(fullText, {
              agentSlug: decision.agentSlug,
              citations: researchCitations,
              toolCallCount: toolResultCount,
            });
            void tracer.event("post_process.applied", decision.agentSlug, {
              changed: finalContent !== fullText,
              citationCount: researchCitations.length,
            });
          }
          if (finalContent !== fullText) {
            const delta = finalContent.slice(fullText.length);
            if (delta) {
              await messageService.append(assistant.id, delta);
              sseHub.publish(job.id!, "chunk", { content: delta });
            }
          }

          const citationsForDb = researchCitations.map(({ title, url, snippet }) => ({ title, url, snippet }));

          const actualRates = await getModelRates(modelUsed);
          const actualCost = creditCalculator.calculateCost({
            inputFreshTokens: inputFresh,
            inputCachedTokens: inputCached,
            outputTokens: outputTok,
            rates: actualRates,
            agentSlug: decision.agentSlug,
          });

          await walletService.confirmDeduction(chatPayload.walletHoldId, {
            actualCost,
            inputTokens: inputFresh + inputCached,
            outputTokens: outputTok,
            modelId: modelUsed,
            agentSlug: decision.agentSlug,
            messageId: assistant.id,
            jobId: job.id!,
            creditRate: actualRates.outputRate,
            agentMultiplier: creditCalculator.multiplierFor(decision.agentSlug),
          });

          void liveMetricsService.recordLlmSuccess(providerUsed, decision.agentSlug, inputCached);

          // Strip any [text](sandbox:/uuid) links the LLM may have generated.
          // messageService.finalise() writes finalContent directly to the DB, overriding
          // all streamed chunks, so this always produces clean stored content.
          // The system prompt instructs agents not to emit these, but this is a safety net.
          finalContent = finalContent.replace(/\[([^\]]*)\]\(sandbox:\/[^)]*\)/g, "$1");

          await messageService.finalise({
            messageId: assistant.id,
            status: "complete",
            finalContent: finalContent,
            inputTokens: inputFresh + inputCached,
            outputTokens: outputTok,
            creditsDeducted: actualCost,
            citations: citationsForDb,
            agentSlug: decision.agentSlug,
            modelId: modelUsed,
            modelProvider: providerUsed,
            webSearchUsed: webSearchCount > 0,
            codeExecutionUsed: codeExecutionCount > 0,
            latencyMs: Date.now() - startedAt,
            llmFirstTokenMs,
            llmTotalMs,
          });

          // Store per-section token breakdown for user-facing cost display.
          // context/message/system/tool_result are estimates (char/4) scaled to the
          // actual API total so they always sum correctly.
          void (async () => {
            try {
              const totalInputActual = inputFresh + inputCached;
              const { contextTokens, messageTokens, systemTokens } = promptSectionEstimates;
              const rawSum = contextTokens + messageTokens + systemTokens + toolResultTokensAccum;
              const scale = rawSum > 0 ? totalInputActual / rawSum : 1;
              const breakdown = {
                context_tokens: Math.round(contextTokens * scale),
                message_tokens: Math.round(messageTokens * scale),
                system_tokens: Math.round(systemTokens * scale),
                tool_result_tokens: Math.round(toolResultTokensAccum * scale),
                response_tokens: outputTok,
                total_input_actual: totalInputActual,
              };
              await getPool().query(
                `UPDATE messages SET prompt_breakdown = $2 WHERE id = $1`,
                [assistant.id, JSON.stringify(breakdown)],
              );
            } catch (err) {
              logger.debug({ err, messageId: assistant.id }, "prompt_breakdown_update_failed");
            }
          })();
          void persistSession(chatPayload.conversationId, [
            ...base,
            { role: "user", content: userContent },
            { role: "assistant", content: finalContent },
          ]);
          void extractAndStoreFacts(chatPayload.userId, finalContent, userContent, assistant.id);
          void writeSemanticCache({
            agentSlug: decision.agentSlug,
            query: userContent,
            answer: finalContent,
            contentType: inferContentType(decision.agentSlug),
          });

          const costUsd = await computeCostUsd(modelUsed, { inputFresh, inputCached, output: outputTok });

          await usageTracker.record({
            userId: chatPayload.userId,
            conversationId: chatPayload.conversationId,
            messageId: assistant.id,
            requestId: job.id!,
            modelId: modelUsed,
            agentSlug: decision.agentSlug,
            modelProvider: providerUsed,
            platform: chatPayload.platform,
            status: "success",
            interactionMode: chatPayload.interactionMode,
            latencyMs: Date.now() - startedAt,
            inputTokens: inputFresh + inputCached,
            outputTokens: outputTok,
            creditsDeducted: actualCost,
            estimatedCredits: estimatedCreditsEnqueued,
            actualCostUsd: costUsd,
            finishReason: finish?.reason ?? "stop",
            semanticCacheHit: false,
            promptCacheHit: inputCached > 0,
            hadFiles: chatPayload.attachedFileIds.length > 0,
            hadVoice: false,
            routerLatencyMs: decision.routerLatencyMs,
            cacheHitLayer: inputCached > 0 ? "prompt" : "none",
            webSearchEngine,
            webSearchCount,
            webFetchCount,
            webSearchUsed: webSearchCount > 0,
            codeExecutionUsed: codeExecutionCount > 0,
            codeExecutionCount,
            toolCountTotal,
            inputTokensFresh: inputFresh,
            inputTokensCached: inputCached,
            cacheWriteTokens: cacheWrite,
            metadata: metadataBase,
            llmFirstTokenMs,
            llmTotalMs,
          });

          await writeApiCallTelemetry({
            requestId: job.id!,
            userId: chatPayload.userId,
            provider: providerUsed,
            model: modelUsed,
            agentSlug: decision.agentSlug,
            messageId: assistant.id,
            inputFresh,
            inputCached,
            output: outputTok,
            cacheWrite,
            creditsCharged: actualCost,
            cacheLayer: inputCached > 0 ? "prompt" : "none",
            toolCount: toolCountTotal,
            latencyMs: Date.now() - startedAt,
            metadata: { ...metadataBase, subagentCost: 0 },
          });

          {
            const finishedAt = Date.now();
            void tracer.event("job.completed", "chat.worker", {
              durationMs: finishedAt - startedAt,
            });
            void tracer.finish({
              status: "completed",
              finishedAt,
              totalDurationMs: finishedAt - startedAt,
              modelId: modelUsed,
              modelProvider: providerUsed,
              cacheLayer: inputCached > 0 ? "prompt" : "none",
              inputTokens: inputFresh + inputCached,
              outputTokens: outputTok,
              toolCount: toolCountTotal,
            });
            void capturePromptResponse(promptCaptureId, {
              modelUsed,
              providerUsed,
              finishReason: finish?.reason ?? "stop",
              finalContent,
              inputTokensFresh: inputFresh,
              inputTokensCached: inputCached,
              outputTokens: outputTok,
              cacheWriteTokens: cacheWrite,
              toolCount: toolCountTotal,
              webSearchEngine,
              finishedAt,
              durationMs: finishedAt - startedAt,
              status: "completed",
            });
          }

          const pool = getPool();
          await pool.query(
            `
            UPDATE chat_jobs
            SET status = 'completed', completed_at = now(), result_message_id = $2, updated_at = now()
            WHERE id = $1
          `,
            [job.id, assistant.id],
          );

          sseHub.publish(job.id!, "usage", {
            tokensUsed: {
              inputFresh,
              inputCached,
              output: outputTok,
              cacheWrite,
            },
            creditsDeducted: actualCost,
          });
          const generatedTitle = await titlePromise;
          const doneDurationMs = Date.now() - startedAt;
          sseHub.publish(job.id!, "done", {
            messageId: assistant.id,
            conversationId: chatPayload.conversationId,
            status: "completed",
            durationMs: doneDurationMs,
            llmFirstTokenMs,
            llmTotalMs,
            title: generatedTitle ?? undefined,
            tokensUsed: {
              input: inputFresh + inputCached,
              inputCached,
              output: outputTok,
              cacheWrite,
            },
          });
          queueEvents.emit("chat.completed", { jobId: job.id, status: "completed", durationMs: doneDurationMs });
          logChatJobFinished({
            jobId: job.id,
            userId: chatPayload.userId,
            conversationId: chatPayload.conversationId,
            status: "completed",
            agent: decision.agentSlug,
            model: modelUsed,
            provider: providerUsed,
            inputFresh,
            inputCached,
            output: outputTok,
            cacheWrite,
            creditsEstimated: estimatedCreditsEnqueued,
            creditsActual: actualCost,
            routerMs: decision.routerLatencyMs,
            firstTokenMs: llmFirstTokenMs,
            totalMs: Date.now() - startedAt,
            webSearchCount,
            webFetchCount,
            codeExecutionCount,
            errorCode: null,
          });
        } else if (terminal) {
          {
            const stage =
              terminal.kind === "cancelled"
                ? "job.cancelled"
                : terminal.kind === "timeout"
                  ? "job.timeout"
                  : "job.failed";
            const status =
              terminal.kind === "cancelled"
                ? "cancelled"
                : terminal.kind === "timeout"
                  ? "timeout"
                  : "failed";
            const finishedAt = Date.now();
            void tracer.event(stage as any, "chat.worker", {
              durationMs: finishedAt - startedAt,
              code: terminal.kind === "failed" ? terminal.code : undefined,
            });
            void tracer.finish({
              status: status as any,
              finishedAt,
              totalDurationMs: finishedAt - startedAt,
              modelId: modelUsed,
              modelProvider: providerUsed,
              cacheLayer: inputCached > 0 ? "prompt" : "none",
              inputTokens: inputFresh + inputCached,
              outputTokens: outputTok,
              toolCount: toolCountTotal,
              errorCode:
                terminal.kind === "failed"
                  ? terminal.code
                  : terminal.kind === "timeout"
                    ? "STREAM_TIMEOUT"
                    : "USER_CANCELLED",
              errorMessage:
                terminal.kind === "failed"
                  ? terminal.message
                  : terminal.kind === "timeout"
                    ? "stream_timeout"
                    : "cancelled",
            });
            void capturePromptResponse(promptCaptureId, {
              modelUsed,
              providerUsed,
              finishReason: finish?.reason ?? "error",
              finalContent: fullText,
              inputTokensFresh: inputFresh,
              inputTokensCached: inputCached,
              outputTokens: outputTok,
              cacheWriteTokens: cacheWrite,
              toolCount: toolCountTotal,
              webSearchEngine,
              errorCode:
                terminal.kind === "failed"
                  ? terminal.code
                  : terminal.kind === "timeout"
                    ? "STREAM_TIMEOUT"
                    : "USER_CANCELLED",
              errorMessage:
                terminal.kind === "failed"
                  ? terminal.message
                  : terminal.kind === "timeout"
                    ? "stream_timeout"
                    : "cancelled",
              finishedAt,
              durationMs: finishedAt - startedAt,
              status:
                terminal.kind === "cancelled"
                  ? "cancelled"
                  : terminal.kind === "timeout"
                    ? "timeout"
                    : "failed",
            });
          }
          await handleTerminalFailure({
            job: chatJobRef,
            assistantId: assistant.id,
            decision,
            startedAt,
            estimatedCredits: estimatedCreditsEnqueued,
            terminal,
            inputFresh,
            inputCached,
            outputTok,
            cacheWrite,
            modelUsed,
            providerUsed,
            fullText,
            finish,
            webSearchCount,
            webFetchCount,
            codeExecutionCount,
            webSearchEngine,
            metadataBase,
            llmFirstTokenMs,
            llmTotalMs,
            toolCountTotal,
            jobStatus:
              terminal.kind === "cancelled"
                ? "cancelled"
                : terminal.kind === "timeout"
                  ? "timeout"
                  : "failed",
            errorCode: terminal.kind === "failed" ? terminal.code : terminal.kind === "timeout" ? "STREAM_TIMEOUT" : "USER_CANCELLED",
            errorMessage: terminal.kind === "failed" ? terminal.message : terminal.kind === "timeout" ? "stream_timeout" : "cancelled",
          });
        }
      } catch (error) {
        logger.error({ err: error, jobId: job.id }, "chat_worker_failed");
        {
          const finishedAt = Date.now();
          void tracer.event("job.failed", "chat.worker", { code: "INTERNAL_ERROR" });
          void tracer.finish({
            status: "failed",
            finishedAt,
            totalDurationMs: finishedAt - startedAt,
            modelId: decision?.modelId,
            modelProvider: decision?.modelProvider,
            errorCode: "INTERNAL_ERROR",
            errorMessage: String(error),
          });
        }
        const poolErr = getPool();
        if (assistantId && decision) {
          await handleTerminalFailure({
            job: chatJobRef,
            assistantId,
            decision,
            startedAt,
            estimatedCredits: estimatedCreditsEnqueued,
            terminal: { kind: "failed", code: "INTERNAL_ERROR", message: String(error) },
            inputFresh: chatPayload.estimatedTokens,
            inputCached: 0,
            outputTok: 0,
            cacheWrite: 0,
            modelUsed: decision.modelId,
            providerUsed: decision.modelProvider,
            fullText: "",
            finish: null,
            webSearchCount: 0,
            webFetchCount: 0,
            codeExecutionCount: 0,
            toolCountTotal: 0,
            webSearchEngine: null,
            metadataBase: {
              classifierSource: decision.classification.classifierSource,
              confidence: decision.classification.confidence,
              intent: decision.classification.intent,
              complexity: decision.classification.complexity,
            },
            llmFirstTokenMs: null,
            llmTotalMs: null,
            jobStatus: "failed",
            errorCode: "INTERNAL_ERROR",
            errorMessage: String(error),
          });
        } else if (decision && !assistantId) {
          await walletService.releaseHold(chatPayload.walletHoldId, "worker_failed");
          await usageTracker.record({
            userId: chatPayload.userId,
            conversationId: chatPayload.conversationId,
            messageId: null,
            requestId: job.id!,
            modelId: decision.modelId,
            agentSlug: decision.agentSlug,
            modelProvider: decision.modelProvider,
            platform: chatPayload.platform,
            status: "failed",
            interactionMode: chatPayload.interactionMode,
            latencyMs: Date.now() - startedAt,
            inputTokens: chatPayload.estimatedTokens,
            outputTokens: 0,
            creditsDeducted: 0,
            estimatedCredits: estimatedCreditsEnqueued,
            errorCode: "INTERNAL_ERROR",
            finishReason: "error",
            routerLatencyMs: decision.routerLatencyMs,
            metadata: { internal: true },
          });
          await writeApiCallTelemetry({
            requestId: job.id!,
            userId: chatPayload.userId,
            provider: decision.modelProvider,
            model: decision.modelId,
            agentSlug: decision.agentSlug,
            inputFresh: chatPayload.estimatedTokens,
            inputCached: 0,
            output: 0,
            cacheWrite: 0,
            creditsCharged: 0,
            cacheLayer: "none",
            toolCount: 0,
            latencyMs: Date.now() - startedAt,
            metadata: { subagentCost: 0, errorCode: "INTERNAL_ERROR" },
          });
          await poolErr.query(
            `
            UPDATE chat_jobs
            SET status = 'failed', completed_at = now(), error_code = 'INTERNAL_ERROR', error_message = $2, updated_at = now()
            WHERE id = $1
          `,
            [job.id, String(error)],
          );
          sseHub.publish(job.id!, "error", {
            code: "INTERNAL_ERROR",
            message: "Something went wrong on our side. We have been notified.",
          });
          queueEvents.emit("chat.completed", { jobId: job.id, status: "failed", durationMs: Date.now() - startedAt });
        } else {
          await poolErr.query(
            `
            UPDATE chat_jobs
            SET status = 'failed', completed_at = now(), error_code = 'INTERNAL_ERROR', error_message = $2, updated_at = now()
            WHERE id = $1
          `,
            [job.id, String(error)],
          );
          await walletService.releaseHold(chatPayload.walletHoldId, "worker_failed");
          sseHub.publish(job.id!, "error", {
            code: "INTERNAL_ERROR",
            message: "Something went wrong on our side. We have been notified.",
          });
          queueEvents.emit("chat.completed", { jobId: job.id, status: "failed", durationMs: Date.now() - startedAt });
        }
      } finally {
        clearTimers();
        if (redisSub) {
          try {
            await redisSub.unsubscribe(`chat:cancel:${job.id!}`);
          } catch {
            /* ignore */
          }
          try {
            await redisSub.quit();
          } catch {
            /* ignore */
          }
        }
        sseHub.close(job.id!);
      }
    },
    {
      connection: { url: env.REDIS_URL },
      concurrency: WORKER_CONCURRENCY.chat,
    },
  );
}

async function finishPreflightFailed(
  job: { id?: string; data: ChatJobPayload },
  startedAt: number,
  decision: Awaited<ReturnType<typeof runRouter>>,
  estimatedCredits: number,
  reason: string,
) {
  const pool = getPool();
  await pool.query(
    `
    UPDATE chat_jobs
    SET status = 'failed', completed_at = now(), error_code = $2, error_message = $3, updated_at = now()
    WHERE id = $1
  `,
    [job.id!, "PREFLIGHT_FAILED", reason],
  );
  await walletService.releaseHold(job.data.walletHoldId, "preflight_failed");
  await usageTracker.record({
    userId: job.data.userId,
    conversationId: job.data.conversationId,
    messageId: null,
    requestId: job.id!,
    modelId: decision.modelId,
    agentSlug: decision.agentSlug,
    modelProvider: decision.modelProvider,
    platform: job.data.platform,
    status: "failed",
    interactionMode: job.data.interactionMode,
    latencyMs: Date.now() - startedAt,
    inputTokens: 0,
    outputTokens: 0,
    creditsDeducted: 0,
    estimatedCredits,
    errorCode: "PREFLIGHT_FAILED",
    finishReason: "error",
    routerLatencyMs: decision.routerLatencyMs,
    metadata: {
      classifierSource: decision.classification.classifierSource,
      confidence: decision.classification.confidence,
      intent: decision.classification.intent,
      complexity: decision.classification.complexity,
    },
  });
  await writeApiCallTelemetry({
    requestId: job.id!,
    userId: job.data.userId,
    provider: decision.modelProvider,
    model: decision.modelId,
    agentSlug: decision.agentSlug,
    inputFresh: 0,
    inputCached: 0,
    output: 0,
    cacheWrite: 0,
    creditsCharged: 0,
    cacheLayer: "none",
    toolCount: 0,
    latencyMs: Date.now() - startedAt,
    metadata: { subagentCost: 0, errorCode: "PREFLIGHT_FAILED" },
  });
  sseHub.publish(job.id!, "error", {
    code: "PREFLIGHT_FAILED",
    message: reason,
    retryable: false,
  });
  queueEvents.emit("chat.completed", { jobId: job.id, status: "failed", durationMs: Date.now() - startedAt });
  logChatJobFinished({
    jobId: job.id,
    userId: job.data.userId,
    conversationId: job.data.conversationId,
    status: "failed",
    agent: decision.agentSlug,
    model: decision.modelId,
    provider: decision.modelProvider,
    creditsEstimated: estimatedCredits,
    creditsActual: 0,
    errorCode: "PREFLIGHT_FAILED",
  });
}

async function finishCancelledWithoutAssistant(
  job: { id?: string; data: ChatJobPayload },
  startedAt: number,
  decision: Awaited<ReturnType<typeof runRouter>>,
  estimatedCredits: number,
) {
  const pool = getPool();
  await pool.query(
    `
    UPDATE chat_jobs
    SET status = 'cancelled', completed_at = now(), error_code = 'USER_CANCELLED', error_message = 'cancelled', updated_at = now()
    WHERE id = $1
  `,
    [job.id!],
  );
  await walletService.releaseHold(job.data.walletHoldId, "user_cancelled");
  await usageTracker.record({
    userId: job.data.userId,
    conversationId: job.data.conversationId,
    messageId: null,
    requestId: job.id!,
    modelId: decision.modelId,
    agentSlug: decision.agentSlug,
    modelProvider: decision.modelProvider,
    platform: job.data.platform,
    status: "cancelled",
    interactionMode: job.data.interactionMode,
    latencyMs: Date.now() - startedAt,
    inputTokens: 0,
    outputTokens: 0,
    creditsDeducted: 0,
    estimatedCredits,
    errorCode: "USER_CANCELLED",
    finishReason: "error",
    routerLatencyMs: decision.routerLatencyMs,
    metadata: {
      classifierSource: decision.classification.classifierSource,
      confidence: decision.classification.confidence,
      intent: decision.classification.intent,
      complexity: decision.classification.complexity,
    },
  });
  await writeApiCallTelemetry({
    requestId: job.id!,
    userId: job.data.userId,
    provider: decision.modelProvider,
    model: decision.modelId,
    agentSlug: decision.agentSlug,
    inputFresh: 0,
    inputCached: 0,
    output: 0,
    cacheWrite: 0,
    creditsCharged: 0,
    cacheLayer: "none",
    toolCount: 0,
    latencyMs: Date.now() - startedAt,
    metadata: { subagentCost: 0, errorCode: "USER_CANCELLED" },
  });
  sseHub.publish(job.id!, "cancelled", { reason: "user_cancelled" });
  queueEvents.emit("chat.completed", { jobId: job.id, status: "cancelled", durationMs: Date.now() - startedAt });
  logChatJobFinished({
    jobId: job.id,
    userId: job.data.userId,
    conversationId: job.data.conversationId,
    status: "cancelled",
    agent: decision.agentSlug,
    model: decision.modelId,
    provider: decision.modelProvider,
    creditsEstimated: estimatedCredits,
    creditsActual: 0,
    errorCode: "USER_CANCELLED",
  });
}

async function finishCancelledWithAssistant(
  job: { id?: string; data: ChatJobPayload },
  assistantId: string,
  decision: Awaited<ReturnType<typeof runRouter>>,
  startedAt: number,
  estimatedCredits: number,
  finalContent: string,
) {
  await walletService.releaseHold(job.data.walletHoldId, "user_cancelled");
  await messageService.finalise({
    messageId: assistantId,
    status: "error",
    finalContent,
    inputTokens: 0,
    outputTokens: 0,
    creditsDeducted: 0,
    agentSlug: decision.agentSlug,
    modelId: decision.modelId,
    modelProvider: decision.modelProvider,
    latencyMs: Date.now() - startedAt,
    errorMessage: "cancelled",
  });
  await usageTracker.record({
    userId: job.data.userId,
    conversationId: job.data.conversationId,
    messageId: assistantId,
    requestId: job.id!,
    modelId: decision.modelId,
    agentSlug: decision.agentSlug,
    modelProvider: decision.modelProvider,
    platform: job.data.platform,
    status: "cancelled",
    interactionMode: job.data.interactionMode,
    latencyMs: Date.now() - startedAt,
    inputTokens: 0,
    outputTokens: 0,
    creditsDeducted: 0,
    estimatedCredits,
    errorCode: "USER_CANCELLED",
    finishReason: "error",
    routerLatencyMs: decision.routerLatencyMs,
    metadata: {
      classifierSource: decision.classification.classifierSource,
      confidence: decision.classification.confidence,
      intent: decision.classification.intent,
      complexity: decision.classification.complexity,
    },
  });
  await writeApiCallTelemetry({
    requestId: job.id!,
    userId: job.data.userId,
    provider: decision.modelProvider,
    model: decision.modelId,
    agentSlug: decision.agentSlug,
    inputFresh: 0,
    inputCached: 0,
    output: 0,
    cacheWrite: 0,
    creditsCharged: 0,
    cacheLayer: "none",
    toolCount: 0,
    latencyMs: Date.now() - startedAt,
    metadata: { subagentCost: 0, errorCode: "USER_CANCELLED" },
  });
  const pool = getPool();
  await pool.query(
    `
    UPDATE chat_jobs
    SET status = 'cancelled', completed_at = now(), result_message_id = $2, error_code = 'USER_CANCELLED', error_message = 'cancelled', updated_at = now()
    WHERE id = $1
  `,
    [job.id, assistantId],
  );
  sseHub.publish(job.id!, "cancelled", { reason: "user_cancelled" });
  queueEvents.emit("chat.completed", { jobId: job.id, status: "cancelled", durationMs: Date.now() - startedAt });
  logChatJobFinished({
    jobId: job.id,
    userId: job.data.userId,
    conversationId: job.data.conversationId,
    status: "cancelled",
    agent: decision.agentSlug,
    model: decision.modelId,
    creditsEstimated: estimatedCredits,
    creditsActual: 0,
    errorCode: "USER_CANCELLED",
  });
}

async function handleTerminalFailure(args: {
  job: { id?: string; data: ChatJobPayload };
  assistantId: string;
  decision: Awaited<ReturnType<typeof runRouter>>;
  startedAt: number;
  estimatedCredits: number;
  terminal: TerminalKind;
  inputFresh: number;
  inputCached: number;
  outputTok: number;
  cacheWrite: number;
  modelUsed: string;
  providerUsed: string;
  fullText: string;
  finish: {
    reason: "stop" | "length" | "content_filter" | "tool_use" | "error";
    modelUsed: string;
    provider: import("../types/router.js").ProviderId;
  } | null;
  webSearchCount: number;
  webFetchCount: number;
  codeExecutionCount: number;
  toolCountTotal: number;
  webSearchEngine: string | null;
  metadataBase: Record<string, unknown>;
  llmFirstTokenMs: number | null;
  llmTotalMs: number | null;
  jobStatus: "failed" | "cancelled" | "timeout";
  errorCode: string;
  errorMessage: string;
}) {
  const {
    job,
    assistantId,
    decision,
    startedAt,
    estimatedCredits,
    terminal,
    inputFresh,
    inputCached,
    outputTok,
    cacheWrite,
    modelUsed,
    providerUsed,
    fullText,
    finish,
    webSearchCount,
    webFetchCount,
    codeExecutionCount,
    toolCountTotal,
    webSearchEngine,
    metadataBase,
    llmFirstTokenMs,
    llmTotalMs,
    jobStatus,
    errorCode,
    errorMessage,
  } = args;

  if (terminal.kind !== "cancelled") {
    void liveMetricsService.recordProviderFailure(providerUsed);
  }

  await walletService.releaseHold(
    job.data.walletHoldId,
    terminal.kind === "cancelled" ? "user_cancelled" : terminal.kind === "timeout" ? "stream_timeout" : "provider_error",
  );

  await messageService.finalise({
    messageId: assistantId,
    status: "error",
    finalContent: fullText,
    inputTokens: inputFresh + inputCached,
    outputTokens: outputTok,
    creditsDeducted: 0,
    agentSlug: decision.agentSlug,
    modelId: modelUsed,
    modelProvider: providerUsed,
    webSearchUsed: webSearchCount > 0,
    codeExecutionUsed: codeExecutionCount > 0,
    latencyMs: Date.now() - startedAt,
    errorMessage,
  });

  const usageStatus = terminal.kind === "cancelled" ? "cancelled" : terminal.kind === "timeout" ? "timeout" : "failed";

  const partialCostUsd = await computeCostUsd(modelUsed, { inputFresh, inputCached, output: outputTok });

  await usageTracker.record({
    userId: job.data.userId,
    conversationId: job.data.conversationId,
    messageId: assistantId,
    requestId: job.id!,
    modelId: modelUsed,
    agentSlug: decision.agentSlug,
    modelProvider: providerUsed,
    platform: job.data.platform,
    status: usageStatus,
    interactionMode: job.data.interactionMode,
    latencyMs: Date.now() - startedAt,
    inputTokens: inputFresh + inputCached,
    outputTokens: outputTok,
    creditsDeducted: 0,
    estimatedCredits,
    actualCostUsd: partialCostUsd,
    errorCode,
    finishReason: finish?.reason ?? "error",
    semanticCacheHit: false,
    promptCacheHit: inputCached > 0,
    hadFiles: job.data.attachedFileIds.length > 0,
    hadVoice: false,
    routerLatencyMs: decision.routerLatencyMs,
    cacheHitLayer: inputCached > 0 ? "prompt" : "none",
    webSearchEngine,
    webSearchCount,
    webFetchCount,
    webSearchUsed: webSearchCount > 0,
    codeExecutionUsed: codeExecutionCount > 0,
    codeExecutionCount,
    toolCountTotal,
    inputTokensFresh: inputFresh,
    inputTokensCached: inputCached,
    cacheWriteTokens: cacheWrite,
    metadata: metadataBase,
    llmFirstTokenMs,
    llmTotalMs,
  });

  await writeApiCallTelemetry({
    requestId: job.id!,
    userId: job.data.userId,
    provider: providerUsed,
    model: modelUsed,
    agentSlug: decision.agentSlug,
    inputFresh,
    inputCached,
    output: outputTok,
    cacheWrite,
    creditsCharged: 0,
    cacheLayer: inputCached > 0 ? "prompt" : "none",
    toolCount: toolCountTotal,
    latencyMs: Date.now() - startedAt,
    metadata: { ...metadataBase, subagentCost: 0, errorCode },
  });

  const pool = getPool();
  await pool.query(
    `
    UPDATE chat_jobs
    SET status = $2::text,
        completed_at = now(),
        result_message_id = $3,
        error_code = $4,
        error_message = $5,
        updated_at = now()
    WHERE id = $1
  `,
    [job.id, jobStatus, assistantId, errorCode, errorMessage],
  );

  if (terminal.kind === "failed") {
    sseHub.publish(job.id!, "error", {
      code: terminal.code,
      message: terminal.message,
      retryable: terminal.code === "STREAM_ERROR",
    });
  } else if (terminal.kind === "cancelled") {
    sseHub.publish(job.id!, "cancelled", { reason: "user_cancelled" });
  } else {
    sseHub.publish(job.id!, "error", {
      code: "STREAM_TIMEOUT",
      message: "The model stream exceeded the time limit for your plan.",
      retryable: false,
    });
  }

  queueEvents.emit("chat.completed", {
    jobId: job.id,
    status: jobStatus,
    durationMs: Date.now() - startedAt,
  });

  logChatJobFinished({
    jobId: job.id,
    userId: job.data.userId,
    conversationId: job.data.conversationId,
    status: jobStatus,
    agent: decision.agentSlug,
    model: modelUsed,
    provider: providerUsed,
    inputFresh,
    inputCached,
    output: outputTok,
    cacheWrite,
    creditsEstimated: estimatedCredits,
    creditsActual: 0,
    routerMs: decision.routerLatencyMs,
    firstTokenMs: llmFirstTokenMs,
    totalMs: Date.now() - startedAt,
    webSearchCount,
    webFetchCount,
    codeExecutionCount,
    errorCode,
  });
}
