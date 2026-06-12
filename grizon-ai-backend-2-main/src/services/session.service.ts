import { getPool } from '../db/pool.js';
import type { Platform } from '../types/auth.js';

export type SessionRow = {
  id: string;
  user_id: string;
  platform: Platform;
  device_name: string;
  fingerprint: string;
  issued_at: string;
  expires_at: string;
  last_used_at: string | null;
  ip: string | null;
  os: string | null;
  browser: string | null;
  app_version: string | null;
  device_type: string | null;
  user_agent: string | null;
};

export const sessionService = {
  async loadActiveSessionById(args: { sessionId: string }) {
    const pool = getPool();
    const now = new Date();
    const res = await pool.query(
      `
      SELECT
        id, user_id, platform, device_name, fingerprint,
        issued_at, expires_at, last_used_at,
        ip, os, browser, app_version, device_type, user_agent
      FROM refresh_tokens
      WHERE id = $1 AND revoked_at IS NULL AND expires_at > $2
      LIMIT 1
    `,
      [args.sessionId, now.toISOString()],
    );

    return res.rowCount ? (res.rows[0] as SessionRow) : null;
  },

  async listActiveSessionsForUser(args: { userId: string }) {
    const pool = getPool();
    const now = new Date();
    const res = await pool.query(
      `
      SELECT
        id, user_id, platform, device_name, fingerprint,
        issued_at, expires_at, last_used_at,
        ip, os, browser, app_version, device_type, user_agent
      FROM refresh_tokens
      WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > $2
      ORDER BY
        (last_used_at IS NOT NULL) DESC,
        last_used_at DESC NULLS LAST,
        issued_at DESC
    `,
      [args.userId, now.toISOString()],
    );

    return res.rows as SessionRow[];
  },

  async revokeSession(args: {
    sessionId: string;
    userId: string;
    reason: string;
  }) {
    const pool = getPool();
    const res = await pool.query(
      `
      UPDATE refresh_tokens
      SET revoked_at = now(), revoke_reason = $3
      WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL
      RETURNING id
    `,
      [args.sessionId, args.userId, args.reason],
    );

    return res.rowCount ? (res.rows[0].id as string) : null;
  },

  async revokeAllSessionsForUser(args: { userId: string; reason: string }) {
    const pool = getPool();
    await pool.query(
      `
      UPDATE refresh_tokens
      SET revoked_at = now(), revoke_reason = $2
      WHERE user_id = $1 AND revoked_at IS NULL
    `,
      [args.userId, args.reason],
    );
  },
};
