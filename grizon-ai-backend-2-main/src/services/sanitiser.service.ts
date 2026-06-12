import { createHash } from "crypto";
import sanitizeHtml from "sanitize-html";

import { INJECTION_BURST_THRESHOLD, INJECTION_PATTERNS } from "../config/sanitiser.js";
import { getAgentDescriptor } from "../agents/index.js";
import { getPool } from "../db/pool.js";
import { getRedisClient } from "../infra/redis.js";
import { Errors } from "../utils/errors.js";
import type { FilePartCheck } from "../types/sanitiser.js";

function extractExtension(fileName: string): string {
  return (fileName.split(".").pop() ?? "").toLowerCase();
}

export const sanitiserService = {
  stripPromptInjection(text: string): { sanitised: string; patternsMatched: string[] } {
    let sanitised = text;
    const patternsMatched: string[] = [];
    for (const pattern of INJECTION_PATTERNS) {
      if (pattern.regex.test(sanitised)) {
        patternsMatched.push(pattern.id);
        sanitised = sanitised.replace(pattern.regex, pattern.redaction);
      }
      pattern.regex.lastIndex = 0;
    }
    return { sanitised, patternsMatched };
  },

  enforceMessageLength(text: string, max: number): void {
    const length = text.length;
    if (length > max) {
      throw Errors.messageTooLong({ length, max });
    }
  },

  sanitiseHtml(input: string): string {
    return sanitizeHtml(input, {
      allowedTags: [
        "p",
        "br",
        "span",
        "div",
        "b",
        "i",
        "em",
        "strong",
        "u",
        "code",
        "pre",
        "ul",
        "ol",
        "li",
        "h1",
        "h2",
        "h3",
        "h4",
        "a",
        "img",
      ],
      allowedAttributes: {
        a: ["href", "title"],
        img: ["src", "alt", "title"],
      },
      allowedSchemes: ["http", "https", "data"],
      allowedSchemesAppliedToAttributes: ["href", "src"],
      transformTags: {
        a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer", target: "_blank" }),
      },
      disallowedTagsMode: "discard",
    });
  },

  hashContent(userId: string, text: string): string {
    return createHash("sha256").update(`${userId}:${text}`).digest("hex").slice(0, 32);
  },

  validateFilePart(part: FilePartCheck, policy: { allowedFileTypes: Record<string, readonly string[]>; maxFileSize: number }): void {
    if (part.byteLength > policy.maxFileSize) {
      throw Errors.fileTooLarge({ max: policy.maxFileSize });
    }

    const allowedExts = policy.allowedFileTypes[part.mimeType];
    if (!allowedExts) {
      throw Errors.fileTypeNotAllowed({ allowed: Object.keys(policy.allowedFileTypes) });
    }

    const ext = extractExtension(part.fileName);
    if (!allowedExts.includes(ext)) {
      throw Errors.fileTypeMismatch({ mime: part.mimeType, ext });
    }
  },

  async isAgentActive(agentSlug: string): Promise<boolean> {
    try {
      const pool = getPool();
      const res = await pool.query(
        `SELECT is_active FROM agents WHERE slug = $1 LIMIT 1`,
        [agentSlug],
      );
      if (!res.rowCount) return false;
      return Boolean(res.rows[0]?.is_active);
    } catch {
      // Fallback: check the in-memory agent cache.
      return Boolean(getAgentDescriptor(agentSlug));
    }
  },
};

export const abuseCounter = {
  async recordRepeat(userId: string, hash: string): Promise<number> {
    const redis = await getRedisClient();
    if (!redis) return 1;
    const key = `sanitiser:repeat:${userId}:${hash}`;
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, 60);
    }
    return Number(count);
  },

  async recordInjection(userId: string, _patternsMatched: string[]): Promise<number> {
    const redis = await getRedisClient();
    if (!redis) return 0;
    const key = `sanitiser:injection_attempts:${userId}`;
    const now = Date.now();
    await redis.zAdd(key, [{ score: now, value: `${now}-${Math.random().toString(36).slice(2, 8)}` }]);
    await redis.expire(key, INJECTION_BURST_THRESHOLD.withinSec);
    await redis.zRemRangeByScore(key, 0, now - INJECTION_BURST_THRESHOLD.withinSec * 1000);
    const count = await redis.zCard(key);
    return Number(count);
  },
};
