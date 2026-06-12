import type { InjectionPattern, SanitiserPolicy } from "../types/sanitiser.js";

export const FILE_ALLOWLIST: Readonly<Record<string, readonly string[]>> = {
  "application/pdf": ["pdf"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ["docx"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ["xlsx"],
  "text/csv": ["csv"],
  "text/plain": ["txt"],
  "image/png": ["png"],
  "image/jpeg": ["jpg", "jpeg"],
  "video/mp4": ["mp4"],
};

export const INJECTION_PATTERNS: InjectionPattern[] = [
  {
    id: "ignore_prev_instructions",
    regex: /\b(ignore|disregard|forget)\s+(all\s+)?(previous|earlier|the\s+above)\s+(instructions|context|prompts)\b/gi,
    redaction: "",
  },
  {
    id: "system_prompt_leak",
    regex: /\b(reveal|show|print|output)\s+(your|the)\s+system\s+prompt\b/gi,
    redaction: "",
  },
  {
    id: "dan_persona",
    regex: /\b(you\s+are\s+(now\s+)?DAN|do\s+anything\s+now)\b/gi,
    redaction: "",
  },
  {
    id: "jailbreak_keyword",
    regex: /\b(jailbreak|developer\s+mode\s+enabled|unfiltered\s+mode)\b/gi,
    redaction: "",
  },
  {
    id: "pretend_other_ai",
    regex: /\b(pretend\s+to\s+be|act\s+as)\s+(another\s+(ai|llm)|chatgpt|gpt-?[0-9]+|claude|gemini|llama)/gi,
    redaction: "",
  },
  {
    id: "fake_system_marker",
    regex: /\[\s*(system|assistant)\s*[:\]]/gi,
    redaction: "",
  },
  {
    id: "tool_call_forgery",
    regex: /<tool_call[^>]*>[\s\S]*?<\/tool_call>/gi,
    redaction: "",
  },
];

export const HTML_FIELDS = new Set(["title", "content"]);

export const REPEAT_THRESHOLD = { count: 5, withinSec: 60 } as const;
export const INJECTION_BURST_THRESHOLD = { count: 5, withinSec: 600 } as const;

export const SKIP_ROUTES = new Set([
  "OPTIONS *",
  "GET /health",
  "GET /",
  "GET /api/v1/chat/stream/:jobId",
]);

const DEFAULT_FREE_MESSAGE_CAP = 2_000;
const DEFAULT_FREE_FILE_CAP = 5 * 1024 * 1024;

export function defaultPolicy(args: {
  maxMessageLength?: number;
  maxFileSize?: number;
  injectionMode?: "strip" | "reject";
}): SanitiserPolicy {
  return {
    allowedFileTypes: FILE_ALLOWLIST,
    maxMessageLength: args.maxMessageLength ?? DEFAULT_FREE_MESSAGE_CAP,
    maxFileSize: args.maxFileSize ?? DEFAULT_FREE_FILE_CAP,
    injectionMode: args.injectionMode ?? "strip",
  };
}
