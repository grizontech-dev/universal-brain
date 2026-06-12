import type { Plan, PlanCredits, PlanLimits, PlanPricing } from "../types/plan.js";

export function toIso(d: Date | string): string {
  return d instanceof Date ? d.toISOString() : new Date(d).toISOString();
}

/** Map a `plans` table row to API `Plan` (camelCase). */
export function planRowToPlan(row: Record<string, unknown>): Plan {
  return {
    id: String(row.id),
    name: String(row.name),
    slug: String(row.slug),
    status: row.status as Plan["status"],
    isPublic: Boolean(row.is_public),
    isIntroductory: Boolean(row.is_introductory),
    pricing: row.pricing as PlanPricing,
    credits: {
      ...(row.credits as PlanCredits),
      creditDiscount: (row.credits as PlanCredits).creditDiscount ?? 1,
    },
    limits: row.limits as PlanLimits,
    agentAccess: (row.agent_access as string[]) ?? [],
    featureFlags: (row.feature_flags as Record<string, boolean>) ?? {},
    featureLimits: (row.feature_limits as Plan["featureLimits"]) ?? undefined,
    createdAt: toIso(row.created_at as string),
    archivedAt: row.archived_at ? toIso(row.archived_at as string) : null,
    createdBy: String(row.created_by),
  };
}
