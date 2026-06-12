import 'dotenv/config';

import { getPool } from './pool.js';
import { passwordService } from '../services/password.service.js';

const SUPERADMIN_EMAIL = 'admin@grizonai.com';

function readSeedSuperadminPassword(): string {
  const plain = process.env.SEED_SUPERADMIN_PASSWORD?.trim();
  if (!plain) {
    throw new Error(
      'SEED_SUPERADMIN_PASSWORD is not set. Add it to .env (see .env.example) before running seed.',
    );
  }
  return plain;
}

async function seedSuperadmin(): Promise<void> {
  const plainPassword = readSeedSuperadminPassword();

  const pool = getPool();
  const emailNormalised = SUPERADMIN_EMAIL.trim().toLowerCase();
  const passwordHash = await passwordService.hash(plainPassword);

  await pool.query(
    `
    INSERT INTO users (
      email, email_normalised, password_hash, role, status, name,
      registration_platform, email_verified_at, password_changed_at,
      created_at, updated_at
    )
    VALUES ($1, $2, $3, 'superadmin', 'active', 'Super Admin',
            'admin', now(), now(), now(), now())
    ON CONFLICT (email_normalised) DO UPDATE SET
      email = EXCLUDED.email,
      password_hash = EXCLUDED.password_hash,
      role = 'superadmin',
      status = 'active',
      name = EXCLUDED.name,
      registration_platform = EXCLUDED.registration_platform,
      email_verified_at = now(),
      password_changed_at = now(),
      updated_at = now(),
      failed_login_attempts = 0,
      locked_until = NULL
    `,
    [SUPERADMIN_EMAIL, emailNormalised, passwordHash],
  );

  console.info(`Seed: superadmin ensured (${SUPERADMIN_EMAIL}).`);
}

// ──────────────────────────────────────────────────────────────────────────
// Providers
// ──────────────────────────────────────────────────────────────────────────

type ProviderSeed = {
  slug: string;
  displayName: string;
  apiBaseUrl: string;
  envKeyName: string;
};

const PROVIDER_SEEDS: ProviderSeed[] = [
  {
    slug: 'anthropic',
    displayName: 'Anthropic',
    apiBaseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
    envKeyName: 'ANTHROPIC_API_KEY',
  },
  {
    slug: 'openai',
    displayName: 'OpenAI',
    apiBaseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    envKeyName: 'OPENAI_API_KEY',
  },
  {
    slug: 'google',
    displayName: 'Google AI',
    apiBaseUrl: process.env.GOOGLE_AI_BASE_URL || 'https://generativelanguage.googleapis.com',
    envKeyName: 'GOOGLE_AI_API_KEY',
  },
  {
    slug: 'deepseek',
    displayName: 'DeepSeek',
    apiBaseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1',
    envKeyName: 'DEEPSEEK_API_KEY',
  },
  {
    slug: 'xai',
    displayName: 'xAI',
    apiBaseUrl: process.env.XAI_BASE_URL || 'https://api.x.ai/v1',
    envKeyName: 'XAI_API_KEY',
  },
];

async function seedProviders(): Promise<Map<string, string>> {
  const pool = getPool();
  const slugToId = new Map<string, string>();

  for (const p of PROVIDER_SEEDS) {
    const keyPresent = Boolean(process.env[p.envKeyName]?.trim());
    if (!keyPresent) {
      console.info(`Seed: provider "${p.slug}" skipped (${p.envKeyName} not set).`);
      continue;
    }

    const res = await pool.query(
      `INSERT INTO providers (slug, display_name, api_base_url, env_key_name, is_key_present, is_active)
       VALUES ($1, $2, $3, $4, true, true)
       ON CONFLICT (slug) DO UPDATE SET
         env_key_name = EXCLUDED.env_key_name,
         api_base_url = EXCLUDED.api_base_url,
         is_key_present = true,
         updated_at = now()
       RETURNING id`,
      [p.slug, p.displayName, p.apiBaseUrl, p.envKeyName],
    );
    slugToId.set(p.slug, res.rows[0].id);
    console.info(`Seed: provider "${p.slug}" ensured.`);
  }

  return slugToId;
}

// ──────────────────────────────────────────────────────────────────────────
// Models
// All costs are per 1K tokens.
// ──────────────────────────────────────────────────────────────────────────

type ModelSeed = {
  modelId: string;
  providerSlug: string;
  displayName: string;
  tier: 'light' | 'medium' | 'high';
  creditRate: number;
  contextWindow: number;
  maxOutputTokens: number;
  capabilities: string[];
  inputCostPer1k: number;
  outputCostPer1k: number;
  inputCachedCostPer1k: number;
  shortDescription: string;
  sortOrder: number;
};

// Per-1K-token prices below are sourced from LLM_Pricing_June2026.xlsx
// (provider list prices, per 1M ÷ 1000). Tiered models use the base (≤200K) tier.
// deepseek-v4-pro uses the regular price (75%-off promo expired 2026-05-31).
const MODEL_SEEDS: ModelSeed[] = [
  // ── Anthropic ────────────────────────────────────────────────────────────
  {
    modelId: 'claude-opus-4-7',
    providerSlug: 'anthropic',
    displayName: 'Claude Opus 4.7',
    tier: 'high',
    creditRate: 3,
    contextWindow: 1000000,
    maxOutputTokens: 32768,
    capabilities: ['text', 'vision', 'reasoning', 'tools'],
    inputCostPer1k: 0.005,
    outputCostPer1k: 0.025,
    inputCachedCostPer1k: 0.0005,
    shortDescription: 'Anthropic flagship reasoning & agentic coding model.',
    sortOrder: 10,
  },
  {
    modelId: 'claude-opus-4-6',
    providerSlug: 'anthropic',
    displayName: 'Claude Opus 4.6',
    tier: 'high',
    creditRate: 3,
    contextWindow: 1000000,
    maxOutputTokens: 32768,
    capabilities: ['text', 'vision', 'reasoning', 'tools'],
    inputCostPer1k: 0.005,
    outputCostPer1k: 0.025,
    inputCachedCostPer1k: 0.0005,
    shortDescription: 'Anthropic enterprise flagship with extended thinking.',
    sortOrder: 20,
  },
  {
    modelId: 'claude-sonnet-4-6',
    providerSlug: 'anthropic',
    displayName: 'Claude Sonnet 4.6',
    tier: 'high',
    creditRate: 3,
    contextWindow: 1000000,
    maxOutputTokens: 32768,
    capabilities: ['text', 'vision', 'tools'],
    inputCostPer1k: 0.003,
    outputCostPer1k: 0.015,
    inputCachedCostPer1k: 0.0003,
    shortDescription: 'Anthropic balanced production model, best price/performance.',
    sortOrder: 30,
  },
  {
    modelId: 'claude-haiku-4-5-20251001',
    providerSlug: 'anthropic',
    displayName: 'Claude Haiku 4.5',
    tier: 'light',
    creditRate: 1,
    contextWindow: 200000,
    maxOutputTokens: 8192,
    capabilities: ['text', 'vision', 'tools'],
    inputCostPer1k: 0.001,
    outputCostPer1k: 0.005,
    inputCachedCostPer1k: 0.0001,
    shortDescription: 'Fast, low-cost Anthropic model.',
    sortOrder: 40,
  },
  // ── OpenAI ───────────────────────────────────────────────────────────────
  {
    modelId: 'gpt-5.5',
    providerSlug: 'openai',
    displayName: 'GPT-5.5',
    tier: 'high',
    creditRate: 3,
    contextWindow: 1050000,
    maxOutputTokens: 128000,
    capabilities: ['text', 'vision', 'reasoning', 'tools'],
    inputCostPer1k: 0.005,
    outputCostPer1k: 0.030,
    inputCachedCostPer1k: 0.0005,
    shortDescription: 'OpenAI flagship for complex coding & agents.',
    sortOrder: 50,
  },
  {
    modelId: 'gpt-5.4',
    providerSlug: 'openai',
    displayName: 'GPT-5.4',
    tier: 'high',
    creditRate: 3,
    contextWindow: 1000000,
    maxOutputTokens: 128000,
    capabilities: ['text', 'vision', 'tools'],
    inputCostPer1k: 0.0025,
    outputCostPer1k: 0.015,
    inputCachedCostPer1k: 0.00025,
    shortDescription: 'OpenAI production workhorse, best cost/quality balance.',
    sortOrder: 60,
  },
  {
    modelId: 'gpt-5.4-mini',
    providerSlug: 'openai',
    displayName: 'GPT-5.4 Mini',
    tier: 'medium',
    creditRate: 2,
    contextWindow: 1000000,
    maxOutputTokens: 16384,
    capabilities: ['text', 'vision', 'tools'],
    inputCostPer1k: 0.00075,
    outputCostPer1k: 0.0045,
    inputCachedCostPer1k: 0.000075,
    shortDescription: 'Budget frontier OpenAI model for high-throughput tasks.',
    sortOrder: 70,
  },
  {
    modelId: 'gpt-5.4-nano',
    providerSlug: 'openai',
    displayName: 'GPT-5.4 Nano',
    tier: 'light',
    creditRate: 1,
    contextWindow: 1000000,
    maxOutputTokens: 16384,
    capabilities: ['text', 'tools'],
    inputCostPer1k: 0.0002,
    outputCostPer1k: 0.00125,
    inputCachedCostPer1k: 0.00002,
    shortDescription: 'Ultra-budget OpenAI model for classification & routing.',
    sortOrder: 80,
  },
  {
    modelId: 'gpt-4.1',
    providerSlug: 'openai',
    displayName: 'GPT-4.1',
    tier: 'medium',
    creditRate: 2,
    contextWindow: 1000000,
    maxOutputTokens: 32768,
    capabilities: ['text', 'vision', 'tools'],
    inputCostPer1k: 0.002,
    outputCostPer1k: 0.008,
    inputCachedCostPer1k: 0.0005,
    shortDescription: 'Long-context budget workhorse with vision.',
    sortOrder: 90,
  },
  {
    modelId: 'gpt-4o',
    providerSlug: 'openai',
    displayName: 'GPT-4o',
    tier: 'medium',
    creditRate: 2,
    contextWindow: 128000,
    maxOutputTokens: 16384,
    capabilities: ['text', 'vision', 'tools'],
    inputCostPer1k: 0.0025,
    outputCostPer1k: 0.010,
    inputCachedCostPer1k: 0.00125,
    shortDescription: 'OpenAI multimodal legacy model.',
    sortOrder: 100,
  },
  {
    modelId: 'o3',
    providerSlug: 'openai',
    displayName: 'OpenAI o3',
    tier: 'high',
    creditRate: 3,
    contextWindow: 200000,
    maxOutputTokens: 100000,
    capabilities: ['text', 'vision', 'reasoning', 'tools'],
    inputCostPer1k: 0.002,
    outputCostPer1k: 0.008,
    inputCachedCostPer1k: 0.0005,
    shortDescription: 'OpenAI multi-step reasoning model (math, science, logic).',
    sortOrder: 110,
  },
  {
    modelId: 'o4-mini',
    providerSlug: 'openai',
    displayName: 'OpenAI o4-mini',
    tier: 'medium',
    creditRate: 2,
    contextWindow: 200000,
    maxOutputTokens: 100000,
    capabilities: ['text', 'reasoning', 'tools'],
    inputCostPer1k: 0.00055,
    outputCostPer1k: 0.0022,
    inputCachedCostPer1k: 0.00014,
    shortDescription: 'Budget reasoning model for math & STEM.',
    sortOrder: 120,
  },
  // ── Google ───────────────────────────────────────────────────────────────
  {
    modelId: 'gemini-3.1-pro-preview',
    providerSlug: 'google',
    displayName: 'Gemini 3.1 Pro',
    tier: 'high',
    creditRate: 3,
    contextWindow: 2000000,
    maxOutputTokens: 65536,
    capabilities: ['text', 'vision', 'reasoning', 'tools'],
    inputCostPer1k: 0.002,
    outputCostPer1k: 0.012,
    inputCachedCostPer1k: 0.0002,
    shortDescription: 'Google frontier reasoning model, 2M context.',
    sortOrder: 130,
  },
  {
    modelId: 'gemini-3.5-flash',
    providerSlug: 'google',
    displayName: 'Gemini 3.5 Flash',
    tier: 'medium',
    creditRate: 2,
    contextWindow: 1000000,
    maxOutputTokens: 65536,
    capabilities: ['text', 'vision', 'tools'],
    inputCostPer1k: 0.0015,
    outputCostPer1k: 0.009,
    inputCachedCostPer1k: 0.00015,
    shortDescription: 'Premium Flash tier with strong multimodal.',
    sortOrder: 140,
  },
  {
    modelId: 'gemini-2.5-pro',
    providerSlug: 'google',
    displayName: 'Gemini 2.5 Pro',
    tier: 'high',
    creditRate: 3,
    contextWindow: 1000000,
    maxOutputTokens: 65536,
    capabilities: ['text', 'vision', 'reasoning', 'tools'],
    inputCostPer1k: 0.00125,
    outputCostPer1k: 0.010,
    inputCachedCostPer1k: 0.000125,
    shortDescription: 'Strong Google reasoning model with 1M context.',
    sortOrder: 150,
  },
  {
    modelId: 'gemini-2.5-flash',
    providerSlug: 'google',
    displayName: 'Gemini 2.5 Flash',
    tier: 'medium',
    creditRate: 2,
    contextWindow: 1000000,
    maxOutputTokens: 8192,
    capabilities: ['text', 'vision', 'tools'],
    inputCostPer1k: 0.0003,
    outputCostPer1k: 0.0025,
    inputCachedCostPer1k: 0.00003,
    shortDescription: 'Cost-efficient Google multimodal model.',
    sortOrder: 160,
  },
  {
    modelId: 'gemini-2.5-flash-lite',
    providerSlug: 'google',
    displayName: 'Gemini 2.5 Flash Lite',
    tier: 'light',
    creditRate: 1,
    contextWindow: 1000000,
    maxOutputTokens: 8192,
    capabilities: ['text', 'vision', 'tools'],
    inputCostPer1k: 0.0001,
    outputCostPer1k: 0.0004,
    inputCachedCostPer1k: 0.00001,
    shortDescription: 'Cheapest Gemini model for high-volume tasks.',
    sortOrder: 170,
  },
  // ── xAI ──────────────────────────────────────────────────────────────────
  {
    modelId: 'grok-4.3',
    providerSlug: 'xai',
    displayName: 'Grok 4.3',
    tier: 'medium',
    creditRate: 2,
    contextWindow: 1000000,
    maxOutputTokens: 30000,
    capabilities: ['text', 'vision', 'reasoning', 'tools'],
    inputCostPer1k: 0.00125,
    outputCostPer1k: 0.0025,
    inputCachedCostPer1k: 0.0002,
    shortDescription: 'xAI flagship, reasoning-first with live X search.',
    sortOrder: 180,
  },
  {
    modelId: 'grok-4.20',
    providerSlug: 'xai',
    displayName: 'Grok 4.20',
    tier: 'high',
    creditRate: 3,
    contextWindow: 2000000,
    maxOutputTokens: 30000,
    capabilities: ['text', 'vision', 'reasoning', 'tools'],
    inputCostPer1k: 0.00125,
    outputCostPer1k: 0.0025,
    inputCachedCostPer1k: 0.0002,
    shortDescription: 'xAI 2M-context model with multi-agent variants.',
    sortOrder: 190,
  },
  {
    modelId: 'grok-4.1-fast',
    providerSlug: 'xai',
    displayName: 'Grok 4.1 Fast',
    tier: 'light',
    creditRate: 1,
    contextWindow: 2000000,
    maxOutputTokens: 8192,
    capabilities: ['text', 'vision', 'tools'],
    inputCostPer1k: 0.0002,
    outputCostPer1k: 0.0005,
    inputCachedCostPer1k: 0.00002,
    shortDescription: 'Ultra-cheap xAI model with 2M context.',
    sortOrder: 200,
  },
  {
    modelId: 'grok-build-0.1',
    providerSlug: 'xai',
    displayName: 'Grok Build 0.1',
    tier: 'medium',
    creditRate: 2,
    contextWindow: 256000,
    maxOutputTokens: 32768,
    capabilities: ['text', 'tools'],
    inputCostPer1k: 0.001,
    outputCostPer1k: 0.002,
    inputCachedCostPer1k: 0.0001,
    shortDescription: 'xAI coding specialist for agentic dev workflows.',
    sortOrder: 210,
  },
  // ── DeepSeek ─────────────────────────────────────────────────────────────
  {
    modelId: 'deepseek-v4-flash',
    providerSlug: 'deepseek',
    displayName: 'DeepSeek V4 Flash',
    tier: 'light',
    creditRate: 1,
    contextWindow: 1000000,
    maxOutputTokens: 8192,
    capabilities: ['text', 'tools'],
    inputCostPer1k: 0.00014,
    outputCostPer1k: 0.00028,
    inputCachedCostPer1k: 0.0000028,
    shortDescription: 'Fast, ultra-cheap DeepSeek model.',
    sortOrder: 220,
  },
  {
    modelId: 'deepseek-v4-pro',
    providerSlug: 'deepseek',
    displayName: 'DeepSeek V4 Pro',
    tier: 'medium',
    creditRate: 2,
    contextWindow: 1000000,
    maxOutputTokens: 8192,
    capabilities: ['text', 'tools', 'reasoning'],
    inputCostPer1k: 0.00174,
    outputCostPer1k: 0.00348,
    inputCachedCostPer1k: 0.0000145,
    shortDescription: 'DeepSeek flagship reasoning model with 1M context.',
    sortOrder: 230,
  },
  {
    modelId: 'deepseek-v3.2',
    providerSlug: 'deepseek',
    displayName: 'DeepSeek V3.2',
    tier: 'light',
    creditRate: 1,
    contextWindow: 128000,
    maxOutputTokens: 8192,
    capabilities: ['text', 'tools', 'reasoning'],
    inputCostPer1k: 0.00028,
    outputCostPer1k: 0.00042,
    inputCachedCostPer1k: 0.000028,
    shortDescription: 'Legacy DeepSeek V3 series, open weights.',
    sortOrder: 240,
  },
  {
    modelId: 'deepseek-r1',
    providerSlug: 'deepseek',
    displayName: 'DeepSeek R1',
    tier: 'medium',
    creditRate: 2,
    contextWindow: 128000,
    maxOutputTokens: 8192,
    capabilities: ['text', 'tools', 'reasoning'],
    inputCostPer1k: 0.00055,
    outputCostPer1k: 0.00219,
    inputCachedCostPer1k: 0.000055,
    shortDescription: 'DeepSeek chain-of-thought reasoning model.',
    sortOrder: 250,
  },
];

async function seedModels(providerIds: Map<string, string>): Promise<string[]> {
  const pool = getPool();
  const seededModelIds: string[] = [];

  for (const m of MODEL_SEEDS) {
    const providerId = providerIds.get(m.providerSlug);
    if (!providerId) {
      console.info(`Seed: model "${m.modelId}" skipped (provider "${m.providerSlug}" not available).`);
      continue;
    }

    await pool.query(
      `INSERT INTO ai_models (
         model_id, provider_id, provider, display_name, tier, credit_rate,
         context_window, max_output_tokens, capabilities, short_description,
         is_active, health_status, sort_order,
         input_cost_per_1k, output_cost_per_1k, input_cached_cost_per_1k
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10,
               true, 'healthy', $11, $12, $13, $14)
       ON CONFLICT (model_id) DO UPDATE SET
         display_name           = EXCLUDED.display_name,
         tier                   = EXCLUDED.tier,
         credit_rate            = EXCLUDED.credit_rate,
         context_window         = EXCLUDED.context_window,
         max_output_tokens      = EXCLUDED.max_output_tokens,
         capabilities           = EXCLUDED.capabilities,
         short_description      = EXCLUDED.short_description,
         input_cost_per_1k      = EXCLUDED.input_cost_per_1k,
         output_cost_per_1k     = EXCLUDED.output_cost_per_1k,
         input_cached_cost_per_1k = EXCLUDED.input_cached_cost_per_1k,
         updated_at             = now()`,
      [
        m.modelId,
        providerId,
        m.providerSlug,
        m.displayName,
        m.tier,
        m.creditRate,
        m.contextWindow,
        m.maxOutputTokens,
        JSON.stringify(m.capabilities),
        m.shortDescription,
        m.sortOrder,
        m.inputCostPer1k,
        m.outputCostPer1k,
        m.inputCachedCostPer1k,
      ],
    );
    seededModelIds.push(m.modelId);
    console.info(`Seed: model "${m.modelId}" ensured.`);
  }

  return seededModelIds;
}

// ──────────────────────────────────────────────────────────────────────────
// System model config (tiers)
// Only populates empty rows — skips tiers already configured by admin.
// ──────────────────────────────────────────────────────────────────────────

async function seedSystemModelConfig(availableModelIds: Set<string>): Promise<void> {
  const pool = getPool();
  const tiers: Record<'light' | 'medium' | 'high', string[]> = {
    light:  ['deepseek-v4-flash', 'gemini-2.5-flash-lite', 'gpt-5.4-nano', 'claude-haiku-4-5-20251001'],
    medium: ['deepseek-v4-pro', 'gemini-2.5-flash', 'grok-4.3', 'gpt-5.4'],
    high:   ['gemini-3.1-pro-preview', 'claude-opus-4-7', 'gpt-5.5'],
  };

  for (const [tier, models] of Object.entries(tiers)) {
    const filtered = models.filter((id) => availableModelIds.has(id));
    const cur = await pool.query(`SELECT models FROM system_model_config WHERE tier = $1`, [tier]);
    const current = cur.rows[0]?.models ?? [];
    if (Array.isArray(current) && current.length > 0) {
      console.info(`Seed: system_model_config "${tier}" already populated, skipping.`);
      continue;
    }
    await pool.query(
      `UPDATE system_model_config SET models = $2::jsonb, updated_at = now() WHERE tier = $1`,
      [tier, JSON.stringify(filtered)],
    );
    console.info(`Seed: system_model_config "${tier}" → [${filtered.join(', ')}].`);
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Agent categories
// ──────────────────────────────────────────────────────────────────────────

async function seedAgentCategories(): Promise<Map<string, string>> {
  const pool = getPool();
  const seeds = [
    { slug: 'agents',    name: 'Agents',    description: 'Purpose-built AI agents', sortOrder: 0 },
    { slug: 'ai-models', name: 'AI Models', description: 'Direct model access',     sortOrder: 1 },
  ];

  const map = new Map<string, string>();
  for (const c of seeds) {
    const res = await pool.query(
      `INSERT INTO agent_categories (name, slug, description, sort_order, is_active)
       VALUES ($1, $2, $3, $4, true)
       ON CONFLICT (slug) DO UPDATE SET name = agent_categories.name
       RETURNING id`,
      [c.name, c.slug, c.description, c.sortOrder],
    );
    map.set(c.slug, res.rows[0].id);
    console.info(`Seed: agent_category "${c.slug}" ensured.`);
  }
  return map;
}


// ──────────────────────────────────────────────────────────────────────────
// User-facing agents (is_system = false, is_visible = true)
// ──────────────────────────────────────────────────────────────────────────

type AgentSeed = {
  slug: string;
  displayName: string;
  description: string;
  shortDescription: string;
  systemPrompt: string;
  defaultModelId: string;
  directModelId: string | null;
  agentType: 'specialized' | 'direct';
  categorySlug: 'agents' | 'ai-models';
  allowedTools: string[];
  toolBudgets: Record<string, number>;
  examplePrompts: Array<{ title: string; prompt: string }>;
  tags: string[];
  costMultiplier: number;
  maxToolRounds: number;
  maxTokensPerMessage: number;
  maxContextMessages: number;
  isAutoEligible: boolean;
  sortOrder: number;
  fallbackAgent: string | null;
};

const FULL_TOOLSET = [
  'webSearch', 'webFetch', 'codeExecution', 'documentAnalysis',
  'documentCreation', 'htmlPreview', 'chartGenerate', 'imageAnalyse',
  'stockData', 'weatherData',
];

// One unified, plan-tiered catalogue. All agents are is_visible = true,
// is_system = false. The 7 auto-eligible core agents power Auto Mode; the 5
// specialist/expensive agents and all 5 Direct Model agents are manual-only.
const AGENT_SEEDS: AgentSeed[] = [
  // ── Usage-based core (Agents category) ────────────────────────────────────
  {
    slug: 'general',
    displayName: 'General Assistant',
    description: 'A helpful general-purpose AI assistant and the Auto-Mode fallback.',
    shortDescription: 'Everyday Q&A and general help',
    systemPrompt:
      "You are a helpful general-purpose AI assistant. Be concise, accurate, and friendly.\n\nFor current events, real-time data (prices, scores, weather), or facts you are not confident about, use web_search first before answering — do not rely on training data for time-sensitive topics.",
    defaultModelId: 'deepseek-v4-flash',
    directModelId: null,
    agentType: 'specialized',
    categorySlug: 'agents',
    allowedTools: FULL_TOOLSET,
    toolBudgets: { web_search: 2, web_fetch: 6 },
    examplePrompts: [
      { title: 'Summarise a document', prompt: 'Summarise this document for me' },
      { title: 'Explain a concept', prompt: 'Explain how transformers work in AI' },
    ],
    tags: ['general'],
    costMultiplier: 1.0,
    maxToolRounds: 10,
    maxTokensPerMessage: 2048,
    maxContextMessages: 20,
    isAutoEligible: true,
    sortOrder: 0,
    fallbackAgent: null,
  },
  {
    slug: 'research',
    displayName: 'Research',
    description: 'Web research with clear citations.',
    shortDescription: 'Web research with citations',
    systemPrompt:
      "You are a research assistant. Conduct focused web research and present findings with clear citations.\n\nPROCESS:\n1. Use web_search to find authoritative sources (aim for 3-5 results)\n2. Use web_fetch to read key pages in depth when needed\n3. Synthesise with inline [1], [2] citations\n4. Use file_gen to export a report if requested\n\nRULES: Cite all factual claims. Prefer primary sources. List all referenced URLs at the end under ## Sources.",
    defaultModelId: 'deepseek-v4-flash',
    directModelId: null,
    agentType: 'specialized',
    categorySlug: 'agents',
    allowedTools: ['webSearch', 'webFetch', 'documentCreation', 'documentAnalysis'],
    toolBudgets: { web_search: 5, web_fetch: 5 },
    examplePrompts: [
      { title: 'Market research', prompt: 'Research the EV charging market in India' },
      { title: 'Compare options', prompt: 'Compare Postgres vs MySQL for analytics workloads' },
    ],
    tags: ['research', 'citations'],
    costMultiplier: 1.5,
    maxToolRounds: 15,
    maxTokensPerMessage: 4096,
    maxContextMessages: 20,
    isAutoEligible: true,
    sortOrder: 1,
    fallbackAgent: 'general',
  },
  {
    slug: 'code',
    displayName: 'Coding & Engineering',
    description: 'Software engineering: generation, review, and execution.',
    shortDescription: 'Code generation, review, and execution',
    systemPrompt:
      "You are an expert coding assistant. Write clean, idiomatic, production-ready code.\n\n- Prefer readable code over clever code; explain trade-offs briefly\n- Use code_execution to verify logic, test edge cases, or demonstrate output\n- Use web_search to look up library docs, error messages, or specs when needed\n- Support all major languages; default to the language already in use\n\nWrite: complete, runnable snippets. Review: identify bugs and style issues. Debug: explain root cause before suggesting a fix.",
    defaultModelId: 'deepseek-v4-pro',
    directModelId: null,
    agentType: 'specialized',
    categorySlug: 'agents',
    allowedTools: ['codeExecution', 'documentAnalysis', 'documentCreation', 'webSearch', 'webFetch', 'htmlPreview'],
    toolBudgets: { code_execution: 4, web_search: 2, web_fetch: 2 },
    examplePrompts: [
      { title: 'Write a function', prompt: 'Write a Python function that debounces calls' },
      { title: 'Review code', prompt: 'Review this function and suggest improvements' },
    ],
    tags: ['code', 'developer'],
    costMultiplier: 1.2,
    maxToolRounds: 12,
    maxTokensPerMessage: 4096,
    maxContextMessages: 20,
    isAutoEligible: true,
    sortOrder: 2,
    fallbackAgent: 'general',
  },
  {
    slug: 'debugger',
    displayName: 'Debugger',
    description: 'Bug hunting, root-cause analysis, and minimal fixes.',
    shortDescription: 'Bug hunting and root-cause analysis',
    systemPrompt:
      "You are a debugging specialist. Systematically identify root causes and propose minimal, targeted fixes.\n\n1. Understand the symptom: what fails, when, and under what conditions\n2. Form 2-3 hypotheses ranked by probability\n3. Use code_execution to reproduce or isolate the issue\n4. Use web_search to look up error messages, known bugs, or language quirks\n5. Propose the minimal fix - avoid scope creep\n\nAlways explain WHY the fix works.",
    defaultModelId: 'deepseek-v4-pro',
    directModelId: null,
    agentType: 'specialized',
    categorySlug: 'agents',
    allowedTools: ['codeExecution', 'documentAnalysis', 'documentCreation', 'webSearch', 'webFetch'],
    toolBudgets: { code_execution: 4, web_search: 3, web_fetch: 2 },
    examplePrompts: [
      { title: 'Find a bug', prompt: 'Why is this code throwing an off-by-one error?' },
      { title: 'Diagnose a crash', prompt: 'My server crashes under load - help me find why' },
    ],
    tags: ['code', 'debug'],
    costMultiplier: 1.2,
    maxToolRounds: 12,
    maxTokensPerMessage: 4096,
    maxContextMessages: 20,
    isAutoEligible: true,
    sortOrder: 3,
    fallbackAgent: 'code',
  },
  {
    slug: 'writer',
    displayName: 'Writer & Documentation',
    description: 'Long-form writing, editing, planning, and office work.',
    shortDescription: 'Writing, editing, and document creation',
    systemPrompt:
      "You are a professional writing assistant. Help with long-form writing, editing, proofreading, tone adjustment, and document creation.\n\n- Match the requested tone (formal, casual, persuasive, technical, creative)\n- Improve clarity, flow, and structure without losing the author's voice\n- When writing requires facts or current information, use web_search first\n- Use file_read to read uploaded source documents when provided\n- Use file_gen for full drafts and polished artifacts\n\nFor short edits: respond inline. For full drafts: use file_gen.",
    defaultModelId: 'gemini-2.5-flash',
    directModelId: null,
    agentType: 'specialized',
    categorySlug: 'agents',
    allowedTools: ['webSearch', 'webFetch', 'documentCreation', 'documentAnalysis'],
    toolBudgets: { web_search: 2, web_fetch: 2 },
    examplePrompts: [
      { title: 'Write an email', prompt: 'Help me write a professional email' },
      { title: 'Edit for clarity', prompt: 'Improve the clarity and flow of this text' },
    ],
    tags: ['writing', 'documentation'],
    costMultiplier: 1.0,
    maxToolRounds: 10,
    maxTokensPerMessage: 4096,
    maxContextMessages: 20,
    isAutoEligible: true,
    sortOrder: 4,
    fallbackAgent: 'general',
  },
  {
    slug: 'analyst',
    displayName: 'Data & Financial Analyst',
    description: 'Data analysis, financial auditing, charts, and insights.',
    shortDescription: 'Data analysis, charts, and insights',
    systemPrompt:
      "You are a data analysis assistant. Analyse data, generate charts, and surface actionable insights.\n\n1. Understand the data - ask for clarification if scope is unclear\n2. Use code_execution for calculations, aggregations, and transformations\n3. Use chart_generate for trends, comparisons, and distributions\n4. Use web_search for benchmarks or industry context when needed\n5. Lead with the headline insight; support with data and charts",
    defaultModelId: 'gemini-3.5-flash',
    directModelId: null,
    agentType: 'specialized',
    categorySlug: 'agents',
    allowedTools: ['documentAnalysis', 'codeExecution', 'chartGenerate', 'stockData', 'documentCreation', 'webSearch', 'webFetch'],
    toolBudgets: { code_execution: 4, chart_generate: 5, web_search: 3, web_fetch: 2 },
    examplePrompts: [
      { title: 'Analyse a dataset', prompt: 'Analyse this CSV and chart the key trends' },
      { title: 'Financial summary', prompt: 'Summarise the financial health from these figures' },
    ],
    tags: ['data', 'finance', 'analysis'],
    costMultiplier: 1.3,
    maxToolRounds: 12,
    maxTokensPerMessage: 4096,
    maxContextMessages: 20,
    isAutoEligible: true,
    sortOrder: 5,
    fallbackAgent: 'general',
  },
  {
    slug: 'document',
    displayName: 'Document Intelligence',
    description: 'Contract review and massive-document RAG over uploads.',
    shortDescription: 'Read, analyse, and generate documents',
    systemPrompt:
      "You are a document assistant. Read, analyse, summarise, and create structured documents.\n\n- Analyse uploaded documents (PDFs, text, images) and answer questions about their content\n- Generate well-structured reports, summaries, and formatted documents\n- Use web_search to verify facts or fill knowledge gaps when needed\n- For summaries: structured markdown with headers and bullets\n- For full documents: use file_gen to produce exportable artifacts\n- Always cite page numbers or sections when referencing uploaded content",
    defaultModelId: 'gemini-2.5-pro',
    directModelId: null,
    agentType: 'specialized',
    categorySlug: 'agents',
    allowedTools: ['documentAnalysis', 'documentCreation', 'imageAnalyse', 'webSearch', 'webFetch'],
    toolBudgets: { web_search: 2, web_fetch: 4 },
    examplePrompts: [
      { title: 'Review a contract', prompt: 'Review this contract and flag risky clauses' },
      { title: 'Summarise a PDF', prompt: 'Summarise the key points of this PDF' },
    ],
    tags: ['document', 'rag'],
    costMultiplier: 1.4,
    maxToolRounds: 12,
    maxTokensPerMessage: 4096,
    maxContextMessages: 30,
    isAutoEligible: true,
    sortOrder: 6,
    fallbackAgent: 'general',
  },
  {
    slug: 'architect',
    displayName: 'Architect',
    description: 'System design and architecture planning. Manual-only specialist.',
    shortDescription: 'System design and architecture',
    systemPrompt:
      "You are a system architecture assistant. Design scalable, maintainable, production-ready systems.\n\n- Understand requirements, constraints, and scale before proposing solutions\n- Use web_search to research best practices, benchmarks, and technology comparisons\n- Consider trade-offs explicitly: performance, cost, complexity, operability\n- Produce architecture diagrams in Mermaid or ASCII when helpful\n- Use file_gen to export ADRs or design documents",
    defaultModelId: 'deepseek-v4-pro',
    directModelId: null,
    agentType: 'specialized',
    categorySlug: 'agents',
    allowedTools: ['webSearch', 'webFetch', 'documentCreation', 'documentAnalysis'],
    toolBudgets: { web_search: 3, web_fetch: 3 },
    examplePrompts: [
      { title: 'Design a system', prompt: 'Design a scalable URL shortener architecture' },
      { title: 'Compare approaches', prompt: 'Compare event-driven vs request-response for this use case' },
    ],
    tags: ['architecture', 'design'],
    costMultiplier: 1.5,
    maxToolRounds: 12,
    maxTokensPerMessage: 4096,
    maxContextMessages: 20,
    isAutoEligible: false,
    sortOrder: 7,
    fallbackAgent: 'code',
  },
  {
    slug: 'deep-research',
    displayName: 'Deep Research',
    description: 'Exhaustive multi-step research and scientific synthesis. Manual-only (Pro+).',
    shortDescription: 'In-depth research with citations',
    systemPrompt:
      "You are a Deep Research Agent. Conduct thorough, multi-step research.\n\nPROCESS:\n1. Search using web_search for richer results\n2. Identify the most relevant URLs (typically 3-5)\n3. Use web_fetch to read key URLs in depth\n4. Use file_read when the user attached documents\n5. Synthesise across sources with inline citations [1], [2]\n\nSTRICT GROUNDING: Only state facts supported by retrieved sources or attachments. If a source lacks the answer, say so.\n\nOUTPUT: ## Summary, ## Findings (with [n] citations), ## Sources.",
    defaultModelId: 'gemini-3.1-pro-preview',
    directModelId: null,
    agentType: 'specialized',
    categorySlug: 'agents',
    allowedTools: ['webSearch', 'webFetch', 'documentAnalysis', 'documentCreation'],
    toolBudgets: { web_search: 6, web_fetch: 6 },
    examplePrompts: [
      { title: 'Literature review', prompt: 'Do a deep review of recent research on solid-state batteries' },
      { title: 'Deep comparison', prompt: 'Thoroughly compare three cloud providers for ML workloads' },
    ],
    tags: ['research', 'deep', 'citations'],
    costMultiplier: 3.0,
    maxToolRounds: 20,
    maxTokensPerMessage: 4096,
    maxContextMessages: 30,
    isAutoEligible: false,
    sortOrder: 8,
    fallbackAgent: 'research',
  },
  {
    slug: 'ui',
    displayName: 'UI Generator',
    description: 'Generate complete, self-contained HTML/CSS/JS interfaces. Manual-only.',
    shortDescription: 'Generate HTML/CSS/JS interfaces',
    systemPrompt:
      "You are a UI Generator AI. You create clean, working HTML/CSS/JS interfaces.\n\nRULES:\n- Output complete, self-contained HTML (no external CDN dependencies unless explicitly requested)\n- Use modern CSS (flexbox/grid) - no Bootstrap or Tailwind by default\n- JavaScript should be vanilla or minimal\n- The output renders in a sandboxed iframe - no localStorage, cookies, or fetch calls\n\nALWAYS use html_generate to output the interface. Never output raw HTML in the chat message. After generating, describe what you built in 1-2 sentences.",
    defaultModelId: 'gpt-5.4',
    directModelId: null,
    agentType: 'specialized',
    categorySlug: 'agents',
    allowedTools: ['htmlPreview', 'documentCreation', 'documentAnalysis'],
    toolBudgets: {},
    examplePrompts: [
      { title: 'Build a landing page', prompt: 'Build a hero section for a SaaS landing page' },
      { title: 'Make a form', prompt: 'Create a styled contact form with validation' },
    ],
    tags: ['ui', 'frontend'],
    costMultiplier: 1.3,
    maxToolRounds: 6,
    maxTokensPerMessage: 4096,
    maxContextMessages: 10,
    isAutoEligible: false,
    sortOrder: 9,
    fallbackAgent: 'code',
  },
  {
    slug: 'math',
    displayName: 'Math & Logic',
    description: 'Pure mathematics, logic, and logistics. Manual-only reasoning specialist.',
    shortDescription: 'Mathematics and logical reasoning',
    systemPrompt:
      "You are a mathematics and logic specialist. Solve problems rigorously and show your reasoning.\n\n- Work step by step; state assumptions explicitly\n- Use code_execution to verify numerical results, run simulations, or check edge cases\n- Prefer exact answers; give approximations only when asked\n- For proofs, lay out the argument clearly and justify each step",
    defaultModelId: 'o3',
    directModelId: null,
    agentType: 'specialized',
    categorySlug: 'agents',
    allowedTools: ['codeExecution', 'documentAnalysis', 'documentCreation', 'webSearch'],
    toolBudgets: { code_execution: 5, web_search: 2 },
    examplePrompts: [
      { title: 'Solve a problem', prompt: 'Solve this system of equations step by step' },
      { title: 'Optimisation', prompt: 'Find the optimal route for this logistics problem' },
    ],
    tags: ['math', 'logic', 'reasoning'],
    costMultiplier: 2.0,
    maxToolRounds: 12,
    maxTokensPerMessage: 4096,
    maxContextMessages: 20,
    isAutoEligible: false,
    sortOrder: 10,
    fallbackAgent: 'general',
  },
  {
    slug: 'fact-check',
    displayName: 'Fact-Check & Risk',
    description: 'Factual fact-checking and market-risk assessment. Manual-only specialist.',
    shortDescription: 'Fact-checking and risk assessment',
    systemPrompt:
      "You are a fact-checking and risk-assessment specialist. Verify claims against current, authoritative sources.\n\n1. Identify each discrete factual claim\n2. Use web_search and web_fetch to find authoritative, recent sources\n3. Rate each claim: Supported / Partially supported / Unsupported / Contradicted\n4. Cite sources inline [n] and flag uncertainty or conflicting evidence\n\nBe impartial. Distinguish fact from opinion and surface material risks.",
    defaultModelId: 'grok-4.3',
    directModelId: null,
    agentType: 'specialized',
    categorySlug: 'agents',
    allowedTools: ['webSearch', 'webFetch', 'documentCreation', 'documentAnalysis'],
    toolBudgets: { web_search: 5, web_fetch: 4 },
    examplePrompts: [
      { title: 'Check a claim', prompt: 'Fact-check the claims in this article' },
      { title: 'Assess risk', prompt: 'What are the market risks for this sector right now?' },
    ],
    tags: ['fact-check', 'risk'],
    costMultiplier: 1.5,
    maxToolRounds: 12,
    maxTokensPerMessage: 2048,
    maxContextMessages: 20,
    isAutoEligible: false,
    sortOrder: 11,
    fallbackAgent: 'research',
  },
  // ── Direct Model agents (AI Models category) ──────────────────────────────
  {
    slug: 'claude',
    displayName: 'Claude',
    description: 'Talk directly to Anthropic Claude Opus 4.7.',
    shortDescription: 'Anthropic flagship - Claude Opus 4.7',
    systemPrompt: 'You are Claude, a helpful AI assistant made by Anthropic. Be clear, accurate, and thoughtful.',
    defaultModelId: 'claude-opus-4-7',
    directModelId: 'claude-opus-4-7',
    agentType: 'direct',
    categorySlug: 'ai-models',
    allowedTools: FULL_TOOLSET,
    toolBudgets: {},
    examplePrompts: [
      { title: 'Complex reasoning', prompt: 'Reason through this complex problem with me' },
      { title: 'Long-form content', prompt: 'Write a detailed report on this topic' },
    ],
    tags: ['anthropic', 'flagship'],
    costMultiplier: 1.0,
    maxToolRounds: 10,
    maxTokensPerMessage: 4096,
    maxContextMessages: 20,
    isAutoEligible: false,
    sortOrder: 20,
    fallbackAgent: 'general',
  },
  {
    slug: 'gpt',
    displayName: 'GPT',
    description: 'Talk directly to OpenAI GPT-5.5.',
    shortDescription: 'OpenAI flagship - GPT-5.5',
    systemPrompt: 'You are a helpful AI assistant powered by OpenAI GPT-5.5. Provide accurate, well-structured responses.',
    defaultModelId: 'gpt-5.5',
    directModelId: 'gpt-5.5',
    agentType: 'direct',
    categorySlug: 'ai-models',
    allowedTools: FULL_TOOLSET,
    toolBudgets: {},
    examplePrompts: [
      { title: 'Coding & agents', prompt: 'Help me design and build this feature' },
      { title: 'Explain a topic', prompt: 'Explain this topic in depth' },
    ],
    tags: ['openai', 'flagship'],
    costMultiplier: 1.0,
    maxToolRounds: 10,
    maxTokensPerMessage: 4096,
    maxContextMessages: 20,
    isAutoEligible: false,
    sortOrder: 21,
    fallbackAgent: 'general',
  },
  {
    slug: 'gemini',
    displayName: 'Gemini',
    description: 'Talk directly to Google Gemini 3.1 Pro.',
    shortDescription: 'Google frontier - Gemini 3.1 Pro',
    systemPrompt: 'You are a helpful AI assistant powered by Google Gemini 3.1 Pro. Provide thoughtful, accurate, well-structured responses.',
    defaultModelId: 'gemini-3.1-pro-preview',
    directModelId: 'gemini-3.1-pro-preview',
    agentType: 'direct',
    categorySlug: 'ai-models',
    allowedTools: FULL_TOOLSET,
    toolBudgets: {},
    examplePrompts: [
      { title: 'Multimodal analysis', prompt: 'Analyse this image and explain what you see' },
      { title: 'Long-context task', prompt: 'Summarise this very long document' },
    ],
    tags: ['google', 'flagship'],
    costMultiplier: 1.0,
    maxToolRounds: 10,
    maxTokensPerMessage: 4096,
    maxContextMessages: 20,
    isAutoEligible: false,
    sortOrder: 22,
    fallbackAgent: 'general',
  },
  {
    slug: 'deepseek',
    displayName: 'DeepSeek',
    description: 'Talk directly to DeepSeek V4 Pro.',
    shortDescription: 'DeepSeek flagship - V4 Pro',
    systemPrompt: 'You are a helpful AI assistant powered by DeepSeek V4 Pro. Be thorough yet concise, and reason carefully.',
    defaultModelId: 'deepseek-v4-pro',
    directModelId: 'deepseek-v4-pro',
    agentType: 'direct',
    categorySlug: 'ai-models',
    allowedTools: ['webSearch', 'webFetch', 'codeExecution', 'documentAnalysis', 'documentCreation', 'htmlPreview', 'chartGenerate'],
    toolBudgets: {},
    examplePrompts: [
      { title: 'Reason through a problem', prompt: 'Walk me through solving this logic puzzle step by step' },
      { title: 'Code help', prompt: 'Explain this function and suggest improvements' },
    ],
    tags: ['deepseek', 'flagship'],
    costMultiplier: 1.0,
    maxToolRounds: 10,
    maxTokensPerMessage: 4096,
    maxContextMessages: 20,
    isAutoEligible: false,
    sortOrder: 23,
    fallbackAgent: 'general',
  },
  {
    slug: 'grok',
    displayName: 'Grok',
    description: 'Talk directly to xAI Grok 4.3.',
    shortDescription: 'xAI flagship - Grok 4.3',
    systemPrompt: 'You are Grok, a helpful AI assistant made by xAI. Be clear, accurate, and engaging.',
    defaultModelId: 'grok-4.3',
    directModelId: 'grok-4.3',
    agentType: 'direct',
    categorySlug: 'ai-models',
    allowedTools: FULL_TOOLSET,
    toolBudgets: {},
    examplePrompts: [
      { title: 'Quick analysis', prompt: 'Analyse this and give me key takeaways' },
      { title: 'Creative writing', prompt: 'Write a short story about a robot learning to paint' },
    ],
    tags: ['xai', 'grok', 'flagship'],
    costMultiplier: 1.0,
    maxToolRounds: 10,
    maxTokensPerMessage: 2048,
    maxContextMessages: 20,
    isAutoEligible: false,
    sortOrder: 24,
    fallbackAgent: 'general',
  },
];

async function seedAgents(
  categoryIds: Map<string, string>,
  availableModelIds: Set<string>,
): Promise<void> {
  const pool = getPool();

  for (const a of AGENT_SEEDS) {
    if (!availableModelIds.has(a.defaultModelId)) {
      console.info(`Seed: agent "${a.slug}" skipped (default model "${a.defaultModelId}" not available).`);
      continue;
    }
    if (a.directModelId && !availableModelIds.has(a.directModelId)) {
      console.info(`Seed: agent "${a.slug}" skipped (direct model "${a.directModelId}" not available).`);
      continue;
    }

    const categoryId = categoryIds.get(a.categorySlug) ?? null;

    await pool.query(
      `INSERT INTO agents (
         slug, display_name, description, short_description, system_prompt,
         default_model_id, direct_model_id, agent_type, category_id,
         allowed_tools, tool_budgets, example_prompts, tags,
         cost_multiplier, max_tool_rounds, max_tokens_per_message, max_context_messages,
         fallback_agent, sort_order, is_auto_eligible,
         is_active, is_visible, is_system
       )
       VALUES (
         $1, $2, $3, $4, $5,
         $6, $7, $8, $9,
         $10, $11::jsonb, $12::jsonb, $13,
         $14, $15, $16, $17,
         $18, $19, $20,
         true, true, false
       )
       ON CONFLICT (slug) DO NOTHING`,
      [
        a.slug,
        a.displayName,
        a.description,
        a.shortDescription,
        a.systemPrompt,
        a.defaultModelId,
        a.directModelId,
        a.agentType,
        categoryId,
        a.allowedTools,
        JSON.stringify(a.toolBudgets),
        JSON.stringify(a.examplePrompts),
        a.tags,
        a.costMultiplier,
        a.maxToolRounds,
        a.maxTokensPerMessage,
        a.maxContextMessages,
        a.fallbackAgent,
        a.sortOrder,
        a.isAutoEligible,
      ],
    );
    console.info(`Seed: agent "${a.slug}" ensured.`);
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Agent model priorities
// Cheaper models first. Insert only — does not override admin-edited priorities.
// ──────────────────────────────────────────────────────────────────────────

type AgentPrioritySeed = {
  agentSlug: string;
  models: Array<{ modelId: string; priority: number; notes?: string }>;
};

const AGENT_PRIORITY_SEEDS: AgentPrioritySeed[] = [
  // Basic agents lead with the cheap deepseek-v4-flash.
  {
    agentSlug: 'general',
    models: [
      { modelId: 'deepseek-v4-flash',         priority: 1, notes: 'Primary — cheapest' },
      { modelId: 'gemini-2.5-flash',          priority: 2, notes: 'Fallback' },
      { modelId: 'gpt-5.4-mini',              priority: 3, notes: 'Fallback' },
      { modelId: 'claude-haiku-4-5-20251001', priority: 4, notes: 'Quality fallback' },
    ],
  },
  {
    agentSlug: 'research',
    models: [
      { modelId: 'deepseek-v4-flash',         priority: 1, notes: 'Primary — cheapest' },
      { modelId: 'gemini-2.5-flash',          priority: 2, notes: 'Fallback — large context for web results' },
      { modelId: 'gpt-5.4-mini',              priority: 3, notes: 'Fallback' },
    ],
  },
  // Complex agents lead with deepseek-v4-pro (reasoning) where DeepSeek is primary.
  {
    agentSlug: 'code',
    models: [
      { modelId: 'deepseek-v4-pro',           priority: 1, notes: 'Primary — reasoning, strong at code' },
      { modelId: 'claude-sonnet-4-6',         priority: 2, notes: 'Quality fallback' },
      { modelId: 'gpt-5.4',                   priority: 3, notes: 'Fallback' },
      { modelId: 'grok-build-0.1',            priority: 4, notes: 'Coding specialist fallback' },
    ],
  },
  {
    agentSlug: 'debugger',
    models: [
      { modelId: 'deepseek-v4-pro',           priority: 1, notes: 'Primary — reasoning' },
      { modelId: 'gpt-5.4',                   priority: 2, notes: 'Fallback' },
      { modelId: 'claude-sonnet-4-6',         priority: 3, notes: 'Quality fallback' },
    ],
  },
  {
    agentSlug: 'writer',
    models: [
      { modelId: 'gemini-2.5-flash',          priority: 1, notes: 'Primary — office workhorse' },
      { modelId: 'claude-sonnet-4-6',         priority: 2, notes: 'Quality fallback' },
      { modelId: 'deepseek-v4-flash',         priority: 3, notes: 'Cheap fallback' },
    ],
  },
  {
    agentSlug: 'analyst',
    models: [
      { modelId: 'gemini-3.5-flash',          priority: 1, notes: 'Primary — strong multimodal/finance' },
      { modelId: 'gpt-5.4',                   priority: 2, notes: 'Fallback' },
      { modelId: 'deepseek-v4-pro',           priority: 3, notes: 'Reasoning fallback' },
    ],
  },
  {
    agentSlug: 'document',
    models: [
      { modelId: 'gemini-2.5-pro',            priority: 1, notes: 'Primary — 1M ctx, vision' },
      { modelId: 'grok-4.20',                 priority: 2, notes: 'Fallback — 2M context for huge docs' },
      { modelId: 'deepseek-v4-pro',           priority: 3, notes: 'Reasoning fallback' },
    ],
  },
  {
    agentSlug: 'architect',
    models: [
      { modelId: 'deepseek-v4-pro',           priority: 1, notes: 'Primary — reasoning' },
      { modelId: 'gemini-3.1-pro-preview',    priority: 2, notes: 'Frontier reasoning fallback' },
      { modelId: 'claude-opus-4-7',           priority: 3, notes: 'Top-quality fallback' },
    ],
  },
  {
    agentSlug: 'deep-research',
    models: [
      { modelId: 'gemini-3.1-pro-preview',    priority: 1, notes: 'Primary — frontier reasoning, 2M ctx' },
      { modelId: 'claude-opus-4-7',           priority: 2, notes: 'Top-quality fallback' },
      { modelId: 'deepseek-v4-pro',           priority: 3, notes: 'Cheaper reasoning fallback' },
    ],
  },
  {
    agentSlug: 'ui',
    models: [
      { modelId: 'gpt-5.4',                   priority: 1, notes: 'Primary — strong HTML generation' },
      { modelId: 'claude-sonnet-4-6',         priority: 2, notes: 'Quality fallback' },
      { modelId: 'grok-build-0.1',            priority: 3, notes: 'Coding specialist fallback' },
    ],
  },
  {
    agentSlug: 'math',
    models: [
      { modelId: 'o3',                        priority: 1, notes: 'Primary — multi-step reasoning' },
      { modelId: 'deepseek-r1',               priority: 2, notes: 'Reasoning fallback' },
      { modelId: 'gemini-3.1-pro-preview',    priority: 3, notes: 'Frontier reasoning fallback' },
    ],
  },
  {
    agentSlug: 'fact-check',
    models: [
      { modelId: 'grok-4.3',                  priority: 1, notes: 'Primary — live X search grounding' },
      { modelId: 'gpt-5.4',                   priority: 2, notes: 'Fallback' },
      { modelId: 'gemini-2.5-flash',          priority: 3, notes: 'Fallback' },
    ],
  },
];

async function seedAgentModelPriorities(availableModelIds: Set<string>): Promise<void> {
  const pool = getPool();

  for (const entry of AGENT_PRIORITY_SEEDS) {
    const agentRes = await pool.query(
      `SELECT id FROM agents WHERE slug = $1 AND is_active = true LIMIT 1`,
      [entry.agentSlug],
    );
    if (!agentRes.rowCount) {
      console.info(`Seed: agent_model_priorities for "${entry.agentSlug}" skipped (agent not found).`);
      continue;
    }
    const agentId = (agentRes.rows[0] as { id: string }).id;

    for (const m of entry.models) {
      if (!availableModelIds.has(m.modelId)) {
        console.info(`Seed: priority for "${entry.agentSlug}" → "${m.modelId}" skipped (model not available).`);
        continue;
      }
      await pool.query(
        `INSERT INTO agent_model_priorities (agent_id, model_id, priority, is_active, notes)
         VALUES ($1, $2, $3, true, $4)
         ON CONFLICT (agent_id, model_id) DO NOTHING`,
        [agentId, m.modelId, m.priority, m.notes ?? null],
      );
      console.info(`Seed: agent_model_priorities "${entry.agentSlug}" → "${m.modelId}" (priority ${m.priority}) ensured.`);
    }
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Plans
// ──────────────────────────────────────────────────────────────────────────

type PlanSeed = {
  id: string;
  slug: string;
  name: string;
  isIntroductory: boolean;
  priceInr: number;
  credits: number;
  rollover: boolean;
  limits: {
    hourly: number;
    daily: number;
    weekly: number;
    monthly: number;
    maxContextMessages: number;
    maxFileSize: number;
    maxFilesPerChat: number;
    maxArtifactVersions: number;
  };
  agentAccess: string[];
  featureFlags: Record<string, boolean>;
  featureLimits: Record<string, number | null>;
};

const PLAN_SEEDS: PlanSeed[] = [
  {
    id: 'plan_free_v1',
    slug: 'free',
    name: 'Free',
    isIntroductory: true,
    priceInr: 0,
    credits: 50,
    rollover: false,
    limits: {
      hourly: 10, daily: 30, weekly: 100, monthly: 50,
      maxContextMessages: 10, maxFileSize: 10485760,
      maxFilesPerChat: 5, maxArtifactVersions: 5,
    },
    agentAccess: ['general', 'research', 'writer'],
    featureFlags: {
      webSearch: true, webFetch: true, codeExecution: false, fileUpload: true,
      documentCreation: true, documentAnalysis: true,
      stockData: true, weatherData: true,
      deepResearch: false, artifactVersioning: true,
    },
    featureLimits: { webSearch: 5, codeExecution: 0 },
  },
  {
    id: 'plan_basic_v1',
    slug: 'basic',
    name: 'Basic',
    isIntroductory: false,
    priceInr: 999,
    credits: 200,
    rollover: false,
    limits: {
      hourly: 30, daily: 150, weekly: 700, monthly: 200,
      maxContextMessages: 15, maxFileSize: 10485760,
      maxFilesPerChat: 5, maxArtifactVersions: 10,
    },
    agentAccess: [
      'general', 'research', 'writer', 'code', 'document', 'analyst',
      'deepseek', 'grok',
    ],
    featureFlags: {
      webSearch: true, webFetch: true, codeExecution: true, fileUpload: true,
      documentCreation: true, documentAnalysis: true,
      stockData: true, weatherData: true, htmlPreview: true, imageAnalyse: true,
      deepResearch: false, artifactVersioning: true,
    },
    featureLimits: { webSearch: 30, codeExecution: 30 },
  },
  {
    id: 'plan_pro_v1',
    slug: 'pro',
    name: 'Pro',
    isIntroductory: false,
    priceInr: 1999,
    credits: 500,
    rollover: true,
    limits: {
      hourly: 60, daily: 400, weekly: 2000, monthly: 500,
      maxContextMessages: 30, maxFileSize: 26214400,
      maxFilesPerChat: 15, maxArtifactVersions: 30,
    },
    agentAccess: [
      'general', 'research', 'writer', 'code', 'document', 'analyst',
      'debugger', 'deep-research', 'fact-check', 'ui',
      'deepseek', 'grok', 'gpt', 'gemini', 'claude',
    ],
    featureFlags: {
      webSearch: true, webFetch: true, codeExecution: true, fileUpload: true,
      documentCreation: true, documentAnalysis: true,
      stockData: true, weatherData: true, htmlPreview: true,
      imageAnalyse: true, chartGenerate: true,
      deepResearch: true, artifactVersioning: true,
    },
    featureLimits: { webSearch: 200, codeExecution: 200 },
  },
  {
    id: 'plan_elite_v1',
    slug: 'elite',
    name: 'Elite',
    isIntroductory: false,
    priceInr: 2999,
    credits: 1000,
    rollover: true,
    limits: {
      hourly: 120, daily: 800, weekly: 4000, monthly: 1000,
      maxContextMessages: 50, maxFileSize: 52428800,
      maxFilesPerChat: 30, maxArtifactVersions: 100,
    },
    agentAccess: [
      'general', 'research', 'writer', 'code', 'document', 'analyst',
      'debugger', 'deep-research', 'fact-check', 'ui', 'architect', 'math',
      'deepseek', 'grok', 'gpt', 'gemini', 'claude',
    ],
    featureFlags: {
      webSearch: true, webFetch: true, codeExecution: true, fileUpload: true,
      documentCreation: true, documentAnalysis: true,
      stockData: true, weatherData: true, htmlPreview: true,
      imageAnalyse: true, chartGenerate: true,
      deepResearch: true, artifactVersioning: true,
    },
    featureLimits: { webSearch: null, codeExecution: null },
  },
];

async function seedPlans(availableModelIds: Set<string>): Promise<void> {
  const pool = getPool();

  const adminRes = await pool.query(
    `SELECT id FROM users WHERE role = 'superadmin' ORDER BY created_at LIMIT 1`,
  );
  const adminId = adminRes.rows[0]?.id;
  if (!adminId) {
    console.warn('Seed: skipping plans (no superadmin found).');
    return;
  }

  for (const p of PLAN_SEEDS) {
    await pool.query(
      `INSERT INTO plans (
         id, name, slug, status, is_public, is_introductory,
         pricing, credits, limits, agent_access,
         feature_flags, feature_limits, created_by
       )
       VALUES (
         $1, $2, $3, 'active', true, $4,
         $5::jsonb, $6::jsonb, $7::jsonb, $8,
         $9::jsonb, $10::jsonb, $11
       )
       ON CONFLICT (id) DO UPDATE SET
         feature_flags  = EXCLUDED.feature_flags,
         feature_limits = EXCLUDED.feature_limits,
         limits         = EXCLUDED.limits,
         agent_access   = EXCLUDED.agent_access,
         credits        = EXCLUDED.credits`,
      [
        p.id,
        p.name,
        p.slug,
        p.isIntroductory,
        JSON.stringify({ monthly: p.priceInr, annual: p.priceInr * 10, currency: 'inr' }),
        JSON.stringify({
          included: p.credits,
          rollover: p.rollover,
          maxRollover: p.rollover ? p.credits : null,
          topupEnabled: p.slug !== 'free',
          topupPackages: [],
        }),
        JSON.stringify(p.limits),
        p.agentAccess,
        JSON.stringify(p.featureFlags),
        JSON.stringify(p.featureLimits),
        adminId,
      ],
    );
    console.info(`Seed: plan "${p.slug}" ensured (₹${p.priceInr}/mo, ${p.credits} tokens).`);
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Runner
// ──────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  await seedSuperadmin();

  const providerIds = await seedProviders();
  const seededModelIds = await seedModels(providerIds);
  const availableModelIds = new Set(seededModelIds);

  // Include any pre-existing active models not in this seed run.
  const existing = await getPool().query(`SELECT model_id FROM ai_models WHERE is_active = true`);
  for (const row of existing.rows) availableModelIds.add(row.model_id);

  await seedSystemModelConfig(availableModelIds);
  const categoryIds = await seedAgentCategories();
  await seedAgents(categoryIds, availableModelIds);
  await seedAgentModelPriorities(availableModelIds);
  await seedPlans(availableModelIds);

  console.info('Seed: done.');
}

try {
  await main();
} catch (err) {
  console.error('Seed failed:', err);
  process.exitCode = 1;
} finally {
  try {
    await getPool().end();
  } catch {
    /* ignore */
  }
}
