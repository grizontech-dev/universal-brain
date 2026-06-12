import { getPool } from "../db/pool.js";
import { Errors } from "../utils/errors.js";
import { planRowToPlan } from "../utils/planSerialize.js";
import { planEvents } from "../events/plan.events.js";
import type { Plan, SubscriptionStatus } from "../types/plan.js";

type ListPublicArgs = { page: number; pageSize: number };

type ListAllArgs = {
  status?: "active" | "archived";
  isPublic?: boolean;
  page: number;
  pageSize: number;
};

const IMMUTABLE_PLAN_PATCH_KEYS = new Set([
  "id",
  "slug",
  "name",
  "status",
  "createdBy",
  "createdAt",
  "archivedAt",
  "created_by",
  "created_at",
  "archived_at",
]);

export const planService = {
  async listPublicPlans(args: ListPublicArgs): Promise<{ plans: Plan[]; total: number }> {
    const pool = getPool();
    const offset = (args.page - 1) * args.pageSize;

    const countRes = await pool.query(
      `SELECT COUNT(*)::int AS c FROM plans WHERE status = 'active' AND is_public = true`,
    );
    const total = countRes.rows[0]?.c ?? 0;

    const dataRes = await pool.query(
      `
      SELECT *
      FROM plans
      WHERE status = 'active' AND is_public = true
      ORDER BY (pricing->>'monthly')::numeric ASC NULLS LAST, created_at ASC
      LIMIT $1 OFFSET $2
    `,
      [args.pageSize, offset],
    );

    const plans = dataRes.rows.map((r: Record<string, unknown>) => planRowToPlan(r));
    return { plans, total };
  },

  async listAllPlans(args: ListAllArgs): Promise<{ plans: Plan[]; total: number }> {
    const pool = getPool();
    const offset = (args.page - 1) * args.pageSize;
    const filters: string[] = [`TRUE`];
    const values: unknown[] = [];
    let i = 1;

    if (args.status) {
      filters.push(`status = $${i++}`);
      values.push(args.status);
    }
    if (args.isPublic !== undefined) {
      filters.push(`is_public = $${i++}`);
      values.push(args.isPublic);
    }

    const where = filters.join(" AND ");

    const countRes = await pool.query(`SELECT COUNT(*)::int AS c FROM plans WHERE ${where}`, values);
    const total = countRes.rows[0]?.c ?? 0;

    values.push(args.pageSize, offset);
    const limIdx = i++;
    const offIdx = i;

    const dataRes = await pool.query(
      `SELECT * FROM plans WHERE ${where} ORDER BY created_at DESC LIMIT $${limIdx} OFFSET $${offIdx}`,
      values,
    );

    const plans = dataRes.rows.map((r: Record<string, unknown>) => planRowToPlan(r));
    return { plans, total };
  },

  async getPlanById(id: string): Promise<Plan | null> {
    const pool = getPool();
    const res = await pool.query(`SELECT * FROM plans WHERE id = $1 LIMIT 1`, [id]);
    if (!res.rowCount) return null;
    return planRowToPlan(res.rows[0] as Record<string, unknown>);
  },

  async createPlan(payload: {
    id: string;
    name: string;
    slug: string;
    isPublic?: boolean;
    isIntroductory?: boolean;
    pricing: Plan["pricing"];
    credits: Plan["credits"];
    limits: Plan["limits"];
    agentAccess: string[];
    featureFlags: Record<string, boolean>;
    featureLimits?: Plan["featureLimits"];
    createdBy: string;
  }): Promise<Plan> {
    const pool = getPool();
    try {
      const res = await pool.query(
        `
        INSERT INTO plans (
          id, name, slug, status, is_public, is_introductory,
          pricing, credits, limits,
          agent_access, feature_flags, feature_limits,
          created_by
        ) VALUES ($1,$2,$3,'active',$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9,$10::jsonb,$11::jsonb,$12)
        RETURNING *
      `,
        [
          payload.id,
          payload.name,
          payload.slug,
          payload.isPublic ?? false,
          payload.isIntroductory ?? false,
          JSON.stringify(payload.pricing),
          JSON.stringify(payload.credits),
          JSON.stringify(payload.limits),
          payload.agentAccess,
          JSON.stringify(payload.featureFlags),
          JSON.stringify(payload.featureLimits ?? {}),
          payload.createdBy,
        ],
      );
      const plan = planRowToPlan(res.rows[0] as Record<string, unknown>);
      planEvents.emit("plan.created" as any, { planId: plan.id, actorUserId: payload.createdBy });
      return plan;
    } catch (e: unknown) {
      if (e && typeof e === "object" && "code" in e && (e as { code: string }).code === "23505") {
        const msg = String((e as { detail?: string }).detail ?? "");
        if (msg.includes("(slug)") || msg.includes("slug")) throw Errors.planSlugTaken();
        throw Errors.planIdTaken();
      }
      throw e;
    }
  },

  async updatePlan(
    id: string,
    patch: Record<string, unknown>,
    actorUserId: string,
  ): Promise<Plan> {
    const forbidden = Object.keys(patch).filter((k) => IMMUTABLE_PLAN_PATCH_KEYS.has(k));
    if (forbidden.length) throw Errors.planFieldImmutable(forbidden);

    const pool = getPool();
    const existing = await pool.query(`SELECT * FROM plans WHERE id = $1 LIMIT 1`, [id]);
    if (!existing.rowCount) throw Errors.planNotFound();

    const sets: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    if (patch.pricing !== undefined) {
      sets.push(`pricing = $${i++}::jsonb`);
      values.push(JSON.stringify(patch.pricing));
    }
    if (patch.credits !== undefined) {
      sets.push(`credits = $${i++}::jsonb`);
      values.push(JSON.stringify(patch.credits));
    }
    if (patch.limits !== undefined) {
      sets.push(`limits = $${i++}::jsonb`);
      values.push(JSON.stringify(patch.limits));
    }
    if (patch.agentAccess !== undefined) {
      sets.push(`agent_access = $${i++}`);
      values.push(patch.agentAccess);
    }
    if (patch.featureFlags !== undefined) {
      sets.push(`feature_flags = $${i++}::jsonb`);
      values.push(JSON.stringify(patch.featureFlags));
    }
    if (patch.featureLimits !== undefined) {
      sets.push(`feature_limits = $${i++}::jsonb`);
      values.push(JSON.stringify(patch.featureLimits));
    }
    if (patch.isPublic !== undefined) {
      sets.push(`is_public = $${i++}`);
      values.push(patch.isPublic);
    }
    if (patch.isIntroductory !== undefined) {
      sets.push(`is_introductory = $${i++}`);
      values.push(patch.isIntroductory);
    }

    if (!sets.length) {
      return planRowToPlan(existing.rows[0] as Record<string, unknown>);
    }

    values.push(id);
    const res = await pool.query(`UPDATE plans SET ${sets.join(", ")} WHERE id = $${i} RETURNING *`, values);
    const plan = planRowToPlan(res.rows[0] as Record<string, unknown>);
    planEvents.emit("plan.updated" as any, { planId: id, actorUserId });
    return plan;
  },

  async archivePlan(id: string, actorUserId: string): Promise<Plan> {
    const pool = getPool();
    const existing = await pool.query(`SELECT * FROM plans WHERE id = $1 LIMIT 1`, [id]);
    if (!existing.rowCount) throw Errors.planNotFound();
    const row = existing.rows[0] as Record<string, unknown>;
    if (row.status === "archived") {
      return planRowToPlan(row);
    }
    const res = await pool.query(
      `UPDATE plans SET status = 'archived', archived_at = now() WHERE id = $1 RETURNING *`,
      [id],
    );
    const plan = planRowToPlan(res.rows[0] as Record<string, unknown>);
    planEvents.emit("plan.archived" as any, { planId: id, actorUserId });
    return plan;
  },

  async publishPlan(id: string, actorUserId: string): Promise<Plan> {
    const pool = getPool();
    const existing = await pool.query(`SELECT * FROM plans WHERE id = $1 LIMIT 1`, [id]);
    if (!existing.rowCount) throw Errors.planNotFound();
    const row = existing.rows[0] as Record<string, unknown>;
    if (row.status === "archived") throw Errors.planArchived();

    const res = await pool.query(`UPDATE plans SET is_public = true WHERE id = $1 RETURNING *`, [id]);
    const plan = planRowToPlan(res.rows[0] as Record<string, unknown>);
    planEvents.emit("plan.published" as any, { planId: id, actorUserId });
    return plan;
  },

  async getSubscribersOfPlan(args: {
    planId: string;
    status?: SubscriptionStatus;
    page: number;
    pageSize: number;
  }): Promise<{
    subscribers: Array<{
      userId: string;
      email: string;
      name: string;
      subscriptionId: string;
      billingCycle: string;
      status: SubscriptionStatus;
      currentPeriodEnd: string;
    }>;
    total: number;
  }> {
    const pool = getPool();

    const planExists = await pool.query(`SELECT 1 FROM plans WHERE id = $1`, [args.planId]);
    if (!planExists.rowCount) throw Errors.planNotFound();

    const statusFilter = args.status ?? "active";
    const offset = (args.page - 1) * args.pageSize;

    const countRes = await pool.query(
      `
      SELECT COUNT(*)::int AS c
      FROM subscriptions s
      WHERE s.plan_id = $1 AND s.status = $2
    `,
      [args.planId, statusFilter],
    );
    const total = countRes.rows[0]?.c ?? 0;

    const dataRes = await pool.query(
      `
      SELECT s.user_id, u.email, u.name, s.id AS subscription_id, s.billing_cycle, s.status, s.current_period_end
      FROM subscriptions s
      JOIN users u ON u.id = s.user_id
      WHERE s.plan_id = $1 AND s.status = $2
      ORDER BY s.current_period_end DESC
      LIMIT $3 OFFSET $4
    `,
      [args.planId, statusFilter, args.pageSize, offset],
    );

    const subscribers = dataRes.rows.map((r: Record<string, unknown>) => ({
      userId: String(r.user_id),
      email: String(r.email),
      name: String(r.name ?? ""),
      subscriptionId: String(r.subscription_id),
      billingCycle: String(r.billing_cycle),
      status: r.status as SubscriptionStatus,
      currentPeriodEnd: new Date(r.current_period_end as string).toISOString(),
    }));

    return { subscribers, total };
  },

  async syncSnapshots(planId: string): Promise<{ synced: number }> {
    const pool = getPool();
    const planRes = await pool.query(`SELECT * FROM plans WHERE id = $1 LIMIT 1`, [planId]);
    if (!planRes.rowCount) throw new Error("Plan not found");
    const plan = planRowToPlan(planRes.rows[0]);
    const result = await pool.query(
      `UPDATE subscriptions
       SET plan_snapshot = $2::jsonb
       WHERE plan_id = $1 AND status = 'active'`,
      [planId, JSON.stringify(plan)],
    );
    return { synced: result.rowCount ?? 0 };
  },
};
