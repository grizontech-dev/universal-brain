import type { StreamContext, ToolId } from "../types/router.js";
import { env } from "../config/env.js";
import { recordToolInvocation } from "../services/toolInsights.service.js";
import { getTool } from "./registry.js";

export interface ToolExecutionResult {
  output: unknown;
  durationMs: number;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

function buildCostMetadata(toolId: string, requestArgs: unknown): Record<string, unknown> {
  if (typeof requestArgs !== "object" || !requestArgs) return {};
  const a = requestArgs as Record<string, unknown>;
  if (toolId === "web_search") return { query: typeof a.query === "string" ? a.query.slice(0, 200) : undefined };
  if (toolId === "web_fetch") return { url: typeof a.url === "string" ? a.url.slice(0, 500) : undefined };
  if (toolId === "code_execution" || toolId === "code_execute") return { language: a.language };
  return {};
}

function captureInvocation(args: {
  toolId: string;
  callId: string;
  ctx: StreamContext;
  requestArgs: unknown;
  responseOutput: unknown;
  status: "success" | "error";
  errorMessage?: string;
  durationMs: number;
  startedAt: Date;
}): void {
  if (!args.ctx.jobId) return; // No traceId → skip (e.g. tools called outside a chat job)
  void recordToolInvocation({
    traceId: args.ctx.jobId,
    callId: args.callId,
    userId: args.ctx.userId,
    conversationId: args.ctx.conversationId ?? null,
    messageId: args.ctx.messageId ?? null,
    agentSlug: args.ctx.agentSlug ?? null,
    modelId: args.ctx.modelId ?? null,
    toolName: args.toolId,
    requestArgs: args.requestArgs,
    responseOutput: args.responseOutput,
    status: args.status,
    errorMessage: args.errorMessage ?? null,
    durationMs: args.durationMs,
    startedAt: args.startedAt,
    costMetadata: buildCostMetadata(args.toolId, args.requestArgs),
  });
}

export async function executeTool(
  toolId: ToolId | string,
  args: unknown,
  ctx: StreamContext,
  allowedTools: ToolId[],
  callId?: string,
): Promise<ToolExecutionResult> {
  const start = Date.now();
  const startedAt = new Date();
  const id = toolId as ToolId;
  const effectiveCallId = callId ?? `${id}_${start}`;
  if (!allowedTools.includes(id)) {
    const output = { error: `tool_not_allowed:${toolId}` };
    captureInvocation({
      toolId: String(toolId),
      callId: effectiveCallId,
      ctx,
      requestArgs: args,
      responseOutput: output,
      status: "error",
      errorMessage: `tool_not_allowed:${toolId}`,
      durationMs: Date.now() - start,
      startedAt,
    });
    return { output, durationMs: Date.now() - start };
  }
  const def = getTool(id);
  if (!def) {
    const output = { error: `unknown_tool:${toolId}` };
    captureInvocation({
      toolId: String(toolId),
      callId: effectiveCallId,
      ctx,
      requestArgs: args,
      responseOutput: output,
      status: "error",
      errorMessage: `unknown_tool:${toolId}`,
      durationMs: Date.now() - start,
      startedAt,
    });
    return { output, durationMs: Date.now() - start };
  }

  void ctx.tracer?.event("tool.started", String(toolId), { callId: effectiveCallId, args });

  try {
    const output = await def.execute(args, ctx);
    const durationMs = Date.now() - start;
    captureInvocation({
      toolId: String(toolId),
      callId: effectiveCallId,
      ctx,
      requestArgs: args,
      responseOutput: output,
      status: "success",
      durationMs,
      startedAt,
    });
    void ctx.tracer?.event("tool.completed", String(toolId), {
      callId: effectiveCallId,
      durationMs,
      status: "success",
    });
    return { output, durationMs };
  } catch (err) {
    const durationMs = Date.now() - start;
    const errorMessage = String(err);
    const output = { error: errorMessage };
    captureInvocation({
      toolId: String(toolId),
      callId: effectiveCallId,
      ctx,
      requestArgs: args,
      responseOutput: output,
      status: "error",
      errorMessage,
      durationMs,
      startedAt,
    });
    void ctx.tracer?.event("tool.completed", String(toolId), {
      callId: effectiveCallId,
      durationMs,
      status: "error",
      error: errorMessage,
    });
    return { output, durationMs };
  }
}

export type PendingToolCall = {
  toolId: ToolId;
  arguments: unknown;
  callId: string;
};

export type ToolRunResult = { callId: string; toolId: ToolId; output: unknown; durationMs: number };

/**
 * Runs tool calls in original order: consecutive parallel-safe calls execute in bounded parallel batches.
 */
export async function runToolsBatch(
  calls: PendingToolCall[],
  ctx: StreamContext,
  allowedTools: ToolId[],
): Promise<ToolRunResult[]> {
  const maxParallel = env.MAX_PARALLEL_TOOLS;
  const orderedResults = new Map<string, ToolRunResult>();

  let i = 0;
  while (i < calls.length) {
    const batch: PendingToolCall[] = [];
    while (i < calls.length) {
      const c = calls[i];
      const def = getTool(c.toolId);
      if (def?.parallelSafe) {
        batch.push(c);
        i++;
      } else {
        break;
      }
    }

    if (batch.length > 0) {
      for (const group of chunk(batch, maxParallel)) {
        const settled = await Promise.all(
          group.map(async (c) => {
            const { output, durationMs } = await executeTool(c.toolId, c.arguments, ctx, allowedTools, c.callId);
            return { callId: c.callId, toolId: c.toolId, output, durationMs };
          }),
        );
        for (const r of settled) {
          orderedResults.set(r.callId, r);
        }
      }
    }

    if (i < calls.length) {
      const c = calls[i++];
      const { output, durationMs } = await executeTool(c.toolId, c.arguments, ctx, allowedTools, c.callId);
      orderedResults.set(c.callId, { callId: c.callId, toolId: c.toolId, output, durationMs });
    }
  }

  return calls.map((c) => orderedResults.get(c.callId)!);
}
