import { getPool } from "../db/pool.js";

export const auditService = {
  async record(args: {
    eventType: string;
    userId?: string | null;
    actorId?: string | null;
    ip?: string | null;
    userAgent?: string | null;
    fingerprint?: string | null;
    success: boolean;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    const pool = getPool();
    await pool.query(
      `
      INSERT INTO auth_audit (user_id, actor_id, event_type, ip, user_agent, fingerprint, success, metadata)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    `,
      [
        args.userId ?? null,
        args.actorId ?? null,
        args.eventType,
        args.ip ?? null,
        args.userAgent ?? null,
        args.fingerprint ?? null,
        args.success,
        args.metadata ? JSON.stringify(args.metadata) : JSON.stringify({}),
      ],
    );
  },
};

