import { getPool } from "../db/pool.js";
import { Errors } from "../utils/errors.js";
import { walletEvents } from "../events/wallet.events.js";
import type { Wallet, WalletTransaction, WalletTxType } from "../types/wallet.js";

type DbClient = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
  release: () => void;
};

function toIso(value: unknown): string {
  return new Date(String(value)).toISOString();
}

function mapWallet(row: Record<string, unknown>): Wallet {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    balance: Number(row.balance ?? 0),
    pending: Number(row.pending ?? 0),
    lifetimeEarned: Number(row.lifetime_earned ?? 0),
    lifetimeSpent: Number(row.lifetime_spent ?? 0),
    updatedAt: toIso(row.updated_at),
  };
}

function mapTx(row: Record<string, unknown>): WalletTransaction {
  return {
    id: String(row.id),
    walletId: String(row.wallet_id),
    type: row.type as WalletTxType,
    amount: Number(row.amount ?? 0),
    balanceAfter: Number(row.balance_after ?? 0),
    messageId: (row.message_id as string | null) ?? null,
    jobId: (row.job_id as string | null) ?? null,
    agentSlug: (row.agent_slug as string | null) ?? null,
    modelId: (row.model_id as string | null) ?? null,
    inputTokens: (row.input_tokens as number | null) ?? null,
    outputTokens: (row.output_tokens as number | null) ?? null,
    creditRate: row.credit_rate !== null && row.credit_rate !== undefined ? Number(row.credit_rate) : null,
    agentMultiplier:
      row.agent_multiplier !== null && row.agent_multiplier !== undefined ? Number(row.agent_multiplier) : null,
    planDiscount: row.plan_discount !== null && row.plan_discount !== undefined ? Number(row.plan_discount) : null,
    actorId: (row.actor_id as string | null) ?? null,
    description: String(row.description ?? ""),
    createdAt: toIso(row.created_at),
  };
}

async function withTx<T>(fn: (client: DbClient) => Promise<T>): Promise<T> {
  const pool = getPool();
  const client = (await pool.connect()) as DbClient;
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function getWalletForUpdate(client: DbClient, userId: string): Promise<Record<string, unknown>> {
  const res = await client.query(`SELECT * FROM wallets WHERE user_id = $1 FOR UPDATE`, [userId]);
  if (!res.rowCount) throw Errors.walletNotFound();
  return res.rows[0];
}

export const walletService = {
  async createForUser(userId: string): Promise<Wallet> {
    const pool = getPool();
    const res = await pool.query(
      `
      INSERT INTO wallets (user_id)
      VALUES ($1)
      ON CONFLICT (user_id) DO UPDATE SET user_id = EXCLUDED.user_id
      RETURNING *
    `,
      [userId],
    );
    return mapWallet(res.rows[0]);
  },

  async getBalance(userId: string): Promise<Wallet> {
    const pool = getPool();
    const res = await pool.query(`SELECT * FROM wallets WHERE user_id = $1 LIMIT 1`, [userId]);
    if (!res.rowCount) {
      return walletService.createForUser(userId);
    }
    return mapWallet(res.rows[0]);
  },

  async holdPending(
    userId: string,
    amount: number,
    ctx: { jobId?: string; messageId?: string; agentSlug?: string; modelId?: string; description?: string } = {},
  ): Promise<string> {
    if (amount <= 0) throw Errors.internal("wallet_invalid_hold_amount");
    return withTx(async (client) => {
      const row = await getWalletForUpdate(client, userId);
      const spendable = Number(row.balance) - Number(row.pending);
      if (spendable < amount) {
        throw Errors.insufficientCredits({
          creditsNeeded: amount,
          creditsAvailable: spendable,
          topupUrl: "/wallet/topup",
        });
      }

      await client.query(`UPDATE wallets SET pending = pending + $1, updated_at = now() WHERE id = $2`, [
        amount,
        row.id,
      ]);
      const txRes = await client.query(
        `
        INSERT INTO wallet_transactions (
          wallet_id, type, amount, hold_amount, balance_after, job_id, message_id, agent_slug, model_id, description
        ) VALUES ($1,'hold',$2,$3,$4,$5,$6,$7,$8,$9)
        RETURNING id
      `,
        [
          row.id,
          -amount,
          amount,
          Number(row.balance),
          ctx.jobId ?? null,
          ctx.messageId ?? null,
          ctx.agentSlug ?? null,
          ctx.modelId ?? null,
          ctx.description ?? "preflight_hold",
        ],
      );
      return String(txRes.rows[0].id);
    });
  },

  async confirmDeduction(
    holdId: string,
    args: {
      actualCost: number;
      inputTokens?: number;
      outputTokens?: number;
      creditRate?: number;
      agentMultiplier?: number;
      planDiscount?: number;
      modelId?: string;
      agentSlug?: string;
      messageId?: string;
      jobId?: string;
    },
  ): Promise<void> {
    await withTx(async (client) => {
      const settlementKey = `hold_settlement:${holdId}`;
      const alreadySettled = await client.query(
        `SELECT 1 FROM wallet_transactions WHERE description = $1 AND type IN ('deduct','refund') LIMIT 1`,
        [settlementKey],
      );
      if (alreadySettled.rowCount) return;

      const holdRes = await client.query(
        `SELECT wt.*, w.user_id FROM wallet_transactions wt JOIN wallets w ON w.id = wt.wallet_id WHERE wt.id = $1 LIMIT 1`,
        [holdId],
      );
      if (!holdRes.rowCount) return;
      const hold = holdRes.rows[0];
      if (hold.type !== "hold") return;
      const walletRes = await client.query(`SELECT * FROM wallets WHERE id = $1 FOR UPDATE`, [hold.wallet_id]);
      if (!walletRes.rowCount) throw Errors.walletNotFound();
      const wallet = walletRes.rows[0];

      const heldAmount = Number(hold.hold_amount ?? Math.abs(Number(hold.amount ?? 0)));
      const rawCost = Number(args.actualCost);
      const actualCost = Number.isFinite(rawCost) ? Math.max(0, Math.ceil(rawCost)) : 0;
      const newBalance = Number(wallet.balance) - actualCost;

      await client.query(
        `
        UPDATE wallets
        SET pending = GREATEST(0, pending - $1),
            balance = $2,
            lifetime_spent = lifetime_spent + $3,
            updated_at = now()
        WHERE id = $4
      `,
        [heldAmount, newBalance, actualCost, wallet.id],
      );

      await client.query(
        `
        INSERT INTO wallet_transactions (
          wallet_id, type, amount, balance_after, message_id, job_id, agent_slug, model_id,
          input_tokens, output_tokens, credit_rate, agent_multiplier, plan_discount, description
        ) VALUES ($1,'deduct',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      `,
        [
          wallet.id,
          -actualCost,
          newBalance,
          args.messageId ?? hold.message_id ?? null,
          args.jobId ?? hold.job_id ?? null,
          args.agentSlug ?? hold.agent_slug ?? null,
          args.modelId ?? hold.model_id ?? null,
          args.inputTokens ?? null,
          args.outputTokens ?? null,
          args.creditRate ?? null,
          args.agentMultiplier ?? null,
          args.planDiscount ?? null,
          settlementKey,
        ],
      );

      await client.query(`UPDATE wallet_transactions SET type = 'settled' WHERE id = $1`, [holdId]);

      if (newBalance < 0) {
        walletEvents.emit("wallet.balance_negative", {
          userId: String(hold.user_id),
          holdId,
          newBalance,
          actualCost,
        });
      }
      walletEvents.emit("wallet.deducted", {
        userId: String(hold.user_id),
        walletId: String(wallet.id),
        amount: actualCost,
        holdId,
      });
    });
  },

  async releaseHold(holdId: string, reason: string): Promise<void> {
    await withTx(async (client) => {
      const settlementKey = `hold_settlement:${holdId}`;
      const alreadySettled = await client.query(
        `SELECT 1 FROM wallet_transactions WHERE description = $1 AND type IN ('deduct','refund') LIMIT 1`,
        [settlementKey],
      );
      if (alreadySettled.rowCount) return;

      const holdRes = await client.query(
        `SELECT wt.*, w.user_id FROM wallet_transactions wt JOIN wallets w ON w.id = wt.wallet_id WHERE wt.id = $1 LIMIT 1`,
        [holdId],
      );
      if (!holdRes.rowCount) return;
      const hold = holdRes.rows[0];
      if (hold.type !== "hold") return;

      const walletRes = await client.query(`SELECT * FROM wallets WHERE id = $1 FOR UPDATE`, [hold.wallet_id]);
      if (!walletRes.rowCount) throw Errors.walletNotFound();
      const wallet = walletRes.rows[0];
      const heldAmount = Number(hold.hold_amount ?? Math.abs(Number(hold.amount ?? 0)));

      await client.query(`UPDATE wallets SET pending = GREATEST(0, pending - $1), updated_at = now() WHERE id = $2`, [
        heldAmount,
        wallet.id,
      ]);
      await client.query(
        `
        INSERT INTO wallet_transactions (wallet_id, type, amount, balance_after, message_id, job_id, agent_slug, model_id, description)
        VALUES ($1, 'refund', $2, $3, $4, $5, $6, $7, $8)
      `,
        [
          wallet.id,
          heldAmount,
          Number(wallet.balance),
          hold.message_id ?? null,
          hold.job_id ?? null,
          hold.agent_slug ?? null,
          hold.model_id ?? null,
          settlementKey,
        ],
      );
      await client.query(`UPDATE wallet_transactions SET type = 'released' WHERE id = $1`, [holdId]);
      walletEvents.emit("wallet.released", {
        userId: String(hold.user_id),
        walletId: String(wallet.id),
        holdId,
        amount: heldAmount,
        reason,
      });
    });
  },

  async grant(
    userId: string,
    amount: number,
    source: "subscription" | "topup" | "adjustment" | "rollover",
    ctx: { jobId?: string; description?: string; actorId?: string; idempotencyKey?: string } = {},
  ): Promise<{ wallet: Wallet; transaction: WalletTransaction; alreadyApplied: boolean }> {
    if (amount <= 0) throw Errors.internal("wallet_invalid_grant_amount");
    return withTx(async (client) => {
      if (ctx.idempotencyKey) {
        const existing = await client.query(
          `SELECT wt.*, w.user_id FROM wallet_transactions wt JOIN wallets w ON w.id = wt.wallet_id WHERE wt.idempotency_key = $1 LIMIT 1`,
          [ctx.idempotencyKey],
        );
        if (existing.rowCount) {
          const tx = mapTx(existing.rows[0]);
          const walletRes = await client.query(`SELECT * FROM wallets WHERE id = $1 LIMIT 1`, [tx.walletId]);
          const wallet = mapWallet(walletRes.rows[0]);
          return { wallet, transaction: tx, alreadyApplied: true };
        }
      }

      const row = await getWalletForUpdate(client, userId);
      const newBalance = Number(row.balance) + amount;
      await client.query(
        `UPDATE wallets SET balance = $1, lifetime_earned = lifetime_earned + $2, updated_at = now() WHERE id = $3`,
        [newBalance, amount, row.id],
      );
      const type = source === "subscription" ? "grant" : source;
      const txRes = await client.query(
        `
        INSERT INTO wallet_transactions (wallet_id, type, amount, balance_after, job_id, actor_id, description, idempotency_key)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        RETURNING *
      `,
        [
          row.id,
          type,
          amount,
          newBalance,
          ctx.jobId ?? null,
          ctx.actorId ?? null,
          ctx.description ?? source,
          ctx.idempotencyKey ?? null,
        ],
      );
      const walletRes = await client.query(`SELECT * FROM wallets WHERE id = $1`, [row.id]);
      const wallet = mapWallet(walletRes.rows[0]);
      const transaction = mapTx(txRes.rows[0]);
      walletEvents.emit("wallet.granted", { userId, walletId: wallet.id, amount, source, txId: transaction.id });
      return { wallet, transaction, alreadyApplied: false };
    });
  },

  async topup(
    userId: string,
    amount: number,
    orderId: string,
  ): Promise<{ wallet: Wallet; transaction: WalletTransaction; alreadyApplied: boolean }> {
    return walletService.grant(userId, amount, "topup", {
      jobId: orderId,
      description: "topup",
      idempotencyKey: `topup:${orderId}`,
    });
  },

  async adjust(
    userId: string,
    delta: number,
    reason: string,
    actorId: string,
    force = false,
  ): Promise<{ wallet: Wallet; transaction: WalletTransaction }> {
    if (delta === 0) throw Errors.zeroDelta();
    if (!reason || reason.trim().length < 10) throw Errors.reasonRequired();
    return withTx(async (client) => {
      const row = await getWalletForUpdate(client, userId);
      const nextBalance = Number(row.balance) + delta;
      if (nextBalance < 0 && !force) throw Errors.negativeBalanceRequiresForce();

      await client.query(`UPDATE wallets SET balance = $1, updated_at = now() WHERE id = $2`, [nextBalance, row.id]);
      if (delta > 0) {
        await client.query(`UPDATE wallets SET lifetime_earned = lifetime_earned + $1 WHERE id = $2`, [delta, row.id]);
      } else {
        await client.query(`UPDATE wallets SET lifetime_spent = lifetime_spent + $1 WHERE id = $2`, [Math.abs(delta), row.id]);
      }

      const txRes = await client.query(
        `
        INSERT INTO wallet_transactions (wallet_id, type, amount, balance_after, actor_id, description)
        VALUES ($1,'adjustment',$2,$3,$4,$5)
        RETURNING *
      `,
        [row.id, delta, nextBalance, actorId, reason.trim()],
      );
      const walletRes = await client.query(`SELECT * FROM wallets WHERE id = $1`, [row.id]);
      const wallet = mapWallet(walletRes.rows[0]);
      const transaction = mapTx(txRes.rows[0]);
      walletEvents.emit("wallet.adjusted", { userId, walletId: wallet.id, delta, actorId, txId: transaction.id });
      return { wallet, transaction };
    });
  },

  async listTransactions(args: {
    userId: string;
    page: number;
    pageSize: number;
    type?: WalletTxType;
    from?: string;
    to?: string;
  }): Promise<{ transactions: WalletTransaction[]; total: number }> {
    const pool = getPool();
    const wallet = await walletService.getBalance(args.userId);
    const filters: string[] = ["wallet_id = $1", "type NOT IN ('hold','settled','released')"];
    const params: unknown[] = [wallet.id];
    let idx = 2;
    if (args.type) {
      filters.push(`type = $${idx++}`);
      params.push(args.type);
    }
    if (args.from) {
      filters.push(`created_at >= $${idx++}`);
      params.push(args.from);
    }
    if (args.to) {
      filters.push(`created_at <= $${idx++}`);
      params.push(args.to);
    }
    const where = filters.join(" AND ");
    const countRes = await pool.query(`SELECT COUNT(*)::int AS c FROM wallet_transactions WHERE ${where}`, params);
    const total = Number(countRes.rows[0]?.c ?? 0);

    const offset = (args.page - 1) * args.pageSize;
    params.push(args.pageSize, offset);
    const dataRes = await pool.query(
      `SELECT * FROM wallet_transactions WHERE ${where} ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx}`,
      params,
    );
    return { transactions: dataRes.rows.map(mapTx), total };
  },

  async getTransactionById(userId: string, txId: string): Promise<WalletTransaction | null> {
    const pool = getPool();
    const res = await pool.query(
      `
      SELECT wt.*
      FROM wallet_transactions wt
      JOIN wallets w ON w.id = wt.wallet_id
      WHERE w.user_id = $1 AND wt.id = $2 AND wt.type NOT IN ('hold','settled','released')
      LIMIT 1
    `,
      [userId, txId],
    );
    if (!res.rowCount) return null;
    return mapTx(res.rows[0]);
  },

  async listWalletsAdmin(args: {
    q?: string;
    balanceBelow?: number;
    balanceAbove?: number;
    pendingAbove?: number;
    sort?: string;
    page: number;
    pageSize: number;
  }): Promise<{ rows: Array<{ user: { id: string; email: string; name: string }; wallet: Wallet; plan: { id: string; slug: string } | null }>; total: number }> {
    const pool = getPool();
    const filters = ["TRUE"];
    const params: unknown[] = [];
    let i = 1;
    if (args.q) {
      filters.push(`(u.email ILIKE $${i} OR u.id::text ILIKE $${i} OR u.name ILIKE $${i})`);
      params.push(`%${args.q}%`);
      i++;
    }
    if (args.balanceBelow !== undefined) {
      filters.push(`w.balance < $${i++}`);
      params.push(args.balanceBelow);
    }
    if (args.balanceAbove !== undefined) {
      filters.push(`w.balance > $${i++}`);
      params.push(args.balanceAbove);
    }
    if (args.pendingAbove !== undefined) {
      filters.push(`w.pending > $${i++}`);
      params.push(args.pendingAbove);
    }
    const where = filters.join(" AND ");
    const countRes = await pool.query(
      `SELECT COUNT(*)::int AS c FROM wallets w JOIN users u ON u.id = w.user_id WHERE ${where}`,
      params,
    );
    const total = Number(countRes.rows[0]?.c ?? 0);
    const sortMap: Record<string, string> = {
      balance: "w.balance ASC",
      "-balance": "w.balance DESC",
      lifetime_spent: "w.lifetime_spent ASC",
      "-lifetime_spent": "w.lifetime_spent DESC",
      updated_at: "w.updated_at ASC",
      "-updated_at": "w.updated_at DESC",
    };
    const orderBy = sortMap[args.sort ?? "-updated_at"] ?? sortMap["-updated_at"];
    const offset = (args.page - 1) * args.pageSize;
    params.push(args.pageSize, offset);
    const lim = i++;
    const off = i;
    const dataRes = await pool.query(
      `
      SELECT
        u.id AS user_id,
        u.email AS user_email,
        u.name AS user_name,
        w.*,
        s.plan_id,
        (s.plan_snapshot->>'slug')::text AS plan_slug
      FROM wallets w
      JOIN users u ON u.id = w.user_id
      LEFT JOIN subscriptions s ON s.user_id = w.user_id AND s.status = 'active'
      WHERE ${where}
      ORDER BY ${orderBy}
      LIMIT $${lim} OFFSET $${off}
    `,
      params,
    );
    return {
      total,
      rows: dataRes.rows.map((r: Record<string, unknown>) => ({
        user: {
          id: String(r.user_id),
          email: String(r.user_email),
          name: String(r.user_name ?? ""),
        },
        wallet: mapWallet(r),
        plan: r.plan_id ? { id: String(r.plan_id), slug: String(r.plan_slug ?? "") } : null,
      })),
    };
  },
};
