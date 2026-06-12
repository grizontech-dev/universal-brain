import "../tools/index.js";

import type { ClassificationResult, ToolId, ToolSpec } from "../types/router.js";
import type { AgentDescriptor } from "../types/router.js";
import type { Plan } from "../types/plan.js";
import { getToolsForAgent } from "../tools/registry.js";

// All known ToolIds — used when iterating tools for a given agent.
const ALL_TOOL_IDS: ToolId[] = [
  "web_search", "web_fetch", "code_execution", "file_read", "file_gen",
  "html_generate", "chart_generate", "image_analyse", "stock_data", "get_weather",
];

/**
 * Tools that require an explicit classification signal in auto mode.
 * These are NOT offered ambially — only when the classifier says they're needed.
 * Uses feature-flag keys (same namespace as AgentDescriptor.allowedTools).
 */
const CLASSIFICATION_TRIGGERED = new Set<string>([
  "webSearch", "codeExecution", "documentAnalysis", "documentCreation",
]);

export function resolveAllowedTools(
  classification: ClassificationResult,
  agent: AgentDescriptor,
  plan: Plan,
  source: "agent" | "auto",
): ToolId[] {
  const flag = (k: string) => plan.featureFlags[k] === true;

  if (source === "agent") {
    // Iterate all known tool IDs; include those whose feature-flag key is in agent.allowedTools
    // and whose plan feature flag is enabled.
    return ALL_TOOL_IDS.filter((id) => toolAllowedWithFlags(id, agent, flag));
  }

  const fromClassification = classificationTriggeredTools(classification, agent, flag);
  const ambient = ambientToolsForAuto(agent, flag);
  return [...new Set([...fromClassification, ...ambient])];
}

/**
 * A tool is allowed when:
 * 1. Its feature-flag key is in agent.allowedTools (agent-level permission), AND
 * 2. The plan's feature flag for that key is enabled (plan-level permission).
 *
 * agent.allowedTools stores feature-flag camelCase keys (e.g. "webSearch"),
 * aligned with the allowed_features column and plan.featureFlags.
 */
function toolAllowedWithFlags(id: ToolId, agent: AgentDescriptor, flag: (k: string) => boolean): boolean {
  const fk = featureFlagKeyForTool(id);
  if (!fk) return false;
  if (!agent.allowedTools.includes(fk)) return false;  // agent permission
  if (!flag(fk)) return false;                          // plan feature-flag
  return true;
}

/** Maps ToolId (snake_case) → feature-flag key (camelCase). */
function featureFlagKeyForTool(id: ToolId): string | undefined {
  switch (id) {
    case "web_search":      return "webSearch";
    case "code_execution":  return "codeExecution";
    case "file_read":       return "documentAnalysis";
    case "file_gen":        return "documentCreation";
    case "web_fetch":       return "webFetch";
    case "html_generate":   return "htmlPreview";
    case "chart_generate":  return "chartGenerate";
    case "image_analyse":   return "imageAnalyse";
    case "stock_data":      return "stockData";
    case "get_weather":     return "weatherData";
    default:                return undefined;
  }
}

function classificationTriggeredTools(
  classification: ClassificationResult,
  agent: AgentDescriptor,
  flag: (k: string) => boolean,
): ToolId[] {
  const tools: ToolId[] = [];
  if (classification.needsWebSearch      && toolAllowedWithFlags("web_search",     agent, flag)) tools.push("web_search");
  if (classification.needsCodeExecution  && toolAllowedWithFlags("code_execution", agent, flag)) tools.push("code_execution");
  if (classification.needsFileRead       && toolAllowedWithFlags("file_read",       agent, flag)) tools.push("file_read");
  if (classification.needsFileGen.length && toolAllowedWithFlags("file_gen",        agent, flag)) tools.push("file_gen");
  return tools;
}

/**
 * Tools offered to auto-mode agents without a specific classifier signal.
 * Generic: uses agent.allowedTools (feature-flag keys) minus CLASSIFICATION_TRIGGERED.
 * No more hardcoded slug-specific if-blocks.
 */
function ambientToolsForAuto(agent: AgentDescriptor, flag: (k: string) => boolean): ToolId[] {
  return ALL_TOOL_IDS.filter((id) => {
    const fk = featureFlagKeyForTool(id);
    if (!fk || CLASSIFICATION_TRIGGERED.has(fk)) return false;
    return toolAllowedWithFlags(id, agent, flag);
  });
}

export function toolSpecsFor(ids: ToolId[]): ToolSpec[] {
  const defs = getToolsForAgent(ids);
  const byName = new Map(defs.map((d) => [d.name, d]));
  return ids.map((id) => {
    const def = byName.get(id);
    if (!def) {
      return {
        name: id,
        description: id,
        parameters: { type: "object", properties: {} },
      };
    }
    return {
      name: def.name,
      description: def.description,
      parameters: def.parametersSchema,
    };
  });
}
