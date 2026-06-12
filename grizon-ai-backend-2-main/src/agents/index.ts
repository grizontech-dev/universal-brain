/**
 * Agent index — re-exports from the DB-backed agentLoader.
 *
 * AGENT_CATALOGUE has been replaced by the live DB cache.
 * Call initAgentLoader() at app startup before any of these functions are used.
 */
export {
  getAgentDescriptor as getAgent,
  getAgentDescriptor,
  getAllAgentDescriptors,
  getSystemAgentSlugs,
  reloadAgentCache,
} from "../services/agentLoader.service.js";

/** AgentSlug is now dynamic (loaded from DB). */
export type AgentSlug = string;
