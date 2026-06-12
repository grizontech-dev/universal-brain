import { env } from "../config/env.js";
import { captureRouterCall } from "../services/routerCapture.service.js";
import type { RouterCtx } from "./classifier.js";

function combineAbortSignals(a: AbortSignal, b: AbortSignal): AbortSignal {
  const anyFn = (AbortSignal as unknown as { any?: (signals: AbortSignal[]) => AbortSignal }).any;
  if (typeof anyFn === "function") {
    return anyFn([a, b]);
  }
  const c = new AbortController();
  const onAbort = () => c.abort();
  if (a.aborted || b.aborted) {
    c.abort();
    return c.signal;
  }
  a.addEventListener("abort", onAbort);
  b.addEventListener("abort", onAbort);
  return c.signal;
}

const REWRITER_SYSTEM_PROMPT =
  "Rewrite the user's last message into a self-contained query that includes any context from prior turns. Keep it under 200 tokens. Return only the rewritten query, no preamble.";

export async function rewriteQuery(args: {
  originalContent: string;
  recentLines: Array<{ role: string; content: string }>;
  summaryText: string | null;
  abortSignal: AbortSignal;
  ctx?: RouterCtx;
}): Promise<string | null> {
  if (!env.OPENAI_API_KEY?.trim()) return null;

  const controller = new AbortController();
  const to = setTimeout(() => controller.abort(), 800);
  const signal = combineAbortSignals(args.abortSignal, controller.signal);
  const startedAt = Date.now();

  const transcript = [
    args.summaryText ? `Prior summary:\n${args.summaryText}\n` : "",
    ...args.recentLines.map((m) => `${m.role}: ${m.content}`),
    `user: ${args.originalContent}`,
  ].join("\n");

  try {
    const res = await fetch(`${env.OPENAI_BASE_URL ?? "https://api.openai.com/v1"}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: REWRITER_SYSTEM_PROMPT },
          { role: "user", content: transcript },
        ],
      }),
      signal,
    });
    if (!res.ok) {
      captureRouterCall({
        component: "rewriter", source: "llm", status: "error",
        userId: args.ctx?.userId, conversationId: args.ctx?.conversationId,
        jobId: args.ctx?.jobId, messageId: args.ctx?.messageId,
        promptSystem: REWRITER_SYSTEM_PROMPT, promptUser: transcript,
        latencyMs: Date.now() - startedAt,
        errorMessage: `HTTP ${res.status}`,
      });
      return null;
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const text = data.choices?.[0]?.message?.content?.trim();

    captureRouterCall({
      component: "rewriter", source: "llm", status: "completed",
      userId: args.ctx?.userId, conversationId: args.ctx?.conversationId,
      jobId: args.ctx?.jobId, messageId: args.ctx?.messageId,
      promptSystem: REWRITER_SYSTEM_PROMPT, promptUser: transcript,
      responseText: text ?? null,
      latencyMs: Date.now() - startedAt,
      inputTokens: data.usage?.prompt_tokens ?? null,
      outputTokens: data.usage?.completion_tokens ?? null,
    });

    return text || null;
  } catch (err) {
    captureRouterCall({
      component: "rewriter", source: "llm",
      status: (err as Error).name === "AbortError" ? "timeout" : "error",
      userId: args.ctx?.userId, conversationId: args.ctx?.conversationId,
      jobId: args.ctx?.jobId, messageId: args.ctx?.messageId,
      promptSystem: REWRITER_SYSTEM_PROMPT, promptUser: transcript,
      latencyMs: Date.now() - startedAt,
      errorMessage: (err as Error).name === "AbortError" ? null : (err as Error).message,
    });
    return null;
  } finally {
    clearTimeout(to);
  }
}
