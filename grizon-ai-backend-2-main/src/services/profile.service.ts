import { getPool } from "../db/pool.js";

export type LinkedProvider = { provider: "google"; provider_email: string; linked_at: string };

export type UserProfile = {
  id: string;
  email: string;
  name: string;
  bio: string | null;
  avatar_url: string | null;
  locale: string | null;
  timezone: string | null;
  role: "user" | "admin" | "superadmin";
  status: "active" | "banned" | "suspended";
  email_verified_at: string | null;
  mfa_enabled: boolean;
  has_password: boolean;
  linked_providers: LinkedProvider[];
  created_at: string;
  last_login_at: string | null;
};

export const profileService = {
  async getMe(userId: string): Promise<UserProfile> {
    const pool = getPool();
    const userRes = await pool.query(
      `
      SELECT
        id, email, name, bio, avatar_url, locale, timezone,
        role, status, email_verified_at, mfa_enabled,
        (password_hash IS NOT NULL) AS has_password,
        created_at, last_login_at
      FROM users
      WHERE id = $1
      LIMIT 1
    `,
      [userId],
    );

    if (userRes.rowCount === 0) throw new Error("User not found");

    const user = userRes.rows[0] as any;
    const providersRes = await pool.query(
      `
      SELECT provider, provider_email, linked_at
      FROM oauth_accounts
      WHERE user_id = $1 AND provider = 'google'
    `,
      [userId],
    );

    const linked_providers: LinkedProvider[] = providersRes.rows.map((r: any) => ({
      provider: "google",
      provider_email: r.provider_email,
      linked_at: r.linked_at,
    }));

    return {
      ...user,
      linked_providers,
    } as UserProfile;
  },

  async updateMe(userId: string, patch: { name?: string; bio?: string | null; avatar_url?: string | null; locale?: string | null; timezone?: string | null }) {
    const pool = getPool();

    const sets: string[] = [];
    const values: unknown[] = [];

    if (patch.name !== undefined) {
      sets.push(`name = $${values.length + 1}`);
      values.push(patch.name);
    }
    if (patch.bio !== undefined) {
      sets.push(`bio = $${values.length + 1}`);
      values.push(patch.bio);
    }
    if (patch.avatar_url !== undefined) {
      sets.push(`avatar_url = $${values.length + 1}`);
      values.push(patch.avatar_url);
    }
    if (patch.locale !== undefined) {
      sets.push(`locale = $${values.length + 1}`);
      values.push(patch.locale);
    }
    if (patch.timezone !== undefined) {
      sets.push(`timezone = $${values.length + 1}`);
      values.push(patch.timezone);
    }

    if (!sets.length) {
      return this.getMe(userId);
    }

    const res = await pool.query(
      `UPDATE users SET ${sets.join(", ")}, updated_at = now() WHERE id = $${values.length + 1} RETURNING id`,
      [...values, userId],
    );

    if (res.rowCount === 0) throw new Error("User not found");

    return this.getMe(userId);
  },
};

