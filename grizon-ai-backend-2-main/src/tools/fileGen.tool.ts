import { createHash } from "crypto";
import ExcelJS from "exceljs";
import { AlignmentType, Document, HeadingLevel, PageBreak, Packer, Paragraph, TextRun } from "docx";
import PDFDocument from "pdfkit";
import { marked } from "marked";

import { getArtifactStorage } from "../artifacts/artifact.storage.js";
import {
  normalizeKind,
  sanitizeTitle,
  specForKind,
  stripKnownExtension,
  type CanonicalKind,
} from "../artifacts/fileKinds.js";
import { artifactService } from "../services/artifact.service.js";
import { registerTool } from "./registry.js";
import type { StreamContext } from "../types/router.js";

export type { FileGenKind } from "../artifacts/fileKinds.js";

function stripInlineMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/gs, "$1")
    .replace(/\*(.+?)\*/gs, "$1")
    .replace(/`(.+?)`/gs, "$1")
    .replace(/\[(.+?)\]\(.+?\)/gs, "$1")
    .replace(/~~(.+?)~~/gs, "$1");
}

function inlineToRuns(text: string): TextRun[] {
  const runs: TextRun[] = [];
  const re = /\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`/gs;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) runs.push(new TextRun({ text: text.slice(last, m.index) }));
    if (m[1] !== undefined) runs.push(new TextRun({ text: m[1], bold: true }));
    else if (m[2] !== undefined) runs.push(new TextRun({ text: m[2], italics: true }));
    else if (m[3] !== undefined) runs.push(new TextRun({ text: m[3], font: "Courier New" }));
    last = m.index + m[0].length;
  }
  if (last < text.length) runs.push(new TextRun({ text: text.slice(last) }));
  return runs.length ? runs : [new TextRun({ text })];
}

/**
 * Builds a cover page + body paragraphs for a DOCX document.
 *
 * Cover page layout (first page):
 *   ~1/3 down  →  Title   (centered, 32 pt bold)
 *                 Subtitle (centered, 18 pt, if provided)
 *                 Date     (centered, 11 pt italic)
 *   ~bottom    →  "Written by Grizon AI" (centered, 10 pt italic)
 *   Page break → body content starts on page 2
 */
function markdownToDocxParagraphs(
  markdown: string,
  titleText: string,
  subtitle?: string,
  dateStr?: string,
): Paragraph[] {
  const headingLevels = [
    HeadingLevel.HEADING_1,
    HeadingLevel.HEADING_2,
    HeadingLevel.HEADING_3,
    HeadingLevel.HEADING_4,
    HeadingLevel.HEADING_5,
    HeadingLevel.HEADING_6,
  ];

  // ── Cover page ──────────────────────────────────────────────────────────
  // Push title ~1/3 down the page using top spacing (twips: 1 inch = 1440).
  const paras: Paragraph[] = [
    // Spacer — ~3 inches from top to title
    new Paragraph({
      children: [new TextRun({ text: "" })],
      spacing: { before: 4320 },
    }),
    // Title
    new Paragraph({
      children: [new TextRun({ text: titleText, bold: true, size: 64 })], // 32 pt
      alignment: AlignmentType.CENTER,
      spacing: { after: 240 },
    }),
    // Subtitle (optional)
    ...(subtitle?.trim()
      ? [new Paragraph({
          children: [new TextRun({ text: subtitle.trim(), size: 36 })], // 18 pt
          alignment: AlignmentType.CENTER,
          spacing: { after: 200 },
        })]
      : []),
    // Date
    new Paragraph({
      children: [new TextRun({ text: dateStr ?? "", italics: true, size: 22 })], // 11 pt
      alignment: AlignmentType.CENTER,
      spacing: { after: 0 },
    }),
    // Push "Written by Grizon AI" toward the bottom (~4 inches of spacing)
    new Paragraph({
      children: [new TextRun({ text: "Written by Grizon AI", italics: true, size: 20 })], // 10 pt
      alignment: AlignmentType.CENTER,
      spacing: { before: 5760, after: 0 }, // ~4 inches
    }),
    // Page break — body starts on page 2
    new Paragraph({
      children: [new PageBreak()],
    }),
  ];

  // ── Body content ────────────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tokens = marked.lexer(markdown) as any[];
  for (const token of tokens) {
    if (token.type === "heading") {
      paras.push(new Paragraph({
        children: inlineToRuns(token.text as string),
        heading: headingLevels[(token.depth as number) - 1] ?? HeadingLevel.HEADING_1,
      }));
    } else if (token.type === "paragraph") {
      paras.push(new Paragraph({ children: inlineToRuns(token.text as string) }));
    } else if (token.type === "list") {
      let idx = Number(token.start ?? 1);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const item of token.items as any[]) {
        const bullet = token.ordered ? `${idx++}. ` : "• ";
        paras.push(new Paragraph({
          children: [new TextRun({ text: bullet }), ...inlineToRuns(item.text as string)],
          indent: { left: 360 },
        }));
      }
    } else if (token.type === "code") {
      for (const line of (token.text as string).split("\n")) {
        paras.push(new Paragraph({
          children: [new TextRun({ text: line.length ? line : " ", font: "Courier New" })],
          indent: { left: 360 },
        }));
      }
    } else if (token.type === "blockquote") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const inner of (token.tokens ?? []) as any[]) {
        if (inner.text) {
          paras.push(new Paragraph({
            children: [new TextRun({ text: stripInlineMarkdown(inner.text as string), italics: true })],
            indent: { left: 720 },
          }));
        }
      }
    }
  }

  return paras;
}

/**
 * Renders a PDF with a structured cover page (page 1) and body content (page 2+).
 *
 * Cover page:
 *   ~1/3 down  →  Title    (centered, 28 pt bold)
 *                 Subtitle  (centered, 16 pt, if provided)
 *                 Date      (centered, 12 pt italic)
 *   ~bottom    →  "Written by Grizon AI" (centered, 10 pt italic)
 * Page 2+: body content rendered from markdown.
 */
async function bufferFromPdf(title: string, subtitle: string | undefined, dateStr: string, content: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const MARGIN = 60;
    const doc = new PDFDocument({ margin: MARGIN, size: "A4" });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const pageH = doc.page.height;   // 841.89 pt (A4)
    const pageW = doc.page.width;    // 595.28 pt (A4)
    const contentW = pageW - MARGIN * 2;

    // ── Cover page ────────────────────────────────────────────────────────
    // Title block centred at ~38% down the page
    const titleY = pageH * 0.38;
    doc.y = titleY;

    doc
      .fontSize(28)
      .font("Helvetica-Bold")
      .text(title, MARGIN, doc.y, { align: "center", width: contentW });

    doc.moveDown(0.6);

    if (subtitle?.trim()) {
      doc
        .fontSize(16)
        .font("Helvetica")
        .text(subtitle.trim(), MARGIN, doc.y, { align: "center", width: contentW });
      doc.moveDown(0.5);
    }

    doc
      .fontSize(12)
      .font("Helvetica-Oblique")
      .text(dateStr, MARGIN, doc.y, { align: "center", width: contentW });

    // "Written by Grizon AI" pinned near the bottom of the cover page
    const footerY = pageH - MARGIN - 20;
    doc
      .fontSize(10)
      .font("Helvetica-Oblique")
      .text("Written by Grizon AI", MARGIN, footerY, { align: "center", width: contentW });

    // ── Body content (page 2+) ────────────────────────────────────────────
    doc.addPage();
    doc.fontSize(11).font("Helvetica");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tokens = marked.lexer(content) as any[];
    const headingSizes = [18, 15, 13, 12, 11, 11];

    for (const token of tokens) {
      if (token.type === "heading") {
        const size = headingSizes[(token.depth as number) - 1] ?? 12;
        doc.moveDown(0.4);
        doc.fontSize(size).font("Helvetica-Bold").text(stripInlineMarkdown(token.text as string)).moveDown(0.25);
        doc.fontSize(11).font("Helvetica");
      } else if (token.type === "paragraph") {
        doc.fontSize(11).font("Helvetica").text(stripInlineMarkdown(token.text as string)).moveDown(0.5);
      } else if (token.type === "list") {
        let idx = Number(token.start ?? 1);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const item of token.items as any[]) {
          const bullet = token.ordered ? `${idx++}. ` : "• ";
          doc
            .fontSize(11)
            .font("Helvetica")
            .text(`${bullet}${stripInlineMarkdown(item.text as string)}`, { indent: 20 })
            .moveDown(0.2);
        }
        doc.moveDown(0.3);
      } else if (token.type === "code") {
        doc.fontSize(10).font("Courier").text(token.text as string).moveDown(0.5);
        doc.fontSize(11).font("Helvetica");
      } else if (token.type === "blockquote") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const inner of (token.tokens ?? []) as any[]) {
          if (inner.text) {
            doc
              .fontSize(11)
              .font("Helvetica-Oblique")
              .text(stripInlineMarkdown(inner.text as string), { indent: 30 })
              .moveDown(0.5);
          }
        }
        doc.font("Helvetica");
      }
    }

    doc.end();
  });
}

export async function fileGen(
  args: {
    kind: CanonicalKind;
    title: string;
    subtitle?: string;
    content?: string;
  },
  ctx: StreamContext,
): Promise<{ artifactId: string; kind: string; filename: string }> {
  const spec = specForKind(args.kind);
  const body = args.content ?? "";
  const cleanTitle = sanitizeTitle(stripKnownExtension(args.title));
  if (!cleanTitle) {
    throw new Error("invalid_title:title must be a non-empty descriptive name");
  }
  // Human-readable date for the cover page, e.g. "27 May 2026"
  const dateStr = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

  const filename = `${cleanTitle}${spec.extension}`;
  const userPrefix = `${ctx.userId}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const key = `${userPrefix}${spec.extension}`;

  let buffer: Buffer | null = null;
  let contentText: string | null = null;
  let storagePath: string | null = key;

  if (args.kind === "excel") {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Sheet1");

    // Parse CSV-formatted content into rows and columns
    const lines = body.split(/\r?\n/).filter((l) => l.trim() !== "");
    for (let rowIdx = 0; rowIdx < lines.length; rowIdx++) {
      // Simple CSV field parser that handles quoted fields
      const fields: string[] = [];
      let field = "";
      let inQuotes = false;
      const line = lines[rowIdx];
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          if (inQuotes && line[i + 1] === '"') { field += '"'; i++; }
          else inQuotes = !inQuotes;
        } else if (ch === "," && !inQuotes) {
          fields.push(field);
          field = "";
        } else {
          field += ch;
        }
      }
      fields.push(field);

      const excelRow = ws.getRow(rowIdx + 1);
      for (let colIdx = 0; colIdx < fields.length; colIdx++) {
        const cell = excelRow.getCell(colIdx + 1);
        const raw = fields[colIdx].trim();
        const num = Number(raw);
        cell.value = raw !== "" && !isNaN(num) ? num : raw;

        // Bold the header row
        if (rowIdx === 0) {
          cell.font = { bold: true };
        }
      }
      excelRow.commit();
    }

    buffer = Buffer.from(await wb.xlsx.writeBuffer());
    contentText = body.slice(0, 2000);
  } else if (args.kind === "docx") {
    const doc = new Document({
      sections: [{ children: markdownToDocxParagraphs(body, cleanTitle, args.subtitle, dateStr) }],
    });
    buffer = Buffer.from(await Packer.toBuffer(doc));
    contentText = body.slice(0, 2000);
  } else if (args.kind === "pdf") {
    buffer = await bufferFromPdf(cleanTitle, args.subtitle, dateStr, body);
    contentText = null;
  } else if (args.kind === "txt") {
    buffer = Buffer.from(body, "utf-8");
    contentText = body.slice(0, 4000);
  } else if (args.kind === "csv") {
    buffer = Buffer.from(body, "utf-8");
    contentText = body.slice(0, 8000);
  } else {
    // markdown — stored inline, no binary upload
    buffer = null;
    storagePath = null;
    contentText = body;
  }

  let contentHash: string | null = null;
  let fileSize: number | null = null;
  if (buffer) {
    await getArtifactStorage().put(key, buffer, spec.mimeType);
    contentHash = createHash("sha256").update(buffer).digest("hex");
    fileSize = buffer.byteLength;
  } else if (contentText) {
    fileSize = Buffer.byteLength(contentText, "utf-8");
  }

  const artifact = await artifactService.create({
    userId: ctx.userId,
    conversationId: ctx.conversationId,
    messageId: ctx.messageId ?? null,
    title: cleanTitle,
    type: spec.artifactType,
    contentText,
    storagePath,
    contentHash,
    fileSize,
    createdByAgent: "document",
    maxVersions: ctx.maxArtifactVersions,
  });

  return { artifactId: artifact.id, kind: args.kind, filename };
}

registerTool({
  name: "file_gen",
  description:
    "Generate a downloadable artifact (spreadsheet, document, PDF, TXT, CSV, markdown). " +
    "For docx/pdf: always pass `subtitle` (one descriptive line shown under the title on the cover page). " +
    "ALWAYS provide a short, descriptive `title` — no extensions, no generic names like 'output'. " +
    "The system appends the extension automatically. " +
    "After calling this tool reply with only 1–2 sentences summarising what was created. " +
    "Do NOT include any file links or sandbox:/ paths — the frontend shows a download card automatically.",
  parallelSafe: false,
  estimatedLatencyMs: 1500,
  planRequired: "starter",
  featureFlag: "documentCreation",
  parametersSchema: {
    type: "object",
    properties: {
      kind: {
        type: "string",
        enum: ["excel", "xlsx", "docx", "word", "markdown", "md", "pdf", "txt", "csv"],
      },
      title: {
        type: "string",
        minLength: 1,
        description: "Short, descriptive filename without extension (e.g. 'Q3 Sales Summary').",
      },
      subtitle: {
        type: "string",
        description:
          "One-line subtitle shown on the cover page of docx/pdf documents " +
          "(e.g. 'Prepared for Acme Corp — Q3 2026'). Omit for spreadsheets, CSV, and TXT.",
      },
      content: { type: "string" },
    },
    required: ["kind", "title"],
  },
  execute: async (params, ctx) => {
    const p = (params && typeof params === "object" ? params : {}) as Record<string, unknown>;
    const rawKind = String(p.kind ?? "");
    const kind = normalizeKind(rawKind);
    if (!kind) {
      throw new Error(`unsupported_file_kind:${rawKind}`);
    }
    const rawTitle = typeof p.title === "string" ? p.title : "";
    if (!rawTitle.trim()) {
      throw new Error("invalid_title:title is required and must be a non-empty descriptive name");
    }
    return fileGen(
      {
        kind,
        title: rawTitle,
        subtitle: typeof p.subtitle === "string" && p.subtitle.trim() ? p.subtitle : undefined,
        content: p.content !== undefined ? String(p.content) : undefined,
      },
      ctx,
    );
  },
});

export type { CanonicalKind } from "../artifacts/fileKinds.js";
