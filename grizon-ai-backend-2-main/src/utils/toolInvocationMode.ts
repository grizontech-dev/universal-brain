/**
 * Derives a stable `tool_mode` token for admin Tool Insights (e.g. web_search engine).
 */
export function deriveToolInvocationMode(args: {
  tool_name: string;
  response_output: unknown;
  request_args?: unknown;
}): string | null {
  const { tool_name: toolName, response_output: responseOutput } = args;

  if (toolName === "web_search") {
    if (responseOutput && typeof responseOutput === "object" && !Array.isArray(responseOutput)) {
      const engine = (responseOutput as Record<string, unknown>).engine;
      if (
        engine === "tavily" ||
        engine === "brave" ||
        engine === "serper" ||
        engine === "none"
      ) {
        return String(engine);
      }
    }
    return null;
  }

  if (responseOutput && typeof responseOutput === "object" && !Array.isArray(responseOutput)) {
    const o = responseOutput as Record<string, unknown>;
    if (typeof o.mode === "string" && o.mode.trim()) return o.mode.trim();
    if (typeof o.provider === "string" && o.provider.trim()) return o.provider.trim();
    if (typeof o.source === "string" && o.source.trim()) return o.source.trim();
  }

  return null;
}
