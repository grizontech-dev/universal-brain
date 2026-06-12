import { retrieve } from "../files/retriever.js";
import { registerTool } from "./registry.js";
import type { StreamContext } from "../types/router.js";

export async function fileRead(
  args: { fileId: string; sub_query?: string },
  ctx: StreamContext,
): Promise<{
  text: string;
  vectorised: boolean;
}> {
  const text = await retrieve(args.fileId, ctx.userId, args.sub_query);
  return {
    text,
    vectorised: true,
  };
}

registerTool({
  name: "file_read",
  description: "Read extracted text from an attached file the user uploaded.",
  parallelSafe: true,
  estimatedLatencyMs: 800,
  planRequired: "starter",
  featureFlag: "documentAnalysis",
  parametersSchema: {
    type: "object",
    properties: {
      fileId: { type: "string", description: "File UUID" },
      sub_query: { type: "string", description: "Optional semantic query within the file" },
    },
    required: ["fileId"],
  },
  execute: async (params, ctx) => {
    const p = (params && typeof params === "object" ? params : {}) as Record<string, unknown>;
    return fileRead(
      { fileId: String(p.fileId ?? ""), sub_query: p.sub_query ? String(p.sub_query) : undefined },
      ctx,
    );
  },
});
