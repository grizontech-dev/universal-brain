import type { RequestHandler } from "express";
import { z } from "zod";

import { creditCalculator } from "../../services/creditCalculator.service.js";
import { getAgentPrimaryRates } from "../../services/modelRates.service.js";
import { ESTIMATE_OUTPUT_RATIO } from "../../config/credits.js";
import { chatJobService } from "../../services/chatJob.service.js";
import { jobStatusService } from "../../services/jobStatus.service.js";
import { sseHub } from "../../services/sseHub.service.js";
import { walletService } from "../../services/wallet.service.js";
import { queueEvents } from "../../events/queue.events.js";
import { chatQueue } from "../../queues/chat.queue.js";
import { getPool } from "../../db/pool.js";
import { getRedisClient } from "../../infra/redis.js";
import { HEARTBEAT_MS } from "../../config/queue.js";
import { Errors, parseBody } from "../../utils/errors.js";
import { created, ok } from "../../utils/response.js";
import type { ChatJobPayload } from "../../types/chatJob.js";

const enqueueSchema = z.object({
  conversationId: z.string().uuid(),
  clientMessageId: z.string().uuid(),
  content: z.string().min(1).max(20_000),
  attachedFileIds: z.array(z.string().uuid()).default([]),
  agentSlug: z.string().nullable().optional(),
  options: z
    .object({
      temperature: z.number().min(0).max(2).optional(),
      customSystemPrompt: z.string().max(4000).optional(),
      searchContextSize: z.enum(["low", "medium", "high"]).optional(),
    })
    .optional(),
});

function toSseFrame(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function estimateTokens(content: string): number {
  return Math.max(1, Math.ceil(content.length / 4));
}

export const chatController = {
  enqueue: (async (req, res, next) => {
    let holdIdFromController: string | null = null;
    try {
      if (!req.user?.id || !req.session?.id || !req.plan || !req.platform) {
        return next(Errors.notAuthenticated());
      }

      const body = parseBody(enqueueSchema, req.body);

      if (body.agentSlug && !req.plan.agentAccess.includes(body.agentSlug)) {
        return next(Errors.agentNotAllowed());
      }
      const estimatedInputTokens = estimateTokens(body.content);
      const estimatedOutputTokens = Math.ceil(estimatedInputTokens * ESTIMATE_OUTPUT_RATIO);
      const estimateAgentSlug = body.agentSlug ?? "general";
      const estimatedCost = creditCalculator.calculateCost({
        inputFreshTokens: estimatedInputTokens,
        inputCachedTokens: 0,
        outputTokens: estimatedOutputTokens,
        rates: await getAgentPrimaryRates(estimateAgentSlug),
        agentSlug: estimateAgentSlug,
      });
      const estimatedTokens = estimatedInputTokens + estimatedOutputTokens;

      const walletHoldId =
        req.wallet?.holdId ??
        (await walletService.holdPending(req.user.id, estimatedCost, {
          modelId: undefined,
          agentSlug: body.agentSlug ?? undefined,
          description: "chat_enqueue_hold",
        }));
      if (!req.wallet?.holdId) holdIdFromController = walletHoldId;

      const payload: ChatJobPayload = {
        userId: req.user.id,
        conversationId: body.conversationId,
        messageId: body.clientMessageId,
        clientMessageId: body.clientMessageId,
        sessionId: req.session.id,
        platform: req.platform,
        planSnapshot: req.plan,
        walletHoldId,
        content: body.content,
        attachedFileIds: body.attachedFileIds,
        interactionMode: body.agentSlug ? "agent" : "auto",
        agentSlug: body.agentSlug ?? null,
        modelId: null,
        options: body.options ?? {},
        estimatedTokens,
        estimatedCredits: estimatedCost,
      };

      const { job, replayed } = await chatJobService.enqueueChat(payload);
      queueEvents.emit("chat.enqueued", { jobId: job.id, userId: req.user.id, conversationId: body.conversationId });

      // Backfill job_id onto the hold so it's traceable (hold is created before job ID exists)
      if (!replayed) {
        getPool()
          .query(`UPDATE wallet_transactions SET job_id = $1 WHERE id = $2 AND job_id IS NULL`, [job.id, walletHoldId])
          .catch(() => undefined);
      }

      const responseData = {
        jobId: job.id,
        status: job.status,
        streamUrl: `/api/v1/chat/stream/${job.id}`,
      };
      if (replayed) return ok(res, responseData, "Existing chat job returned.");
      return created(res, responseData, "Chat job queued.");
    } catch (error) {
      if (holdIdFromController) {
        await walletService.releaseHold(holdIdFromController, "enqueue_failed");
      }
      return next(error);
    }
  }) satisfies RequestHandler,

  stream: (async (req, res, next) => {
    try {
      if (!req.user?.id) return next(Errors.notAuthenticated());
      const snapshot = await jobStatusService.getJobSnapshot(String(req.params.jobId), req.user.id);

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders();

      if (snapshot.status === "queued") {
        res.write(toSseFrame("queued", { position: 0 }));
      }

      const unsubscribe = sseHub.subscribe(snapshot.id, (event) => {
        res.write(toSseFrame(event.event, event.data));
        if (event.event === "done" || event.event === "error" || event.event === "cancelled") {
          unsubscribe();
          clearInterval(heartbeat);
          res.end();
        }
      });

      const heartbeat = setInterval(() => {
        res.write(toSseFrame("heartbeat", {}));
      }, HEARTBEAT_MS);

      req.on("close", () => {
        clearInterval(heartbeat);
        unsubscribe();
      });
    } catch (error) {
      return next(error);
    }
  }) satisfies RequestHandler,

  getStatus: (async (req, res, next) => {
    try {
      if (!req.user?.id) return next(Errors.notAuthenticated());
      const snapshot = await jobStatusService.getJobSnapshot(String(req.params.jobId), req.user.id);
      return ok(
        res,
        {
          jobId: snapshot.id,
          status: snapshot.status,
          agentSlug: snapshot.agentSlug,
          modelId: snapshot.modelId,
          resultMessageId: snapshot.resultMessageId,
          artifactIds: snapshot.artifactIds,
          errorCode: snapshot.errorCode,
          errorMessage: snapshot.errorMessage,
          startedAt: snapshot.startedAt,
          completedAt: snapshot.completedAt,
        },
        "Chat job status loaded.",
      );
    } catch (error) {
      return next(error);
    }
  }) satisfies RequestHandler,

  cancelLatest: (async (req, res, next) => {
    try {
      if (!req.user?.id) return next(Errors.notAuthenticated());
      const active = await jobStatusService.getMostRecentActiveJobForConversation(String(req.params.conversationId), req.user.id);
      if (!active) return next(Errors.noActiveJob());

      const { mode, walletHoldId } = await chatJobService.beginCancelForUser(active.id, req.user.id);
      const job = await chatQueue.getJob(active.id);
      if (job) {
        try {
          await job.remove();
        } catch {
          // Job may already be active; worker observes cancel_requested / Redis.
        }
      }
      if (mode === "queued_cancelled") {
        await walletService.releaseHold(walletHoldId, "user_cancelled");
      } else {
        const redis = await getRedisClient();
        if (redis) {
          try {
            await redis.publish(`chat:cancel:${active.id}`, "1");
          } catch {
            /* worker still polls cancel_requested */
          }
        }
      }
      sseHub.publish(active.id, "cancelled", { reason: "user_cancelled" });
      queueEvents.emit("chat.cancelled", { jobId: active.id, byActor: req.user.id });
      return ok(res, { jobId: active.id, status: "cancelled" }, "Chat job cancelled.");
    } catch (error) {
      return next(error);
    }
  }) satisfies RequestHandler,
};
