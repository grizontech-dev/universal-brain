/**
 * Runtime hooks registry.
 *
 * Contains only the preflight / postProcess functions that cannot be stored in the DB.
 * Keyed by agent slug. Registered into agentLoader at startup so hooks are attached
 * to AgentDescriptor objects after loading from DB.
 *
 * *.agent.ts files are kept as reference; hook implementations are sourced from
 * researchSources.ts (shared utility) or defined inline below.
 */

import type { AgentHooks } from "../types/router.js";
import { researchPreflight, researchPostProcess } from "./researchSources.js";

export const AGENT_HOOKS: Record<string, AgentHooks> = {
  research: {
    preflight: (query, _ctx) => researchPreflight(query),
    postProcess: (content, ctx) => researchPostProcess(content, ctx),
  },
  deep_research: {
    preflight: (query, _ctx) => researchPreflight(query),
    postProcess: (content, ctx) => researchPostProcess(content, ctx),
  },
  ui: {
    postProcess: (content, _ctx) => {
      if (content.includes("<!DOCTYPE html>")) {
        return content
          .replace(/<!DOCTYPE html>[\s\S]*?<\/html>/gi, "[HTML moved to artifact]")
          .trim();
      }
      return content;
    },
  },
};
