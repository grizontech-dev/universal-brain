import { getAgentDescriptor } from "../services/agentLoader.service.js";
import { chatAgent as STATIC_CHAT_AGENT } from "../agents/chat.agent.js";
import type { Plan } from "../types/plan.js";
import type { AgentDescriptor, ClassificationResult, Intent } from "../types/router.js";

const AGENT_FOR_INTENT: Record<Intent, string> = {
  search: "research",
  code: "code",
  write: "writer",
  analyse: "analyst",
  design: "architect", // not auto-eligible → falls back to "code"
  debug: "debugger",
  ui: "ui", // not auto-eligible → falls back to "code"
  document: "document",
  chat: "general",
  math: "math", // not auto-eligible → falls back to "general"
  fact: "fact-check", // not auto-eligible → falls back to "research"
};

/**
 * Universal fallback agent. `general` is the everyday root of every fallback
 * ladder. The static chatAgent definition is used only while agents are not yet
 * seeded into the DB — prevents hard crashes during the transition period.
 */
function chatFallback(): AgentDescriptor {
  return getAgentDescriptor("general") ?? STATIC_CHAT_AGENT;
}

/**
 * Auto Mode target resolution. An agent is a valid Auto target only when it is
 * BOTH in the plan's agentAccess AND tagged is_auto_eligible. Otherwise we walk
 * the fallbackAgent ladder until we reach an eligible, in-plan agent — ultimately
 * `general`. Direct Model and expensive/specialist agents are is_auto_eligible =
 * false, so Auto can never land on them.
 */
export function pickAgent(intent: Intent, plan: Plan, _classification?: ClassificationResult): AgentDescriptor {
  let candidate = AGENT_FOR_INTENT[intent] ?? "general";
  for (let i = 0; i < 12; i++) {
    const desc = getAgentDescriptor(candidate);
    if (desc && desc.isAutoEligible && plan.agentAccess.includes(candidate)) {
      return desc;
    }
    if (!desc?.fallbackAgent) {
      return chatFallback();
    }
    candidate = desc.fallbackAgent;
  }
  return chatFallback();
}

/** Resolve explicit agent slug with fallback ladder when plan blocks it. */
export function resolveExplicitAgent(slug: string, plan: Plan): AgentDescriptor {
  let candidate = slug;
  for (let i = 0; i < 12; i++) {
    if (plan.agentAccess.includes(candidate)) {
      return getAgentDescriptor(candidate) ?? chatFallback();
    }
    const desc = getAgentDescriptor(candidate);
    if (!desc?.fallbackAgent) return chatFallback();
    candidate = desc.fallbackAgent;
  }
  return chatFallback();
}
