import type { StreamContext, ToolId } from "../types/router.js";

export type PlanTierGate = "free" | "starter" | "pro" | "enterprise";

export interface ToolDefinition {
  name: ToolId;
  description: string;
  parametersSchema: Record<string, unknown>;
  planRequired: PlanTierGate;
  featureFlag?: string;
  parallelSafe: boolean;
  estimatedLatencyMs: number;
  execute: (params: unknown, ctx: StreamContext) => Promise<unknown>;
}

const TOOL_REGISTRY = new Map<ToolId, ToolDefinition>();

export function registerTool(def: ToolDefinition): void {
  TOOL_REGISTRY.set(def.name, def);
}

export function getTool(name: ToolId): ToolDefinition | undefined {
  return TOOL_REGISTRY.get(name);
}

export function getToolsForAgent(allowedTools: ToolId[]): ToolDefinition[] {
  return allowedTools.map((n) => TOOL_REGISTRY.get(n)).filter(Boolean) as ToolDefinition[];
}

export function allRegisteredToolIds(): ToolId[] {
  return [...TOOL_REGISTRY.keys()];
}
