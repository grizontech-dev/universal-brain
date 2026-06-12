import { createHash } from "crypto";

import { getArtifactStorage } from "../artifacts/artifact.storage.js";
import { artifactService } from "../services/artifact.service.js";
import { codeExecution } from "./codeExecution.tool.js";
import { registerTool } from "./registry.js";
import type { StreamContext } from "../types/router.js";

export type ChartType = "bar" | "line" | "pie" | "scatter" | "histogram";

function buildPython(chartType: ChartType, dataB64: string, titleB64: string, xLb64: string, yLb64: string): string {
  return `
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import json, io, base64
data = json.loads(base64.b64decode("${dataB64}").decode("utf-8"))
labels = data['labels']
datasets = data['datasets']
chart_type = "${chartType}"
title = base64.b64decode("${titleB64}").decode("utf-8")
x_label = base64.b64decode("${xLb64}").decode("utf-8")
y_label = base64.b64decode("${yLb64}").decode("utf-8")
fig, ax = plt.subplots(figsize=(8, 5))
if chart_type == 'bar':
    import numpy as np
    x = np.arange(len(labels))
    n = max(len(datasets), 1)
    w = 0.8 / n
    for i, ds in enumerate(datasets):
        vals = ds['values']
        ax.bar(x + i * w, vals, w, label=str(ds.get('label','')))
    ax.set_xticks(x + w * (n - 1) / 2 if n else 0)
    ax.set_xticklabels(labels, rotation=45, ha='right')
elif chart_type == 'line':
    for ds in datasets:
        ax.plot(range(len(labels)), ds['values'], marker='o', label=str(ds.get('label','')))
    ax.set_xticks(range(len(labels)))
    ax.set_xticklabels(labels, rotation=45, ha='right')
elif chart_type == 'pie':
    vals = datasets[0]['values'] if datasets else []
    ax.pie(vals, labels=labels[:len(vals)], autopct='%1.1f%%')
elif chart_type == 'scatter':
    if datasets:
        ax.scatter(range(len(labels)), datasets[0]['values'])
        ax.set_xticks(range(len(labels)))
        ax.set_xticklabels(labels, rotation=45, ha='right')
elif chart_type == 'histogram':
    if datasets:
        vals = datasets[0]['values']
        ax.hist(vals, bins=min(20, max(5, len(vals)//3 or 5)))
ax.set_title(title)
if chart_type != 'pie':
    ax.set_xlabel(x_label)
    ax.set_ylabel(y_label)
if chart_type in ('bar','line') and len(datasets) > 1:
    ax.legend()
plt.tight_layout()
buf = io.BytesIO()
plt.savefig(buf, format='png', dpi=150, bbox_inches='tight')
print(base64.b64encode(buf.getvalue()).decode())
`;
}

export async function chartGenerate(
  params: {
    reason?: string;
    chart_type: ChartType;
    data: { labels: string[]; datasets: { label: string; values: number[] }[] };
    title?: string;
    x_label?: string;
    y_label?: string;
  },
  ctx: StreamContext,
): Promise<{ artifactId: string; title: string } | { error: string }> {
  const dataB64 = Buffer.from(JSON.stringify(params.data), "utf-8").toString("base64");
  const titleB64 = Buffer.from(params.title ?? "Chart", "utf-8").toString("base64");
  const xLb64 = Buffer.from(params.x_label ?? "", "utf-8").toString("base64");
  const yLb64 = Buffer.from(params.y_label ?? "", "utf-8").toString("base64");
  const py = buildPython(params.chart_type, dataB64, titleB64, xLb64, yLb64);
  const out = await codeExecution({ language: "python", source: py });
  if (!out.stdout.trim()) {
    return { error: out.stderr || "chart_execution_failed" };
  }
  const lines = out.stdout.trim().split(/\r?\n/).filter(Boolean);
  const b64 = lines[lines.length - 1] ?? "";
  let png: Buffer;
  try {
    png = Buffer.from(b64, "base64");
  } catch {
    return { error: "invalid_chart_output" };
  }
  if (png.length < 100) {
    return { error: out.stderr || "chart_png_too_small" };
  }

  const userPrefix = `${ctx.userId}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const key = `${userPrefix}.png`;
  await getArtifactStorage().put(key, png, "image/png");
  const hash = createHash("sha256").update(png).digest("hex");
  const title = params.title ?? `${params.chart_type} chart`;
  const artifact = await artifactService.create({
    userId: ctx.userId,
    conversationId: ctx.conversationId,
    messageId: ctx.messageId ?? null,
    title,
    type: "image",
    contentText: null,
    storagePath: key,
    contentHash: hash,
    fileSize: png.byteLength,
    createdByAgent: "analyst",
    maxVersions: ctx.maxArtifactVersions,
  });
  return { artifactId: artifact.id, title };
}

registerTool({
  name: "chart_generate",
  description: "Generate a chart image from tabular data via sandboxed Python (matplotlib).",
  parallelSafe: false,
  estimatedLatencyMs: 8000,
  planRequired: "pro",
  featureFlag: "chartGenerate",
  parametersSchema: {
    type: "object",
    properties: {
      reason: { type: "string" },
      chart_type: { type: "string", enum: ["bar", "line", "pie", "scatter", "histogram"] },
      data: {
        type: "object",
        properties: {
          labels: { type: "array", items: { type: "string" } },
          datasets: {
            type: "array",
            items: {
              type: "object",
              properties: {
                label: { type: "string" },
                values: { type: "array", items: { type: "number" } },
              },
              required: ["label", "values"],
            },
          },
        },
        required: ["labels", "datasets"],
      },
      title: { type: "string" },
      x_label: { type: "string" },
      y_label: { type: "string" },
    },
    required: ["chart_type", "data"],
  },
  execute: async (params, ctx) => {
    const p = (params && typeof params === "object" ? params : {}) as Record<string, unknown>;
    const ct = p.chart_type as ChartType;
    const allowed: ChartType[] = ["bar", "line", "pie", "scatter", "histogram"];
    if (!allowed.includes(ct)) {
      return { error: "invalid_chart_type" };
    }
    const data = p.data as { labels: string[]; datasets: { label: string; values: number[] }[] };
    if (!data?.labels || !data?.datasets) {
      return { error: "invalid_data" };
    }
    return chartGenerate(
      {
        reason: p.reason !== undefined ? String(p.reason) : undefined,
        chart_type: ct,
        data,
        title: p.title !== undefined ? String(p.title) : undefined,
        x_label: p.x_label !== undefined ? String(p.x_label) : undefined,
        y_label: p.y_label !== undefined ? String(p.y_label) : undefined,
      },
      ctx,
    );
  },
});
