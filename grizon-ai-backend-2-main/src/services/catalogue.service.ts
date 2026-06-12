import { getPool } from "../db/pool.js";
import type { Plan } from "../types/plan.js";

interface AgentRow {
  slug: string;
  display_name: string;
  short_description: string;
  long_description: string;
  icon_url: string | null;
  tags: string[];
  example_prompts: unknown;
  is_auto_eligible: boolean;
  max_context_tokens: number;
  cost_multiplier: string;
  agent_type: string;
  agent_multiplier: string;
  direct_model_id: string | null;
  default_model_id: string | null;
  sort_order: number;
  category_id: string | null;
  category_slug: string | null;
  category_name: string | null;
  category_icon_url: string | null;
  category_sort_order: number | null;
  category_description: string | null;
}

interface CatalogueCategory {
  id: string | null;
  slug: string;
  name: string;
  description: string;
  iconUrl: string | null;
  sortOrder: number;
  agents: unknown[];
}

async function fetchAgentsBySlug(slugs: string[]): Promise<AgentRow[]> {
  if (!slugs.length) return [];
  const pool = getPool();
  const res = await pool.query(
    `SELECT
       a.slug, a.display_name, a.short_description, a.long_description,
       a.icon_url, a.tags, a.example_prompts, a.is_auto_eligible,
       a.max_context_tokens, a.cost_multiplier, a.agent_type, a.agent_multiplier,
       a.direct_model_id, a.default_model_id, a.sort_order, a.category_id,
       ac.id        AS category_id,
       ac.slug      AS category_slug,
       ac.name      AS category_name,
       ac.icon_url  AS category_icon_url,
       ac.sort_order AS category_sort_order,
       ac.description AS category_description
     FROM agents a
     LEFT JOIN agent_categories ac ON ac.id = a.category_id
     WHERE a.slug = ANY($1)
       AND a.is_active = true
       AND a.is_visible = true
       AND (a.is_system = false OR a.is_system IS NULL)
     ORDER BY
       COALESCE(ac.sort_order, 999) ASC,
       a.sort_order ASC,
       a.display_name ASC`,
    [slugs],
  );
  return res.rows as AgentRow[];
}

function buildCategoryGroups(rows: AgentRow[]): CatalogueCategory[] {
  const categoryMap = new Map<string, CatalogueCategory>();
  const UNCATEGORISED_KEY = "__uncategorised__";

  for (const row of rows) {
    const key = row.category_id ?? UNCATEGORISED_KEY;

    if (!categoryMap.has(key)) {
      if (key === UNCATEGORISED_KEY) {
        categoryMap.set(key, {
          id: null,
          slug: "general",
          name: "General",
          description: "",
          iconUrl: null,
          sortOrder: 999,
          agents: [],
        });
      } else {
        categoryMap.set(key, {
          id: row.category_id,
          slug: row.category_slug ?? "general",
          name: row.category_name ?? "General",
          description: row.category_description ?? "",
          iconUrl: row.category_icon_url,
          sortOrder: row.category_sort_order ?? 999,
          agents: [],
        });
      }
    }

    const { category_id, category_slug, category_name, category_icon_url,
            category_sort_order, category_description, ...agentFields } = row;
    categoryMap.get(key)!.agents.push(agentFields);
  }

  return [...categoryMap.values()].sort((a, b) => a.sortOrder - b.sortOrder);
}

export const catalogueService = {
  async getCatalogue(plan: Plan) {
    const rows = await fetchAgentsBySlug(plan.agentAccess);
    const categories = buildCategoryGroups(rows);
    return {
      modes: { auto: { available: true }, agent: { available: true } },
      categories,
    };
  },

  async getAgent(plan: Plan, slug: string): Promise<unknown | null> {
    if (!plan.agentAccess.includes(slug)) return null;
    const rows = await fetchAgentsBySlug([slug]);
    if (!rows.length) return null;
    const { category_id, category_slug, category_name, category_icon_url,
            category_sort_order, category_description, ...agentFields } = rows[0]!;
    return {
      ...agentFields,
      category: category_id
        ? { id: category_id, slug: category_slug, name: category_name }
        : null,
    };
  },
};
