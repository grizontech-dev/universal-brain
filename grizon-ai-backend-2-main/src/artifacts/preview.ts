import { marked } from "marked";
import sanitizeHtml from "sanitize-html";

type PreviewInput = {
  type: string;
  contentText?: string | null;
};

function parseCsvPreview(csv: string, maxRows: number): string[][] {
  return csv
    .split("\n")
    .slice(0, maxRows + 1)
    .map((line) => line.split(",").map((col) => col.trim()));
}

function renderCsvTable(rows: string[][]): string {
  if (!rows.length) return "";
  const [header, ...body] = rows;
  const th = header.map((h) => `<th>${sanitizeHtml(h)}</th>`).join("");
  const tr = body
    .map((row) => `<tr>${row.map((cell) => `<td>${sanitizeHtml(cell)}</td>`).join("")}</tr>`)
    .join("");
  return `<table><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>`;
}

export async function generatePreview(artifact: PreviewInput): Promise<{ previewHtml: string | null }> {
  const text = artifact.contentText ?? "";
  switch (artifact.type) {
    case "markdown": {
      const html = await marked.parse(text);
      return {
        previewHtml: sanitizeHtml(html, {
          allowedTags: sanitizeHtml.defaults.allowedTags.concat(["pre", "code", "h1", "h2", "h3", "table"]),
        }),
      };
    }
    case "csv":
    case "spreadsheet":
      return { previewHtml: renderCsvTable(parseCsvPreview(text, 50)) };
    case "code": {
      const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      return { previewHtml: `<pre><code>${escaped}</code></pre>` };
    }
    case "html":
      return {
        previewHtml: sanitizeHtml(text, {
          allowedTags: sanitizeHtml.defaults.allowedTags.concat(["section", "article", "header", "footer", "main"]),
          allowedAttributes: { "*": ["class", "id", "style"] },
        }),
      };
    default:
      return { previewHtml: null };
  }
}
