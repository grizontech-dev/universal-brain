import { getPool } from "../db/pool.js";

type Json = Record<string, unknown>;

export const catalogueAdminService = {
  async listProviders() {
    const pool = getPool();
    const res = await pool.query(
      `SELECT p.*, COUNT(m.id)::int AS model_count
       FROM providers p
       LEFT JOIN ai_models m ON m.provider_id = p.id AND m.is_active = true
       GROUP BY p.id
       ORDER BY p.slug ASC`,
    );
    return res.rows;
  },

  async createProvider(data: Json) {
    const pool = getPool();
    const res = await pool.query(
      `INSERT INTO providers (slug, display_name, icon_url, api_base_url, env_key_name, is_key_present, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [
        data.slug,
        data.displayName,
        data.iconUrl ?? null,
        data.apiBaseUrl,
        data.envKeyName,
        data.isKeyPresent ?? false,
        data.isActive ?? true,
      ],
    );
    return res.rows[0];
  },

  async deleteProvider(id: string) {
    const pool = getPool();
    // Unlink models first (provider_id has no ON DELETE SET NULL)
    await pool.query(`UPDATE ai_models SET provider_id = NULL WHERE provider_id = $1`, [id]);
    await pool.query(`DELETE FROM providers WHERE id = $1`, [id]);
  },

  async patchProvider(id: string, patch: Json) {
    const pool = getPool();
    const sets: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    for (const [k, v] of Object.entries(patch)) {
      sets.push(`${snake(k)} = $${i++}`);
      values.push(v);
    }
    if (!sets.length) return null;
    values.push(id);
    const res = await pool.query(
      `UPDATE providers SET ${sets.join(", ")}, updated_at = now() WHERE id = $${i} RETURNING *`,
      values,
    );
    return res.rows[0] ?? null;
  },

  async listModels() {
    const pool = getPool();
    const res = await pool.query(`SELECT * FROM ai_models ORDER BY sort_order ASC, created_at DESC`);
    return res.rows;
  },

  async importModels(models: Json[]) {
    const pool = getPool();
    const inserted: unknown[] = [];
    for (const model of models) {
      const res = await pool.query(
        `INSERT INTO ai_models (model_id, provider_id, provider, display_name, tier, credit_rate, context_window, max_output_tokens, capabilities, icon_url, short_description, long_description, tags, is_active, health_status, sort_order, input_cost_per_1k, output_cost_per_1k, input_cached_cost_per_1k, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,now())
         ON CONFLICT (model_id) DO UPDATE SET
           provider_id = EXCLUDED.provider_id,
           provider = EXCLUDED.provider,
           display_name = EXCLUDED.display_name,
           tier = EXCLUDED.tier,
           credit_rate = EXCLUDED.credit_rate,
           context_window = EXCLUDED.context_window,
           max_output_tokens = EXCLUDED.max_output_tokens,
           capabilities = EXCLUDED.capabilities,
           icon_url = EXCLUDED.icon_url,
           short_description = EXCLUDED.short_description,
           long_description = EXCLUDED.long_description,
           tags = EXCLUDED.tags,
           is_active = EXCLUDED.is_active,
           health_status = EXCLUDED.health_status,
           sort_order = EXCLUDED.sort_order,
           input_cost_per_1k = EXCLUDED.input_cost_per_1k,
           output_cost_per_1k = EXCLUDED.output_cost_per_1k,
           input_cached_cost_per_1k = EXCLUDED.input_cached_cost_per_1k,
           updated_at = now()
         RETURNING *`,
        [
          model.modelId,
          model.providerId ?? null,
          model.provider ?? null,
          model.displayName,
          model.tier,
          model.creditRate,
          model.contextWindow ?? null,
          model.maxOutputTokens ?? null,
          JSON.stringify(model.capabilities ?? []),
          model.iconUrl ?? null,
          model.shortDescription ?? "",
          model.longDescription ?? "",
          model.tags ?? [],
          model.isActive ?? true,
          model.healthStatus ?? "healthy",
          model.sortOrder ?? 0,
          model.inputCostPer1k ?? 0,
          model.outputCostPer1k ?? 0,
          model.inputCachedCostPer1k ?? null,
        ],
      );
      inserted.push(res.rows[0]);
    }
    return inserted;
  },

  async deleteModel(id: string) {
    const pool = getPool();
    await pool.query(`DELETE FROM ai_models WHERE id = $1`, [id]);
  },

  async patchModel(id: string, patch: Json) {
    const pool = getPool();
    const sets: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    for (const [k, v] of Object.entries(patch)) {
      if (k === "capabilities") {
        sets.push(`capabilities = $${i++}::jsonb`);
        values.push(JSON.stringify(v ?? []));
      } else {
        sets.push(`${snake(k)} = $${i++}`);
        values.push(v);
      }
    }
    if (!sets.length) return null;
    values.push(id);
    const res = await pool.query(
      `UPDATE ai_models SET ${sets.join(", ")}, updated_at = now() WHERE id = $${i} RETURNING *`,
      values,
    );
    return res.rows[0] ?? null;
  },

  async listCategories() {
    const pool = getPool();
    const res = await pool.query(`SELECT * FROM agent_categories ORDER BY sort_order ASC, name ASC`);
    return res.rows;
  },

  async createCategory(data: Json) {
    const pool = getPool();
    const res = await pool.query(
      `INSERT INTO agent_categories (name, slug, description, icon_url, sort_order, is_active)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [data.name, data.slug, data.description ?? "", data.iconUrl ?? null, data.sortOrder ?? 0, data.isActive ?? true],
    );
    return res.rows[0];
  },

  async patchCategory(id: string, patch: Json) {
    const pool = getPool();
    const sets: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    for (const [k, v] of Object.entries(patch)) {
      sets.push(`${snake(k)} = $${i++}`);
      values.push(v);
    }
    if (!sets.length) return null;
    values.push(id);
    const res = await pool.query(`UPDATE agent_categories SET ${sets.join(", ")} WHERE id = $${i} RETURNING *`, values);
    return res.rows[0] ?? null;
  },

  async listAgents() {
    const pool = getPool();
    const res = await pool.query(`SELECT * FROM agents ORDER BY sort_order ASC, created_at DESC`);
    return res.rows;
  },

  async createAgent(data: Json) {
    const pool = getPool();
    const res = await pool.query(
      `INSERT INTO agents (
        slug, display_name, description, system_prompt, default_model_id, agent_multiplier,
        is_active, agent_type, category_id, icon_url,
        short_description, long_description, example_prompts, tags, sort_order, is_visible,
        is_auto_eligible, cost_multiplier, max_context_tokens, max_context_messages, direct_model_id
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15,$16,$17,$18,$19,$20,$21
      ) RETURNING *`,
      [
        data.slug,
        data.displayName,
        data.description ?? "",
        data.systemPrompt ?? "",
        data.defaultModelId ?? null,
        data.agentMultiplier ?? 1,
        data.isActive ?? true,
        data.agentType ?? "specialized",
        data.categoryId ?? null,
        data.iconUrl ?? null,
        data.shortDescription ?? "",
        data.longDescription ?? "",
        JSON.stringify(data.examplePrompts ?? []),
        data.tags ?? [],
        data.sortOrder ?? 0,
        data.isVisible ?? true,
        data.isAutoEligible ?? true,
        data.costMultiplier ?? 1,
        data.maxContextTokens ?? 80000,
        data.maxContextMessages ?? 20,
        data.directModelId ?? null,
      ],
    );
    return res.rows[0];
  },

  async patchAgent(id: string, patch: Json) {
    const pool = getPool();
    const sets: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    for (const [k, v] of Object.entries(patch)) {
      if (k === "examplePrompts") {
        sets.push(`example_prompts = $${i++}::jsonb`);
        values.push(JSON.stringify(v ?? []));
      } else {
        sets.push(`${snake(k)} = $${i++}`);
        values.push(v);
      }
    }
    if (!sets.length) return null;
    values.push(id);
    const res = await pool.query(
      `UPDATE agents SET ${sets.join(", ")}, updated_at = now() WHERE id = $${i} RETURNING *`,
      values,
    );
    return res.rows[0] ?? null;
  },

  async listAgentModelPriorities(agentId: string) {
    const pool = getPool();
    const res = await pool.query(
      `SELECT * FROM agent_model_priorities WHERE agent_id = $1 ORDER BY priority ASC`,
      [agentId],
    );
    return res.rows;
  },

  async createAgentModelPriority(agentId: string, payload: Json) {
    const pool = getPool();
    const res = await pool.query(
      `INSERT INTO agent_model_priorities (agent_id, model_id, priority, is_active, notes)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING *`,
      [agentId, payload.modelId, payload.priority, payload.isActive ?? true, payload.notes ?? null],
    );
    return res.rows[0];
  },

  async patchAgentModelPriority(agentId: string, id: string, patch: Json) {
    const pool = getPool();
    const sets: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    for (const [k, v] of Object.entries(patch)) {
      sets.push(`${snake(k)} = $${i++}`);
      values.push(v);
    }
    if (!sets.length) return null;
    values.push(agentId, id);
    const res = await pool.query(
      `UPDATE agent_model_priorities SET ${sets.join(", ")}, updated_at = now()
       WHERE agent_id = $${i++} AND id = $${i} RETURNING *`,
      values,
    );
    return res.rows[0] ?? null;
  },

  async deleteAgentModelPriority(agentId: string, id: string) {
    const pool = getPool();
    await pool.query(`DELETE FROM agent_model_priorities WHERE agent_id = $1 AND id = $2`, [agentId, id]);
  },

  async reorderAgentModelPriorities(agentId: string, priorities: Array<{ id: string; priority: number }>) {
    const pool = getPool();
    for (const entry of priorities) {
      await pool.query(
        `UPDATE agent_model_priorities SET priority = $3, updated_at = now() WHERE agent_id = $1 AND id = $2`,
        [agentId, entry.id, entry.priority],
      );
    }
  },

  async getSystemModelConfig() {
    const pool = getPool();
    const res = await pool.query(`SELECT tier, models FROM system_model_config ORDER BY tier ASC`);
    return res.rows;
  },

  async patchSystemModelTier(tier: "light" | "medium" | "high", models: unknown[]) {
    const pool = getPool();
    const res = await pool.query(
      `UPDATE system_model_config SET models = $2::jsonb, updated_at = now() WHERE tier = $1 RETURNING *`,
      [tier, JSON.stringify(models)],
    );
    return res.rows[0] ?? null;
  },
};

function snake(s: string): string {
  return s.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
}
