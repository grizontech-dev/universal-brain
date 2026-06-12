import { getAgent, getAgentDescriptor } from "../agents/index.js";
import { chatAgent as STATIC_CHAT_AGENT } from "../agents/chat.agent.js";
import { messageService } from "../services/message.service.js";
import { getProvider } from "../models/provider.js";
import { captureRouterCall } from "../services/routerCapture.service.js";
import { Errors } from "../utils/errors.js";
import type { ChatJobPayload } from "../types/chatJob.js";
import type {
  ClassificationResult,
  ProviderEvent,
  ProviderMessage,
  RoutingDecision,
  StreamContext,
  ToolId,
} from "../types/router.js";
import { pickAgent } from "./agentDispatcher.js";
import { classify } from "./classifier.js";
import { selectModel } from "./modelSelector.js";
import { providerHealth } from "./providerHealth.js";
import { rewriteQuery } from "./queryRewriter.js";
import { planSearches, renderSearchPlanForPrompt } from "./searchPlanner.js";
import { executeTool } from "../tools/executor.js";
import type { PendingToolCall, ToolRunResult } from "../tools/executor.js";
import { resolveAllowedTools, toolSpecsFor } from "./tools.js";

export type { RoutingDecision, StreamContext } from "../types/router.js";

function syntheticClassification(): ClassificationResult {
  return {
    intent: "chat",
    complexity: "medium",
    needsWebSearch: false,
    needsCodeExecution: false,
    needsFileRead: false,
    needsFileGen: [],
    searchContextSize: "low",
    suggestedAgent: "chat",
    confidence: 1,
    classifierSource: "heuristic",
  };
}

function toolsRequiredFromClassification(c: ClassificationResult): boolean {
  return (
    c.needsWebSearch ||
    c.needsCodeExecution ||
    c.needsFileRead ||
    (c.needsFileGen?.length ?? 0) > 0
  );
}


export async function runRouter(payload: ChatJobPayload): Promise<RoutingDecision> {
  const startedAt = Date.now();
  const plan = payload.planSnapshot;

  const limit = Math.min(24, plan.limits?.maxContextMessages ?? 24);
  const recent = await messageService.getRecentMessages(payload.userId, payload.conversationId, limit);
  let classification: ClassificationResult;
  let agent = pickAgent("chat", plan, undefined);
  let source: RoutingDecision["source"] = payload.interactionMode;
  let rewrittenQuery: string | null = null;

  if (payload.interactionMode === "agent") {
    if (!payload.agentSlug) {
      throw Errors.validation([
        { path: "agentSlug", code: "REQUIRED", message: "agentSlug is required when mode is agent" },
      ]);
    }
    if (!plan.agentAccess.includes(payload.agentSlug)) {
      throw Errors.agentNotAllowed({ agentSlug: payload.agentSlug!, planId: plan.id });
    }
    classification = syntheticClassification();
    agent = getAgentDescriptor(payload.agentSlug) ?? getAgentDescriptor("chat") ?? STATIC_CHAT_AGENT;
  } else {
    let cls = await classify(
      payload.content,
      payload.attachedFileIds.length,
      recent.messages.length,
      plan,
      { userId: payload.userId, conversationId: payload.conversationId, messageId: payload.messageId },
    );
    if (toolsRequiredFromClassification(cls) && cls.complexity === "reasoning") {
      cls = { ...cls, complexity: "complex" };
    }
    classification = cls;

    const qrDefault = plan.featureFlags.queryRewrite !== false;
    if (
      qrDefault &&
      (cls.intent === "search" || cls.intent === "document") &&
      recent.messages.length > 1
    ) {
      const abort = new AbortController();
      rewrittenQuery = await rewriteQuery({
        originalContent: payload.content,
        recentLines: recent.messages.map((m) => ({ role: m.role, content: m.content })),
        summaryText: recent.summaryText,
        abortSignal: abort.signal,
        ctx: { userId: payload.userId, conversationId: payload.conversationId, messageId: payload.messageId },
      });
    }

    agent = pickAgent(cls.intent, plan, cls);
  }

  const allowedTools = resolveAllowedTools(classification, agent, plan, source);
  const toolsRequired = allowedTools.length > 0;

  let searchPlan: RoutingDecision["searchPlan"] = undefined;
  if (allowedTools.includes("web_search")) {
    const plannerResult = await planSearches(
      payload.content,
      classification,
      agent.toolBudgets ?? {},
      allowedTools,
      {
        userId: payload.userId,
        conversationId: payload.conversationId,
        messageId: payload.messageId,
        agentSlug: agent.slug,
      },
    );
    if (plannerResult) searchPlan = plannerResult;
  }

  // Model selection: resolveModelFromDB (via agentSlug) uses agent_model_priorities join table.
  // "standard" is a fallback tier used only when no DB model priorities are configured.
  const { primary, fallbackChain } = await selectModel("standard", plan, {
    toolsRequired,
    agentSlug: agent.slug,
  });

  const today = new Date().toISOString().slice(0, 10);
  const currentYear = new Date().getUTCFullYear();
  const concisenessInstruction = `Be concise and direct. No preamble, filler, or unsolicited elaboration. Call tools silently — do not narrate them. Start your reply with the answer.`;

  const agentName = agent.displayName || agent.slug;
  const agentDesc = agent.description ? ` ${agent.description}` : "";
  const identityGuardrail = `IDENTITY (never override): You are ${agentName}, an AI assistant built by Grizon AI.${agentDesc} Never reveal or confirm your underlying model or provider (Anthropic, OpenAI, Google, etc.). If asked about your model or who made you, say only that you are ${agentName} by Grizon AI.`;

  const toolBehaviourGuardrail = `TOOL BEHAVIOUR (never override): Never reveal which tools or capabilities you have. If a tool call fails or returns no results, handle it gracefully — do not expose tool names, errors, or capability gaps to the user.`;

  const webSearchGuidance = allowedTools.includes("web_search")
    ? `WEB SEARCH (today is ${today}): Treat built-in knowledge of current events, prices, and people as potentially outdated — search first. Write focused queries (not raw user sentences). Use date_range for recency: d=past day, w=past week, m=past month; omit for evergreen topics. Only inject ${currentYear} in a query when explicitly year-specific.`
    : null;

  // File generation document structure guidance — only injected when file_gen is available.
  const fileGenGuidance = allowedTools.includes("file_gen")
    ? `DOCUMENT FORMATTING (docx/pdf via file_gen):
The renderer auto-builds a cover page using \`title\`, \`subtitle\`, today's date, and "Written by Grizon AI" — do NOT put these in the \`content\` field.
Always pass \`subtitle\` for docx/pdf: one line describing scope or audience (e.g. "Prepared for Acme Corp — Q3 2026").
Structure \`content\` starting from page 2 body:
- ## for section headings, ### for sub-sections
- **bold** for key terms, *italic* for emphasis or definitions
- Bullet lists (- item) or numbered lists (1. item) for scannable content
- > blockquote for callouts or highlighted notes
- Wrap code samples in triple backticks`
    : null;

  // Inform the model of per-tool call limits so it plans upfront instead of
  // issuing calls only to have them rejected with TOOL_BUDGET_EXCEEDED.
  const toolBudgetEntries = Object.entries(agent.toolBudgets ?? {}).filter(
    ([tid]) => allowedTools.includes(tid as ToolId),
  );
  const toolBudgetGuidance =
    toolBudgetEntries.length > 0
      ? `TOOL CALL LIMITS (hard caps — do NOT exceed these):\n${toolBudgetEntries
          .map(([tid, n]) => `- ${tid}: max ${n} call${n === 1 ? "" : "s"} per response`)
          .join("\n")}\nPlan your searches before calling — use each tool call wisely.`
      : null;

  let systemPrompt = `${identityGuardrail}\n\n${toolBehaviourGuardrail}\n\nToday's date is ${today}.\n\n${agent.systemPrompt}\n\n${concisenessInstruction}`;
  if (webSearchGuidance) systemPrompt += `\n\n${webSearchGuidance}`;
  if (fileGenGuidance) systemPrompt += `\n\n${fileGenGuidance}`;
  if (toolBudgetGuidance) systemPrompt += `\n\n${toolBudgetGuidance}`;
  if (plan.featureFlags.customSystemPrompt && payload.options?.customSystemPrompt?.trim()) {
    systemPrompt += `\n\nUser instructions:\n${payload.options.customSystemPrompt}`;
  }
  // Append search-plan results AFTER the stable guardrails so the cached prompt prefix is preserved.
  if (searchPlan) {
    const rendered = renderSearchPlanForPrompt(searchPlan);
    if (rendered) systemPrompt += `\n\n${rendered}`;
  }

  const temperature =
    plan.featureFlags.temperatureControl === true ? payload.options?.temperature : undefined;

  const routerLatencyMs = Date.now() - startedAt;
  // Planner adds up to ~1s + N parallel searches; raise the warning threshold when it ran.
  const slowThresholdMs = searchPlan ? 3500 : 2500;
  if (routerLatencyMs > slowThresholdMs) {
    const { logger } = await import("../utils/logger.js");
    logger.warn(
      {
        routerLatencyMs,
        classifierSource: classification.classifierSource,
        plannerLatencyMs: searchPlan?.plannerLatencyMs,
      },
      "router_slow",
    );
  }

  return {
    classification,
    agentSlug: agent.slug,
    modelId: primary.id,
    modelProvider: primary.provider,
    fallbackChain: fallbackChain.map((m) => ({ modelId: m.id, provider: m.provider })),
    rewrittenQuery,
    systemPrompt,
    allowedTools,
    toolBudgets: agent.toolBudgets ?? {},
    source,
    routerLatencyMs,
    temperature,
    maxOutputTokens: agent.maxTokensPerMessage ?? undefined,
    searchPlan,
  };
}

export type StreamCompletionOptions = {
  /** When omitted, tools run sequentially via executeTool (backward compatible). */
  runTools?: (calls: PendingToolCall[]) => Promise<ToolRunResult[]>;
};

export function applyToolBudgets(
  calls: PendingToolCall[],
  budgets: RoutingDecision["toolBudgets"],
  usageCounts: Partial<Record<ToolId, number>>,
  tracer?: StreamContext["tracer"],
): { allowed: PendingToolCall[]; blocked: ToolRunResult[] } {
  const allowed: PendingToolCall[] = [];
  const blocked: ToolRunResult[] = [];
  for (const c of calls) {
    const budget = budgets[c.toolId];
    const used = usageCounts[c.toolId] ?? 0;
    if (typeof budget === "number" && used >= budget) {
      blocked.push({
        callId: c.callId,
        toolId: c.toolId,
        output: {
          error: `tool_budget_exceeded:${c.toolId}`,
          code: "TOOL_BUDGET_EXCEEDED",
          toolId: c.toolId,
          budget,
          used,
          // Explicit instruction so the model stops issuing this tool immediately.
          message: `You have used all ${budget} allowed call${budget === 1 ? "" : "s"} for '${c.toolId}' in this response. Do not call '${c.toolId}' again. Proceed using only the information already gathered.`,
        },
        durationMs: 0,
      });
      void tracer?.event("tool.completed", c.toolId, {
        callId: c.callId,
        status: "budget_exceeded",
        budget,
        used,
      });
      continue;
    }
    usageCounts[c.toolId] = used + 1;
    allowed.push(c);
  }
  return { allowed, blocked };
}

function abortErrorEvent(reason: unknown): Extract<ProviderEvent, { type: "error" }> {
  if (reason === "stream_timeout") {
    return {
      type: "error",
      code: "STREAM_TIMEOUT",
      message: "The request exceeded the configured stream timeout.",
      retryable: false,
    };
  }
  if (reason === "user_cancelled") {
    return {
      type: "error",
      code: "USER_CANCELLED",
      message: "Request cancelled by user.",
      retryable: false,
    };
  }
  return {
    type: "error",
    code: "STREAM_ABORTED",
    message: "The request stream was aborted.",
    retryable: false,
  };
}

async function runToolsSequential(
  calls: PendingToolCall[],
  ctx: StreamContext,
  allowedTools: ToolId[],
): Promise<ToolRunResult[]> {
  const out: ToolRunResult[] = [];
  for (const c of calls) {
    const r = await executeTool(c.toolId, c.arguments, ctx, allowedTools);
    out.push({ callId: c.callId, toolId: c.toolId, output: r.output, durationMs: r.durationMs });
  }
  return out;
}

export async function* streamCompletion(
  decision: RoutingDecision,
  messages: ProviderMessage[],
  abortSignal: AbortSignal,
  ctx: StreamContext,
  systemPromptOverride?: string | object[],
  options?: StreamCompletionOptions,
): AsyncIterable<ProviderEvent> {
  const chain = [
    { modelId: decision.modelId, provider: decision.modelProvider },
    ...decision.fallbackChain,
  ];

  let working = [...messages];
  let lastFailureReason: string | null = null;
  const toolUsageCounts: Partial<Record<ToolId, number>> = {};
  // Pre-seed web_search usage from any pre-executed planner queries so the model
  // cannot blow past its budget by re-issuing them — it should call web_fetch instead.
  if (decision.searchPlan?.queries.length) {
    toolUsageCounts.web_search = decision.searchPlan.queries.length;
  }

  const maxToolRounds = getAgent(decision.agentSlug)?.maxToolRounds ?? 10;

  outer: for (const attempt of chain) {
    if (await providerHealth.isOpen(attempt.provider)) {
      lastFailureReason = `${attempt.provider}/${attempt.modelId}: circuit breaker open`;
      continue;
    }

    let provider;
    try {
      provider = getProvider(attempt.provider);
    } catch {
      continue;
    }

    let round = 0;
    roundLoop: while (round < maxToolRounds) {
      round++;
      const roundStart = Date.now();
      let sawChunk = false;
      let textBuf = "";
      const pendingCalls: Extract<ProviderEvent, { type: "tool_call" }>[] = [];
      let lastUsageEvent: Extract<ProviderEvent, { type: "usage" }> | null = null;
      // Snapshot the last few messages sent to the LLM this round (truncated for storage).
      const workingSnapshot = working.slice(-4).map((m) => ({
        role: m.role,
        content: String(Array.isArray(m.content) ? JSON.stringify(m.content) : m.content ?? "").slice(0, 400),
      }));

      const fireRoundCapture = (
        status: "completed" | "error",
        errorMessage?: string | null,
      ) => {
        const u = lastUsageEvent;
        const toolCallIds = pendingCalls.map((c) => c.toolId);
        captureRouterCall({
          component: "stream_round",
          source: attempt.provider,
          model: attempt.modelId,
          modelProvider: attempt.provider,
          agentSlug: decision.agentSlug,
          userId: ctx.userId,
          conversationId: ctx.conversationId,
          jobId: ctx.jobId,
          messageId: ctx.messageId,
          promptUser: JSON.stringify(workingSnapshot).slice(0, 4000),
          responseText: textBuf || null,
          responseJson: {
            round,
            agentSlug: decision.agentSlug,
            toolCalls: pendingCalls.map((c) => ({
              toolId: c.toolId,
              callId: c.callId,
              arguments: c.arguments,
            })),
          },
          latencyMs: Date.now() - roundStart,
          inputTokens: u ? u.inputTokensFresh + u.inputTokensCached : null,
          outputTokens: u?.outputTokens ?? null,
          inputTokensFresh: u?.inputTokensFresh ?? null,
          inputTokensCached: u?.inputTokensCached ?? null,
          cacheWriteTokens: u?.cacheWriteTokens ?? null,
          roundNumber: round,
          status,
          errorMessage: errorMessage ?? null,
          costMetadata: {
            isFinalRound: toolCallIds.length === 0,
            toolsCalled: toolCallIds,
            finishReason: status === "error" ? "error" : toolCallIds.length > 0 ? "tool_use" : "stop",
          },
        });
      };

      try {
        const stream = provider.streamCompletion({
          modelId: attempt.modelId,
          agentSlug: decision.agentSlug,
          messages: working,
          tools: toolSpecsFor(decision.allowedTools),
          systemPrompt: systemPromptOverride ?? decision.systemPrompt,
          temperature: decision.temperature,
          maxOutputTokens: decision.maxOutputTokens,
          abortSignal,
          jobId: ctx.jobId,
        });

        for await (const ev of stream) {
          if (ev.type === "chunk") {
            sawChunk = true;
            textBuf += ev.delta;
            yield ev;
          } else if (ev.type === "tool_call") {
            pendingCalls.push(ev);
            // Peek-check: only forward to the SSE stream (and thus the frontend) if this
            // call is within budget.  applyToolBudgets() at finish-time is still the
            // authoritative gate for actual execution; this preview check is purely to
            // avoid showing 0-ms "ghost" tool chips to the user for calls we know we
            // will block.
            const peekBudget = decision.toolBudgets[ev.toolId];
            if (typeof peekBudget !== "number") {
              yield ev; // no cap on this tool
            } else {
              // Count calls of this toolId already committed (toolUsageCounts) plus
              // those queued in pendingCalls this round (including the current one).
              const queuedThisRound = pendingCalls.filter((c) => c.toolId === ev.toolId).length;
              const alreadyUsed = toolUsageCounts[ev.toolId] ?? 0;
              if (alreadyUsed + queuedThisRound <= peekBudget) {
                yield ev; // within budget — show on frontend
              }
              // else: silently drop — the LLM will still receive the budget_exceeded
              // error from applyToolBudgets, but the user never sees a ghost chip.
            }
          } else if (ev.type === "usage") {
            lastUsageEvent = ev;
            yield ev;
          } else if (ev.type === "finish") {
            if (pendingCalls.length > 0) {
              fireRoundCapture("completed");
              const assistantToolCalls = pendingCalls.map((c) => ({
                id: c.callId,
                name: String(c.toolId),
                arguments:
                  typeof c.arguments === "string"
                    ? c.arguments
                    : JSON.stringify(c.arguments ?? {}),
              }));
              working.push({ role: "assistant", content: "", assistantToolCalls });
              const pendingAsCalls: PendingToolCall[] = pendingCalls.map((c) => ({
                toolId: c.toolId,
                arguments: c.arguments,
                callId: c.callId,
              }));
              const { allowed: pendingForRunner, blocked: blockedResults } = applyToolBudgets(
                pendingAsCalls,
                decision.toolBudgets,
                toolUsageCounts,
                ctx.tracer,
              );
              const runner = options?.runTools ?? ((calls: PendingToolCall[]) =>
                runToolsSequential(calls, ctx, decision.allowedTools));
              const executed = pendingForRunner.length > 0 ? await runner(pendingForRunner) : [];
              const byCallId = new Map<string, ToolRunResult>();
              for (const r of executed) byCallId.set(r.callId, r);
              for (const r of blockedResults) byCallId.set(r.callId, r);
              // Track which callIds were budget-blocked so we can suppress their
              // tool_result SSE events.  The LLM still needs the error in `working`,
              // but the frontend should never see an orphaned result with no matching
              // tool_call chip.
              const blockedCallIds = new Set(blockedResults.map((r) => r.callId));
              for (const c of pendingCalls) {
                const r = byCallId.get(c.callId);
                if (!r) continue;
                working.push({
                  role: "tool",
                  toolCallId: r.callId,
                  toolName: r.toolId,
                  content: typeof r.output === "string" ? r.output : JSON.stringify(r.output),
                });
                // Only forward tool_result to the SSE stream when the corresponding
                // tool_call was also forwarded (i.e., it was within budget).
                if (!blockedCallIds.has(r.callId)) {
                  yield {
                    type: "tool_result",
                    callId: r.callId,
                    toolId: r.toolId,
                    output: r.output,
                    durationMs: r.durationMs,
                  };
                }
              }
              pendingCalls.length = 0;
              continue roundLoop;
            }
            fireRoundCapture("completed");
            yield ev;
            if (lastUsageEvent) {
              yield lastUsageEvent;
            }
            await providerHealth.recordSuccess(attempt.provider);
            return;
          } else if (ev.type === "error") {
            fireRoundCapture("error", ev.message);
            yield ev;
            return;
          }
        }
      } catch (err) {
        if (abortSignal.aborted) {
          fireRoundCapture("error", "aborted");
          yield abortErrorEvent(abortSignal.reason);
          return;
        }
        if (!sawChunk) {
          fireRoundCapture("error", String(err));
          await providerHealth.recordFailure(attempt.provider, err);
          lastFailureReason = `${attempt.provider}/${attempt.modelId}: ${String(err)}`;
          const { logger } = await import("../utils/logger.js");
          logger.warn(
            { provider: attempt.provider, modelId: attempt.modelId, err, jobId: ctx.jobId },
            "stream_provider_failure",
          );
          continue outer;
        }
        fireRoundCapture("error", String(err));
        yield { type: "error", code: "STREAM_ERROR", message: String(err), retryable: true };
        return;
      }
    }
  }

  yield {
    type: "error",
    code: "PROVIDER_EXHAUSTED",
    message: lastFailureReason
      ? `All model providers exhausted. Last failure: ${lastFailureReason}`
      : "All model providers are temporarily unavailable.",
    retryable: false,
  };
}

/** Summariser / utilities: uses configured models for chat agent. */
export async function buildNanoChatDecision(
  plan: import("../types/plan.js").Plan,
): Promise<RoutingDecision> {
  const agent = getAgentDescriptor("chat") ?? STATIC_CHAT_AGENT;
  const { primary, fallbackChain } = await selectModel("nano", plan, {
    toolsRequired: false,
    agentSlug: agent.slug,
  });
  return {
    classification: syntheticClassification(),
    agentSlug: agent.slug,
    modelId: primary.id,
    modelProvider: primary.provider,
    fallbackChain: fallbackChain.map((m) => ({ modelId: m.id, provider: m.provider })),
    rewrittenQuery: null,
    systemPrompt: agent.systemPrompt,
    allowedTools: [],
    toolBudgets: {},
    source: "auto",
    routerLatencyMs: 0,
    temperature: undefined,
  };
}
