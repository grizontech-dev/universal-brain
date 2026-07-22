import { readFile } from "fs/promises";
import { createHash as createNodeHash } from "crypto";

import { getPool, retryQuery } from "../db/pool.js";
import { getRedisClient } from "../infra/redis.js";
import { authConfig } from "../config/auth.js";
import { randomToken } from "../utils/secureRandom.js";
import { signAccessToken, verifyAccessToken } from "../utils/jwt.js";
import type { AccessTokenDecoded, Platform, UserRole } from "../types/auth.js";

// NOTE: This file focuses on token lifecycle. Higher-level orchestration (login/register/etc)
// happens in auth.service.ts.

const sha256Hex = (input: string) => createNodeHash("sha256").update(input).digest("hex");

type JwtKeyCache = {
  privateKey?: string;
  publicKeys?: string[];
};

const keyCache: JwtKeyCache = {};

async function loadKeyPemFromPath(filePath: string): Promise<string> {
  const pem = await readFile(filePath, "utf8");
  return pem;
}

async function getPrivateKeyPem(): Promise<string> {
  if (keyCache.privateKey) return keyCache.privateKey;

  const envPem = process.env.JWT_PRIVATE_KEY_PEM;
  if (envPem) {
    keyCache.privateKey = envPem;
    return envPem;
  }

  // Paths are required by env schema but may not exist in some local/test setups.
  // We keep failure messages explicit.
  const privatePath = process.env.JWT_PRIVATE_KEY_PATH;
  if (!privatePath) throw new Error("Missing JWT_PRIVATE_KEY_PATH");

  const pem = await loadKeyPemFromPath(privatePath);
  keyCache.privateKey = pem;
  return pem;
}

async function getPublicKeyPems(): Promise<string[]> {
  if (keyCache.publicKeys) return keyCache.publicKeys;

  const envPem = process.env.JWT_PUBLIC_KEY_PEM;
  if (envPem) {
    keyCache.publicKeys = [envPem];
  } else {
    const currentPath = process.env.JWT_PUBLIC_KEY_PATH;
    if (!currentPath) throw new Error("Missing JWT_PUBLIC_KEY_PATH");

    const list: string[] = [await loadKeyPemFromPath(currentPath)];

    const previousPublicPath = process.env.JWT_PUBLIC_KEY_PATH_PREVIOUS;
    if (previousPublicPath) {
      // Optional previous key for verification.
      list.push(await loadKeyPemFromPath(previousPublicPath));
    }

    keyCache.publicKeys = list;
  }

  return keyCache.publicKeys;
}

export const tokenService = {
  hashToken: (token: string) => sha256Hex(token),

  async signAccess(args: {
    userId: string;
    role: UserRole;
    planId: string | null;
    platform: Platform;
    sessionId: string; // stored as JWT jti and used to map back to refresh_tokens.id
    impersonates?: { sub: string }; // act claim: { sub: <admin_id> }
    ttlSeconds?: number;
  }): Promise<{ accessToken: string; expEpochSeconds: number }> {
    const privateKeyPem = await getPrivateKeyPem();
    const privateKey = privateKeyPem;
    const nowSeconds = Math.floor(Date.now() / 1000);
    const expSeconds = nowSeconds + (args.ttlSeconds ?? authConfig.accessTtlSeconds);

    const accessToken = await signAccessToken({
      privateKey: privateKey as any,
      kid: authConfig.jwt.kid,
      claims: {
        sub: args.userId,
        role: args.role,
        plan_id: args.planId,
        aud: args.platform,
        iss: authConfig.jwt.issuer,
        jti: args.sessionId,
        act: args.impersonates,
        iatEpochSeconds: nowSeconds,
        expEpochSeconds: expSeconds,
      },

    });

    await this.recordAccessJtiInIndex({ userId: args.userId, jti: args.sessionId, expEpochSeconds: expSeconds });

    return { accessToken, expEpochSeconds: expSeconds };
  },

  async verifyAccess(token: string, audience: Platform): Promise<AccessTokenDecoded> {
    const publicKeys = await getPublicKeyPems();
    return verifyAccessToken({
      token,
      publicKeys: publicKeys as any,
      issuer: authConfig.jwt.issuer,
      audience,
    });
  },

  async createRefreshTokenRow(args: {
    userId: string;
    familyId: string;
    tokenHash: string;
    platform: Platform;
    deviceName: string;
    fingerprint: string;
    ip: string | undefined;
    userAgent: string | undefined;
    deviceType: string;
    os: string | null;
    browser: string | null;
    appVersion: string | null;
  }): Promise<{ refreshRowId: string; expiresAtIso: string }> {
    const pool = getPool();
    const now = new Date();
    const expiresAt = new Date(Date.now() + authConfig.refreshTtlSeconds * 1000);

    const res = await pool.query(
      `
      INSERT INTO refresh_tokens (
        user_id,
        token_hash,
        family_id,
        platform,
        device_name,
        device_type,
        fingerprint,
        ip,
        user_agent,
        os,
        browser,
        app_version,
        issued_at,
        expires_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      RETURNING id, expires_at
    `,
      [
        args.userId,
        args.tokenHash,
        args.familyId,
        args.platform,
        args.deviceName,
        args.deviceType,
        args.fingerprint,
        args.ip ?? null,
        args.userAgent ?? null,
        args.os ?? null,
        args.browser ?? null,
        args.appVersion ?? null,
        now.toISOString(),
        expiresAt.toISOString(),
      ],
    );

    return { refreshRowId: res.rows[0].id, expiresAtIso: res.rows[0].expires_at };
  },

  async rotateRefreshToken(args: {
    refreshTokenRaw: string;
    platform: Platform; // should be x-platform from request
    deviceName: string;
    deviceType: string;
    ip: string | undefined;
    userAgent: string | undefined;
    fingerprint: string;
  }): Promise<{ accessToken: string; refreshToken: string; expiresIn: number; userId: string; role: UserRole; sessionId: string }> {
    const pool = getPool();
    const tokenHash = this.hashToken(args.refreshTokenRaw);

    const res = await retryQuery(
      `
      SELECT rt.*, u.role, u.id AS user_id
      FROM refresh_tokens rt
      JOIN users u ON u.id = rt.user_id
      WHERE rt.token_hash = $1
      ORDER BY rt.issued_at DESC
      LIMIT 1
    `,
      [tokenHash],
    );

    if (res.rowCount === 0) {
      // Unknown refresh token.
      const err = new Error("Refresh token not found");
      (err as any).code = "INVALID_TOKEN";
      throw err;
    }

    const row = res.rows[0] as any;
    const now = new Date();

    // Reuse detection.
    if (row.revoked_at) {
      await pool.query(`UPDATE refresh_tokens SET revoked_at = $1, revoke_reason = 'reuse_detected' WHERE family_id = $2 AND revoked_at IS NULL`, [
        now.toISOString(),
        row.family_id,
      ]);

      // Mass-blacklist active access JTIs for the user.
      await this.blacklistAllActiveUserJtis({ userId: row.user_id, reason: "reuse_detected" });

      const err = new Error("Refresh token reuse detected");
      (err as any).code = "TOKEN_REUSED";
      throw err;
    }

    // Normal rotation.
    const newFamilyId = row.family_id as string;
    const newRaw = randomToken(32);
    const newHash = this.hashToken(newRaw);

    // Keep metadata stable per device; overwrite if missing.
    const deviceName = row.device_name ?? args.deviceName;
    const platform = row.platform ?? args.platform;
    const deviceType = row.device_type ?? args.deviceType;
    const fingerprint = row.fingerprint ?? args.fingerprint;
    const ip = row.ip ?? args.ip ?? null;
    const userAgent = row.user_agent ?? args.userAgent ?? null;
    const os = row.os ?? null;
    const browser = row.browser ?? null;
    const appVersion = row.app_version ?? null;

    const inserted = await this.createRefreshTokenRow({
      userId: row.user_id,
      familyId: newFamilyId,
      tokenHash: newHash,
      platform,
      deviceName,
      fingerprint,
      ip: ip ?? undefined,
      userAgent: userAgent ?? undefined,
      deviceType,
      os,
      browser,
      appVersion,
    });

    await pool.query(
      `
      UPDATE refresh_tokens
      SET revoked_at = $1,
          revoke_reason = 'rotated',
          replaced_by_id = $2,
          last_used_at = $3
      WHERE id = $4
    `,
      [now.toISOString(), inserted.refreshRowId, now.toISOString(), row.id],
    );

    const { accessToken } = await this.signAccess({
      userId: row.user_id,
      role: row.role,
      planId: null,
      platform,
      sessionId: inserted.refreshRowId,
    });

    return {
      accessToken,
      refreshToken: newRaw,
      expiresIn: authConfig.accessTtlSeconds,
      userId: row.user_id,
      role: row.role,
      sessionId: inserted.refreshRowId,
    };
  },

  async isAccessJtiBlacklisted(args: { jti: string }): Promise<boolean> {
    const redis = await getRedisClient();
    if (redis) {
      try {
        const exists = await redis.exists(`auth:blacklist:${args.jti}`);
        if (exists === 1) return true;
      } catch {
        // ignore; fall back to Postgres
      }
    }

    const pool = getPool();
    const res = await pool.query(`SELECT 1 FROM token_blacklist WHERE jti = $1`, [args.jti]);
    return res.rowCount > 0;
  },

  async blacklistAccessJti(args: { userId: string; jti: string; expEpochSeconds: number; reason: string }): Promise<void> {
    const ttlSeconds = Math.max(0, args.expEpochSeconds - Math.floor(Date.now() / 1000));
    if (ttlSeconds === 0) return;

    const pool = getPool();
    const expIso = new Date(args.expEpochSeconds * 1000).toISOString();

    // Postgres mirror for cold-restart recovery.
    await pool.query(
      `
      INSERT INTO token_blacklist (jti, user_id, reason, expires_at, created_at)
      VALUES ($1,$2,$3,$4, now())
      ON CONFLICT (jti) DO NOTHING
    `,
      [args.jti, args.userId, args.reason, expIso],
    );

    // Hot-path Redis.
    const redis = await getRedisClient();
    if (redis) {
      try {
        await redis.set(`auth:blacklist:${args.jti}`, "1", { EX: ttlSeconds });
      } catch {
        // ignore
      }
    }
  },

  async blacklistAllActiveUserJtis(args: { userId: string; reason: string }): Promise<void> {
    // Best-effort: use redis jti index if present, else fall back to "blacklist current sessions via refresh_tokens".
    const redis = await getRedisClient();

    if (redis) {
      try {
        const jtis = await redis.sMembers(`auth:user_jtis:${args.userId}`);
        if (jtis.length) {
          // We store exp in `auth:jti:exp:{jti}` to compute TTL accurately.
          for (const jti of jtis) {
            const expSecondsRaw = await redis.get(`auth:jti:exp:${jti}`);
            const expEpochSeconds = expSecondsRaw ? Number(expSecondsRaw) : undefined;
            if (expEpochSeconds) {
              await this.blacklistAccessJti({ userId: args.userId, jti, expEpochSeconds, reason: args.reason });
            }
          }
          return;
        }
      } catch {
        // ignore fallback
      }
    }

    // Fallback: blacklist any currently active sessions by querying refresh_tokens.
    const pool = getPool();
    const sessions = await pool.query(`SELECT id FROM refresh_tokens WHERE user_id = $1 AND revoked_at IS NULL`, [args.userId]);
    for (const s of sessions.rows) {
      // Without access exp, we can’t compute precise TTL; store with a conservative remaining time of access TTL.
      const now = Math.floor(Date.now() / 1000);
      await this.blacklistAccessJti({ userId: args.userId, jti: s.id, expEpochSeconds: now + authConfig.accessTtlSeconds, reason: args.reason });
    }
  },

  async recordAccessJtiInIndex(args: { userId: string; jti: string; expEpochSeconds: number }): Promise<void> {
    const redis = await getRedisClient();
    if (!redis) return;

    try {
      const expSeconds = args.expEpochSeconds;
      await redis.sAdd(`auth:user_jtis:${args.userId}`, args.jti);
      await redis.set(`auth:jti:exp:${args.jti}`, String(expSeconds), { EX: Math.max(1, expSeconds - Math.floor(Date.now() / 1000)) });
    } catch {
      // ignore
    }
  },

  async revokeRefreshTokenById(args: { refreshId: string; reason: string }): Promise<void> {
    const pool = getPool();
    await pool.query(
      `
      UPDATE refresh_tokens
      SET revoked_at = now(), revoke_reason = $2
      WHERE id = $1 AND revoked_at IS NULL
    `,
      [args.refreshId, args.reason],
    );
  },

  async revokeAllRefreshTokensForUser(args: { userId: string; reason: string }): Promise<void> {
    const pool = getPool();
    await pool.query(`UPDATE refresh_tokens SET revoked_at = now(), revoke_reason = $2 WHERE user_id = $1 AND revoked_at IS NULL`, [
      args.userId,
      args.reason,
    ]);
  },
};

