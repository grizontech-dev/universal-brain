import { createHash } from "crypto";

import { env } from "../config/env.js";
import { getRedisClient } from "../infra/redis.js";
import { captureRouterCall } from "../services/routerCapture.service.js";
import { logger } from "../utils/logger.js";
import type { Plan } from "../types/plan.js";
import type { ClassificationResult, Complexity, FileGenKind, Intent } from "../types/router.js";

export interface RouterCtx {
  userId?: string | null;
  conversationId?: string | null;
  jobId?: string | null;
  messageId?: string | null;
}

const URL_RE = /\bhttps?:\/\/\S+/i;
const CODE_RE = /```|`[^`]+`|^\s*(class|function|def|import|const|let|var)\b/m;
const FILE_GEN_RE =
  /\b(create|generate|make|export)\s+(an?\s+)?(excel|xlsx|spreadsheet|word|docx|pdf|markdown|md|txt|csv)\b/i;
const REASONING_RE = /\b(think step by step|reason through|prove|derive|complexity|big-?o)\b/i;

// Web-search trigger families — any match sets needsWebSearch: true in the heuristic path.
// A: user is explicitly asking to search the web
const WEB_EXPLICIT_RE =
  /\b(web\s+search|search\s+(?:for|the\s+web)|look\s+up|look\s+for|find\s+(?:me\s+)?(?:a|an|the|some\s+)?|google|bing)\b/i;
// B: time-sensitive signals that imply live data is needed
const WEB_TIME_RE =
  /\b(latest|today|current|recent|now|right\s+now|this\s+(week|month|year|quarter)|just\s+(announced|released|launched)|upcoming|trending|live|breaking)\b|202[0-9]/i;
// C: discovery / comparison / factual-lookup intent
const WEB_DISCOVERY_RE =
  /\b(best\s+\d+|top\s+\d+|who\s+(is|are|was|were|won)|what\s+happened|vs\.?|versus|compare|review\s+of|price\s+of|cost\s+of|how\s+much\s+does|news\s+(about|on)|tell\s+me\s+about\s+(?:the\s+)?(?:latest|new|recent))\b/i;

function detectFileGenKinds(content: string): FileGenKind[] {
  const out: FileGenKind[] = [];
  const lower = content.toLowerCase();
  if (/\b(excel|xlsx|spreadsheet)\b/.test(lower)) out.push("excel");
  if (/\b(word|docx)\b/.test(lower)) out.push("docx");
  if (/\b(markdown|\.md)\b/.test(lower)) out.push("markdown");
  if (/\bpdf\b/.test(lower)) out.push("pdf");
  if (/\b(txt|text file|plain text)\b/.test(lower)) out.push("txt");
  if (/\bcsv\b/.test(lower)) out.push("csv");
  if (/\b(image|png|jpeg)\b/.test(lower)) out.push("image");
  return out.length ? out : ["markdown"];
}

export function heuristicClassifier(
  content: string,
  attachedFileCount: number,
  conversationLength: number,
): ClassificationResult | null {
  const flags = {
    hasUrl: URL_RE.test(content),
    hasCode: CODE_RE.test(content),
    hasFileGen: FILE_GEN_RE.test(content),
    isLong: content.length > 500,
    isShort: content.length < 60,
    isReasoning: REASONING_RE.test(content),
    hasAttachments: attachedFileCount > 0,
  };

  if (flags.hasCode || /\b(bug|error|stack ?trace|exception)\b/i.test(content)) {
    return {
      intent: "debug",
      complexity: "medium",
      needsWebSearch: false,
      needsCodeExecution: true,
      needsFileRead: flags.hasAttachments,
      needsFileGen: [],
      searchContextSize: "low",
      suggestedAgent: "debugger",
      confidence: 0.85,
      classifierSource: "heuristic",
    };
  }
  if (flags.hasFileGen) {
    return {
      intent: "document",
      complexity: "medium",
      needsWebSearch: false,
      needsCodeExecution: false,
      needsFileRead: false,
      needsFileGen: detectFileGenKinds(content),
      searchContextSize: "medium",
      suggestedAgent: "document",
      confidence: 0.9,
      classifierSource: "heuristic",
    };
  }
  if (flags.hasUrl || WEB_EXPLICIT_RE.test(content) || WEB_TIME_RE.test(content) || WEB_DISCOVERY_RE.test(content)) {
    return {
      intent: "search",
      complexity: "medium",
      needsWebSearch: true,
      needsCodeExecution: false,
      needsFileRead: false,
      needsFileGen: [],
      searchContextSize: flags.isLong ? "medium" : "low",
      suggestedAgent: "research",
      confidence: 0.8,
      classifierSource: "heuristic",
    };
  }
  if (flags.isReasoning) {
    return {
      intent: "analyse",
      complexity: "reasoning",
      needsWebSearch: false,
      needsCodeExecution: false,
      needsFileRead: false,
      needsFileGen: [],
      searchContextSize: "high",
      suggestedAgent: "analyst",
      confidence: 0.75,
      classifierSource: "heuristic",
    };
  }
  if (flags.isShort && !flags.hasAttachments && conversationLength < 4) {
    return {
      intent: "chat",
      complexity: "simple",
      needsWebSearch: false,
      needsCodeExecution: false,
      needsFileRead: false,
      needsFileGen: [],
      searchContextSize: "low",
      suggestedAgent: "chat",
      confidence: 0.9,
      classifierSource: "heuristic",
    };
  }

  return null;
}

function safeDefault(): ClassificationResult {
  return {
    intent: "chat",
    complexity: "medium",
    needsWebSearch: false,
    needsCodeExecution: false,
    needsFileRead: false,
    needsFileGen: [],
    searchContextSize: "low",
    suggestedAgent: "chat",
    confidence: 0,
    classifierSource: "llm",
  };
}

const CLASSIFIER_PROMPT = `Classify the user's request. Return ONLY valid JSON matching this schema:
{
  "intent": "search|code|write|analyse|design|debug|ui|chat|document|math|fact",
  "complexity": "simple|medium|complex|reasoning",
  "needsWebSearch": boolean,
  "needsCodeExecution": boolean,
  "needsFileRead": boolean,
  "needsFileGen": ["excel"|"docx"|"markdown"|"pdf"|"txt"|"csv"|"image"],
  "searchContextSize": "low|medium|high",
  "suggestedAgent": "general|research|code|writer|analyst|architect|debugger|ui|document|math|fact-check",
  "confidence": 0.0
}

needsWebSearch guidance: set true when the question requires real-time, current, or externally-sourced information — news, prices, live data, rankings, recent events, product reviews, people or company lookups, comparisons of specific products or services, or anything that changes faster than a training dataset. Set false for general knowledge, coding help, writing tasks, math, or analysis of content the user has already provided.`;

function normalizeIntent(v: string): Intent {
  const allowed: Intent[] = [
    "search",
    "code",
    "write",
    "analyse",
    "design",
    "debug",
    "ui",
    "chat",
    "document",
    "math",
    "fact",
  ];
  return allowed.includes(v as Intent) ? (v as Intent) : "chat";
}

function normalizeComplexity(v: string): Complexity {
  const allowed: Complexity[] = ["simple", "medium", "complex", "reasoning"];
  return allowed.includes(v as Complexity) ? (v as Complexity) : "medium";
}

async function getClassifierCache(hash: string): Promise<ClassificationResult | null> {
  const redis = await getRedisClient();
  if (!redis) return null;
  try {
    const raw = await redis.get(`router:classifier:${hash}`);
    if (!raw) return null;
    return JSON.parse(raw) as ClassificationResult;
  } catch {
    return null;
  }
}

async function setClassifierCache(hash: string, value: ClassificationResult): Promise<void> {
  const redis = await getRedisClient();
  if (!redis) return;
  try {
    await redis.set(`router:classifier:${hash}`, JSON.stringify(value), { EX: 3600 });
  } catch {
    /* ignore */
  }
}

async function classifyWithLlm(
  content: string,
  signal: AbortSignal,
  ctx?: RouterCtx,
): Promise<ClassificationResult> {
  if (!env.OPENAI_API_KEY?.trim()) {
    return safeDefault();
  }
  const startedAt = Date.now();
  try {
    const res = await fetch(`${env.OPENAI_BASE_URL ?? "https://api.openai.com/v1"}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: CLASSIFIER_PROMPT },
          { role: "user", content },
        ],
      }),
      signal,
    });
    if (!res.ok) {
      captureRouterCall({
        component: "classifier", source: "llm", status: "error",
        userId: ctx?.userId, conversationId: ctx?.conversationId,
        jobId: ctx?.jobId, messageId: ctx?.messageId,
        promptSystem: CLASSIFIER_PROMPT, promptUser: content,
        latencyMs: Date.now() - startedAt,
        errorMessage: `HTTP ${res.status}`,
      });
      return safeDefault();
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const text = data.choices?.[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const result: ClassificationResult = {
      intent: normalizeIntent(String(parsed.intent ?? "chat")),
      complexity: normalizeComplexity(String(parsed.complexity ?? "medium")),
      needsWebSearch: Boolean(parsed.needsWebSearch),
      needsCodeExecution: Boolean(parsed.needsCodeExecution),
      needsFileRead: Boolean(parsed.needsFileRead),
      needsFileGen: Array.isArray(parsed.needsFileGen)
        ? (parsed.needsFileGen as string[]).filter(Boolean).map((x) => String(x) as FileGenKind)
        : [],
      searchContextSize:
        parsed.searchContextSize === "high" || parsed.searchContextSize === "medium"
          ? parsed.searchContextSize
          : "low",
      suggestedAgent: String(parsed.suggestedAgent ?? "chat"),
      confidence: Math.min(1, Math.max(0, Number(parsed.confidence ?? 0.5))),
      classifierSource: "llm",
    };

    captureRouterCall({
      component: "classifier", source: "llm", status: "completed",
      userId: ctx?.userId, conversationId: ctx?.conversationId,
      jobId: ctx?.jobId, messageId: ctx?.messageId,
      promptSystem: CLASSIFIER_PROMPT, promptUser: content,
      responseText: text,
      responseJson: parsed,
      latencyMs: Date.now() - startedAt,
      inputTokens: data.usage?.prompt_tokens ?? null,
      outputTokens: data.usage?.completion_tokens ?? null,
    });

    return result;
  } catch (error) {
    const isAbort = (error as Error).name === "AbortError";
    if (!isAbort) logger.warn({ err: error }, "router_classifier_llm_failed");
    captureRouterCall({
      component: "classifier", source: "llm",
      status: isAbort ? "timeout" : "error",
      userId: ctx?.userId, conversationId: ctx?.conversationId,
      jobId: ctx?.jobId, messageId: ctx?.messageId,
      promptSystem: CLASSIFIER_PROMPT, promptUser: content,
      latencyMs: Date.now() - startedAt,
      errorMessage: isAbort ? null : (error as Error).message,
    });
    return safeDefault();
  }
}

export async function classify(
  content: string,
  attachedFileCount: number,
  conversationLength: number,
  _plan: Plan,
  ctx?: RouterCtx,
): Promise<ClassificationResult> {
  const h = heuristicClassifier(content, attachedFileCount, conversationLength);
  if (h) return h;

  const hash = createHash("sha256").update(content).digest("hex");
  const cached = await getClassifierCache(hash);
  if (cached) return { ...cached, classifierSource: "llm" };

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 2000);
  try {
    const result = await classifyWithLlm(content, controller.signal, ctx);
    await setClassifierCache(hash, result);
    return result;
  } finally {
    clearTimeout(t);
  }
}
