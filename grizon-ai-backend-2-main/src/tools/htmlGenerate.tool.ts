import sanitizeHtml from "sanitize-html";

import { artifactService } from "../services/artifact.service.js";
import { registerTool } from "./registry.js";
import type { StreamContext } from "../types/router.js";

const sanitiseConfig: sanitizeHtml.IOptions = {
  allowedTags: sanitizeHtml.defaults.allowedTags.concat([
    "html",
    "head",
    "body",
    "style",
    "script",
    "canvas",
    "svg",
    "path",
    "circle",
    "rect",
    "section",
    "article",
    "header",
    "footer",
    "main",
    "nav",
  ]),
  allowedAttributes: {
    ...sanitizeHtml.defaults.allowedAttributes,
    "*": ["class", "id", "style"],
  },
  allowedSchemes: ["http", "https", "data"],
  allowVulnerableTags: true,
  disallowedTagsMode: "discard",
};

export async function htmlGenerate(
  params: { reason?: string; html: string; title: string; description?: string },
  ctx: StreamContext,
): Promise<{ artifactId: string; title: string; previewAvailable: boolean }> {
  const sanitised = sanitizeHtml(params.html, sanitiseConfig);
  const artifact = await artifactService.create({
    userId: ctx.userId,
    conversationId: ctx.conversationId,
    messageId: ctx.messageId ?? null,
    title: params.title,
    type: "html",
    contentText: sanitised,
    storagePath: null,
    contentHash: null,
    fileSize: Buffer.byteLength(sanitised, "utf-8"),
    createdByAgent: "ui",
    maxVersions: ctx.maxArtifactVersions,
  });
  return { artifactId: artifact.id, title: params.title, previewAvailable: true };
}

registerTool({
  name: "html_generate",
  description: "Create an HTML artifact from LLM-produced HTML/CSS/JS (sanitised) for UI preview.",
  parallelSafe: false,
  estimatedLatencyMs: 800,
  planRequired: "starter",
  featureFlag: "htmlPreview",
  parametersSchema: {
    type: "object",
    properties: {
      reason: { type: "string" },
      html: { type: "string" },
      title: { type: "string" },
      description: { type: "string" },
    },
    required: ["html", "title"],
  },
  execute: async (params, ctx) => {
    const p = (params && typeof params === "object" ? params : {}) as Record<string, unknown>;
    return htmlGenerate(
      {
        reason: p.reason !== undefined ? String(p.reason) : undefined,
        html: String(p.html ?? ""),
        title: String(p.title ?? "HTML"),
        description: p.description !== undefined ? String(p.description) : undefined,
      },
      ctx,
    );
  },
});
