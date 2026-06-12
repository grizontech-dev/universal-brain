import { createHash, randomUUID } from "crypto";
import { Router } from "express";
import { z } from "zod";

import { requireSuperadmin } from "../../gateway/admin.middleware.js";
import { ok } from "../../utils/response.js";
import { Errors } from "../../utils/errors.js";
import { getPool } from "../../db/pool.js";
import { tokenService } from "../../services/token.service.js";
import { sessionService } from "../../services/session.service.js";
import { auditService } from "../../services/audit.service.js";
import { authkeyTransactionalEmailMids } from "../../config/authkey.js";
import { mailerService } from "../../infra/mailer.js";
import { authEvents } from "../../events/auth.events.js";
import { randomToken } from "../../utils/secureRandom.js";
import { authConfig } from "../../config/auth.js";
import { fingerprintFromParts } from "../../utils/fingerprint.js";
import { oauthService } from "../../services/oauth.service.js";

const router = Router();

function parseOptionalUuid(value: unknown): string | undefined {
  if (typeof value !== "string" || !value) return undefined;
  return value;
}

function buildDeviceMetaFromReq(req: any) {
  const userAgent = req.headers["user-agent"] as string | undefined;
  const acceptLanguage = req.headers["accept-language"] as string | undefined;
  const ip = req.ip as string | undefined;
  const deviceName = (req.header("x-device-name") as string | undefined)?.trim() || "Unknown device";
  const deviceType = userAgent?.toLowerCase().includes("mobile") ? "mobile" : "desktop";
  const fingerprint = fingerprintFromParts({ userAgent: userAgent ?? "", ip, acceptLanguage });

  return {
    deviceName,
    deviceType,
    fingerprint,
    os: null,
    browser: null,
    appVersion: null,
    ip,
    userAgent,
  };
}

async function loadLinkedProvidersForUser(userId: string) {
  const pool = getPool();
  const providersRes = await pool.query(
    `
    SELECT provider, provider_email, linked_at
    FROM oauth_accounts
    WHERE user_id = $1 AND provider = 'google'
    ORDER BY linked_at DESC
  `,
    [userId],
  );
  return providersRes.rows.map((r: any) => ({
    provider: "google" as const,
    provider_email: r.provider_email,
    linked_at: r.linked_at,
  }));
}

async function loadAdminUser(userId: string) {
  const pool = getPool();
  const userRes = await pool.query(
    `
    SELECT
      u.id, u.email, u.name, u.bio, u.avatar_url, u.locale, u.timezone,
      u.role, u.status, u.email_verified_at, u.mfa_enabled,
      (u.password_hash IS NOT NULL) AS has_password,
      u.created_at, u.last_login_at,
      u.failed_login_attempts, u.locked_until,
      u.banned_at, u.ban_reason,
      u.last_login_ip
    FROM users u
    WHERE u.id = $1
    LIMIT 1
  `,
    [userId],
  );

  if (!userRes.rowCount) throw Errors.userNotFound();

  const u = userRes.rows[0] as any;
  const linked_providers = await loadLinkedProvidersForUser(userId);

  return {
    id: u.id,
    email: u.email,
    name: u.name,
    bio: u.bio,
    avatar_url: u.avatar_url,
    locale: u.locale,
    timezone: u.timezone,
    role: u.role,
    status: u.status,
    email_verified_at: u.email_verified_at,
    mfa_enabled: Boolean(u.mfa_enabled),
    has_password: Boolean(u.has_password),
    linked_providers,
    created_at: u.created_at,
    last_login_at: u.last_login_at,

    // Admin extensions
    failed_login_attempts: u.failed_login_attempts,
    locked_until: u.locked_until,
    banned_at: u.banned_at,
    ban_reason: u.ban_reason,
    last_login_ip: u.last_login_ip,
  };
}

router.get("/users", async (req, res, next) => {
  try {
    const schema = z.object({
      q: z.string().optional(),
      role: z.enum(["user", "admin", "superadmin"]).optional(),
      status: z.enum(["active", "banned", "suspended"]).optional(),
      created_after: z.string().datetime().optional(),
      created_before: z.string().datetime().optional(),
      page: z.coerce.number().int().min(1).default(1),
      page_size: z.coerce.number().int().min(1).max(200).default(25),
      sort: z.string().optional(),
    });
    const query = schema.safeParse(req.query);
    if (!query.success) throw Errors.validation(query.error.issues as any);
    const q = query.data.q;
    const page = query.data.page;
    const pageSize = query.data.page_size;
    const offset = (page - 1) * pageSize;

    const sort = query.data.sort ?? "created_at";
    const desc = sort.startsWith("-");
    const sortField = (desc ? sort.slice(1) : sort) as string;
    const sortSql =
      sortField === "last_login_at" || sortField === "email" || sortField === "created_at" ? `${sortField} ${desc ? "DESC" : "ASC"}` : "created_at ASC";

    const pool = getPool();

    const whereParts: string[] = [];
    const values: unknown[] = [];

    if (q) {
      values.push(`%${q}%`);
      whereParts.push(`(email ILIKE $${values.length} OR name ILIKE $${values.length})`);
    }
    if (query.data.role) {
      values.push(query.data.role);
      whereParts.push(`role = $${values.length}`);
    }
    if (query.data.status) {
      values.push(query.data.status);
      whereParts.push(`status = $${values.length}`);
    }
    if (query.data.created_after) {
      values.push(query.data.created_after);
      whereParts.push(`created_at >= $${values.length}`);
    }
    if (query.data.created_before) {
      values.push(query.data.created_before);
      whereParts.push(`created_at <= $${values.length}`);
    }

    const where = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";
    const countRes = await pool.query(`SELECT COUNT(*)::int AS total FROM users ${where}`, values);
    const total = countRes.rows[0]?.total ?? 0;

    const usersRes = await pool.query(
      `
        SELECT
          id,email,name,bio,avatar_url,locale,timezone,
          role,status,email_verified_at,mfa_enabled,
          (password_hash IS NOT NULL) AS has_password,
          created_at,last_login_at,
          failed_login_attempts,locked_until,banned_at,ban_reason,last_login_ip
        FROM users
        ${where}
        ORDER BY ${sortSql}
        LIMIT $${values.length + 1} OFFSET $${values.length + 2}
      `,
      [...values, pageSize, offset],
    );

    const users = await Promise.all(usersRes.rows.map((row: any) => loadAdminUser(row.id)));
    return ok(res, { users, page, page_size: pageSize, total }, `Loaded ${users.length} users.`);
  } catch (e) {
    next(e);
  }
});

router.get("/users/:id", async (req, res, next) => {
  try {
    const id = req.params.id;
    const user = await loadAdminUser(id);
    const pool = getPool();
    const activeSessionsRes = await pool.query(`SELECT COUNT(*)::int AS cnt FROM refresh_tokens WHERE user_id = $1 AND revoked_at IS NULL`, [id]);
    const active_sessions = activeSessionsRes.rows[0]?.cnt ?? 0;
    const recentAuditRes = await pool.query(
      `SELECT id, actor_id, event_type, ip, user_agent, fingerprint, success, metadata, created_at
       FROM auth_audit
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 20`,
      [id],
    );

    return ok(res, { user, active_sessions, active_api_keys: 0, recent_audit: recentAuditRes.rows }, "User loaded.");
  } catch (e) {
    next(e);
  }
});

router.patch("/users/:id", async (req, res, next) => {
  try {
    const targetId = req.params.id;
    const schema = z.object({
      name: z.string().min(1).max(60).optional(),
      bio: z.string().max(500).optional(),
      avatar_url: z.string().url().nullable().optional(),
      status: z.enum(["active", "suspended"]).optional(),
      role: z.enum(["user", "admin", "superadmin"]).optional(),
    });
    const bodyParsed = schema.safeParse(req.body);
    if (!bodyParsed.success) throw Errors.validation(bodyParsed.error.issues as any);

    const patch = bodyParsed.data;
    if (Object.keys(patch).length === 0) throw Errors.validation([{ path: "body", code: "INVALID_VALUE", message: "No fields provided." }] as any);

    const actorId = req.user!.id;
    const actorRole = req.user!.role;

    const pool = getPool();
    const targetRes = await pool.query(`SELECT role FROM users WHERE id = $1 LIMIT 1`, [targetId]);
    if (!targetRes.rowCount) throw Errors.userNotFound();
    const currentRole = targetRes.rows[0].role as string;

    if (patch.role && patch.role !== currentRole) {
      if (actorRole !== "superadmin") return next(Errors.superadminRequired());
      if (actorId === targetId) return next(Errors.cannotDemoteSelf());
    }

    const fieldsToUpdate: string[] = [];
    const values: unknown[] = [];
    const changedFields: Array<{ field: string; from: unknown; to: unknown }> = [];

    const fetchOld = async () => {
      const old = await pool.query(
        `SELECT name,bio,avatar_url,status,role FROM users WHERE id=$1 LIMIT 1`,
        [targetId],
      );
      return old.rows[0] as any;
    };
    const oldRow = await fetchOld();

    for (const [k, v] of Object.entries(patch)) {
      fieldsToUpdate.push(`${k} = $${values.length + 1}`);
      values.push(v);
      changedFields.push({ field: k, from: (oldRow as any)[k], to: v });
    }

    await pool.query(
      `UPDATE users SET ${fieldsToUpdate.join(", ")}, updated_at = now() WHERE id = $${values.length + 1}`,
      [...values, targetId],
    );

    // Role changes invalidate sessions (force-logout).
    if (patch.role && patch.role !== currentRole) {
      await pool.query(`UPDATE refresh_tokens SET revoked_at = now(), revoke_reason = 'role_change' WHERE user_id = $1 AND revoked_at IS NULL`, [
        targetId,
      ]);
      await tokenService.blacklistAllActiveUserJtis({ userId: targetId, reason: "role_change" });
    }

    for (const ch of changedFields) {
      await auditService.record({
        eventType: "admin_user_updated",
        userId: targetId,
        actorId,
        ip: req.ip ?? null,
        userAgent: req.headers["user-agent"]?.toString() ?? null,
        fingerprint: null,
        success: true,
        metadata: { field: ch.field, from: ch.from, to: ch.to },
      });
    }

    const updated = await loadAdminUser(targetId);
    return ok(res, updated, "User updated.");
  } catch (e) {
    next(e);
  }
});

router.post("/users/:id/ban", async (req, res, next) => {
  try {
    const targetId = req.params.id;
    const schema = z.object({ reason: z.string().min(1) });
    const body = parseBodySafe(schema, req.body, next);
    if (!body) return;

    const target = await loadAdminUser(targetId).catch(() => null);
    if (!target) return next(Errors.userNotFound());
    if (target.role === "superadmin" && req.user!.role !== "superadmin") return next(Errors.cannotBanSuperadmin());

    const pool = getPool();
    await pool.query(`UPDATE users SET status='banned', banned_at=now(), banned_by=$1, ban_reason=$2 WHERE id=$3`, [req.user!.id, body.reason, targetId]);
    await tokenService.revokeAllRefreshTokensForUser({ userId: targetId, reason: "ban" });
    await tokenService.blacklistAllActiveUserJtis({ userId: targetId, reason: "ban" });

    await auditService.record({ eventType: "admin_ban", userId: targetId, actorId: req.user!.id, success: true, metadata: { reason: body.reason }, ip: req.ip ?? null, userAgent: req.headers["user-agent"]?.toString() ?? null, fingerprint: null });
    authEvents.emit("auth.banned" as any, { userId: targetId, actorId: req.user!.id, reason: body.reason });

    const updated = await loadAdminUser(targetId);
    return ok(res, updated, "User banned.");
  } catch (e) {
    next(e);
  }
});

router.post("/users/:id/unban", async (req, res, next) => {
  try {
    const targetId = req.params.id;
    const pool = getPool();

    await pool.query(
      `UPDATE users SET status='active', banned_at=NULL, banned_by=NULL, ban_reason=NULL, updated_at=now() WHERE id=$1`,
      [targetId],
    );
    await auditService.record({ eventType: "admin_unban", userId: targetId, actorId: req.user!.id, success: true, metadata: {}, ip: req.ip ?? null, userAgent: req.headers["user-agent"]?.toString() ?? null, fingerprint: null });
    const updated = await loadAdminUser(targetId);
    return ok(res, updated, "User unbanned.");
  } catch (e) {
    next(e);
  }
});

router.post("/users/:id/force-logout", async (req, res, next) => {
  try {
    const targetId = req.params.id;
    const schema = z.object({ reason: z.string().optional() });
    const bodyParsed = schema.safeParse(req.body);
    if (!bodyParsed.success) return next(Errors.validation(bodyParsed.error.issues as any));
    const reason = bodyParsed.data.reason ?? "admin_force_logout";

    await tokenService.revokeAllRefreshTokensForUser({ userId: targetId, reason });
    await tokenService.blacklistAllActiveUserJtis({ userId: targetId, reason });

    await auditService.record({ eventType: "admin_force_logout", userId: targetId, actorId: req.user!.id, success: true, metadata: { reason }, ip: req.ip ?? null, userAgent: req.headers["user-agent"]?.toString() ?? null, fingerprint: null });

    return res.status(204).send();
  } catch (e) {
    next(e);
  }
});

router.post("/users/:id/reset-password", async (req, res, next) => {
  try {
    const targetId = req.params.id;
    const schema = z.object({ notify: z.boolean() });
    const body = schema.safeParse(req.body);
    if (!body.success) return next(Errors.validation(body.error.issues as any));

    const pool = getPool();
    const userRes = await pool.query(`SELECT email FROM users WHERE id=$1 LIMIT 1`, [targetId]);
    if (!userRes.rowCount) return next(Errors.userNotFound());
    const email = userRes.rows[0].email as string;

    const raw = randomToken(32);
    const hash = sha256Hex(raw);
    const expiresAtIso = new Date(Date.now() + 30 * 60 * 1000).toISOString();

    await pool.query(`INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1,$2,$3)`, [
      targetId,
      hash,
      expiresAtIso,
    ]);

    const link = `${process.env.PUBLIC_URL ?? ""}/reset-password?token=${encodeURIComponent(raw)}`;
    if (body.data.notify) {
      await mailerService.send({
        to: email,
        subject: "Reset your password",
        text: `Reset your password: ${link}`,
        authkeyMid: authkeyTransactionalEmailMids.passwordReset,
        authkeyParams: { link },
      });
    }

    await auditService.record({ eventType: "admin_reset_password", userId: targetId, actorId: req.user!.id, success: true, metadata: { notify: body.data.notify }, ip: req.ip ?? null, userAgent: req.headers["user-agent"]?.toString() ?? null, fingerprint: null });

    return ok(res, { ok: true, ...(body.data.notify ? {} : { link }) }, "Reset password link prepared.");
  } catch (e) {
    next(e);
  }
});

router.post("/users/:id/impersonate", requireSuperadmin, async (req, res, next) => {
  try {
    const targetId = req.params.id;
    const schema = z.object({ reason: z.string().min(10) });
    const body = schema.safeParse(req.body);
    if (!body.success) return next(Errors.reasonRequired());

    const targetUser = await loadAdminUser(targetId);
    if (targetUser.role === "superadmin") return next(Errors.impersonationNotAllowed());

    const meta = buildDeviceMetaFromReq(req);
    const familyId = randomUUID();
    const syntheticRefreshTokenRaw = randomToken(32);
    const syntheticHash = sha256Hex(syntheticRefreshTokenRaw);
    const now = new Date();
    const expAt = new Date(Date.now() + 5 * 60 * 1000);

    const pool = getPool();
    const refreshRes = await pool.query(
      `
      INSERT INTO refresh_tokens (
        user_id, token_hash, family_id,
        platform, device_name, device_type, fingerprint,
        ip, user_agent, os, browser, app_version,
        issued_at, expires_at, revoke_reason
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NULL)
      RETURNING id
    `,
      [
        targetId,
        syntheticHash,
        familyId,
        "admin",
        meta.deviceName,
        meta.deviceType,
        meta.fingerprint,
        meta.ip ?? null,
        meta.userAgent ?? null,
        meta.os,
        meta.browser,
        meta.appVersion,
        now.toISOString(),
        expAt.toISOString(),
      ],
    );

    const sessionId = refreshRes.rows[0].id as string;
    const access = await tokenService.signAccess({
      userId: targetId,
      role: targetUser.role as any,
      planId: null,
      platform: "admin",
      sessionId,
      impersonates: { sub: req.user!.id },
      ttlSeconds: 300,
    });

    await auditService.record({
      eventType: "admin_impersonate_start",
      userId: targetId,
      actorId: req.user!.id,
      success: true,
      ip: req.ip ?? null,
      userAgent: req.headers["user-agent"]?.toString() ?? null,
      fingerprint: meta.fingerprint,
      metadata: { reason: body.data.reason, jti: sessionId },
    });

    return ok(res, { access_token: access.accessToken, expires_in: 300, impersonates: { user_id: targetId, email: targetUser.email } }, "Impersonation token issued.");
  } catch (e) {
    next(e);
  }
});

router.get("/audit", async (req, res, next) => {
  try {
    const schema = z.object({
      user_id: z.string().optional(),
      actor_id: z.string().optional(),
      event_type: z.string().optional(),
      success: z.coerce.boolean().optional(),
      from: z.string().datetime().optional(),
      to: z.string().datetime().optional(),
      page: z.coerce.number().int().min(1).default(1),
      page_size: z.coerce.number().int().min(1).max(500).default(25),
    });
    const parsed = schema.safeParse(req.query);
    if (!parsed.success) throw Errors.validation(parsed.error.issues as any);

    const { page, page_size, user_id, actor_id, event_type, success, from, to } = parsed.data;
    const offset = (page - 1) * page_size;
    const pool = getPool();

    const where: string[] = [];
    const values: unknown[] = [];

    if (user_id) {
      values.push(user_id);
      where.push(`user_id = $${values.length}`);
    }
    if (actor_id) {
      values.push(actor_id);
      where.push(`actor_id = $${values.length}`);
    }
    if (event_type) {
      const types = event_type.split(",").map((t) => t.trim()).filter(Boolean);
      if (types.length) {
        values.push(types);
        where.push(`event_type = ANY($${values.length}::text[])`);
      }
    }
    if (success !== undefined) {
      values.push(success);
      where.push(`success = $${values.length}`);
    }
    if (from) {
      values.push(from);
      where.push(`created_at >= $${values.length}`);
    }
    if (to) {
      values.push(to);
      where.push(`created_at <= $${values.length}`);
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const countRes = await pool.query(`SELECT COUNT(*)::int AS total FROM auth_audit ${whereSql}`, values);
    const total = countRes.rows[0]?.total ?? 0;

    const eventsRes = await pool.query(
      `
      SELECT id, user_id, actor_id, event_type, ip, user_agent, fingerprint, success, metadata, created_at
      FROM auth_audit
      ${whereSql}
      ORDER BY created_at DESC
      LIMIT $${values.length + 1} OFFSET $${values.length + 2}
    `,
      [...values, page_size, offset],
    );

    return ok(res, { events: eventsRes.rows, page, page_size, total }, "Audit loaded.");
  } catch (e) {
    next(e);
  }
});

router.get("/sessions", async (req, res, next) => {
  try {
    const schema = z.object({
      user_id: z.string().optional(),
      platform: z.enum(["web", "admin", "mobile-ios", "mobile-android"]).optional(),
      ip: z.string().optional(),
      fingerprint: z.string().optional(),
      issued_after: z.string().datetime().optional(),
      page: z.coerce.number().int().min(1).default(1),
      page_size: z.coerce.number().int().min(1).max(500).default(25),
    });
    const parsed = schema.safeParse(req.query);
    if (!parsed.success) throw Errors.validation(parsed.error.issues as any);

    const { page, page_size, user_id, platform, ip, fingerprint, issued_after } = parsed.data;
    const offset = (page - 1) * page_size;
    const pool = getPool();

    const where: string[] = [];
    const values: unknown[] = [];

    if (user_id) {
      values.push(user_id);
      where.push(`rt.user_id = $${values.length}`);
    }
    if (platform) {
      values.push(platform);
      where.push(`rt.platform = $${values.length}`);
    }
    if (ip) {
      values.push(ip);
      where.push(`rt.ip::text LIKE $${values.length}`);
    }
    if (fingerprint) {
      values.push(fingerprint);
      where.push(`rt.fingerprint = $${values.length}`);
    }
    if (issued_after) {
      values.push(issued_after);
      where.push(`rt.issued_at >= $${values.length}`);
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const countRes = await pool.query(
      `SELECT COUNT(*)::int AS total
       FROM refresh_tokens rt
       ${whereSql}`,
      values,
    );
    const total = countRes.rows[0]?.total ?? 0;

    const sessionsRes = await pool.query(
      `
      SELECT
        rt.id, rt.user_id, u.email AS user_email,
        rt.platform, rt.device_name, rt.device_type,
        rt.os, rt.browser, rt.app_version,
        rt.ip, rt.fingerprint,
        rt.issued_at, rt.last_used_at, rt.expires_at
      FROM refresh_tokens rt
      JOIN users u ON u.id = rt.user_id
      WHERE rt.revoked_at IS NULL
      ${where.length ? `AND ${where.map((w) => w.replace(/^rt\./, "rt.")).join(" AND ")}` : ""}
      ORDER BY rt.last_used_at DESC NULLS LAST, rt.issued_at DESC
      LIMIT $${values.length + 1} OFFSET $${values.length + 2}
    `,
      [...values, page_size, offset],
    );

    return ok(
      res,
      {
        sessions: sessionsRes.rows.map((rt: any) => ({
          id: rt.id,
          user_id: rt.user_id,
          user_email: rt.user_email,
          platform: rt.platform,
          device_name: rt.device_name,
          device_type: rt.device_type,
          os: rt.os,
          browser: rt.browser,
          app_version: rt.app_version,
          ip: rt.ip ? String(rt.ip) : null,
          country: null,
          city: null,
          issued_at: rt.issued_at,
          last_used_at: rt.last_used_at,
          expires_at: rt.expires_at,
        })),
        page,
        page_size,
        total,
      },
      "Sessions loaded.",
    );
  } catch (e) {
    next(e);
  }
});

router.delete("/sessions/:id", async (req, res, next) => {
  try {
    const sessionId = req.params.id;
    const schema = z.object({ reason: z.string().optional() });
    const bodyParsed = schema.safeParse(req.body);
    if (!bodyParsed.success) return next(Errors.validation(bodyParsed.error.issues as any));
    const reason = bodyParsed.data.reason ?? "admin_session_revoked";

    const pool = getPool();
    const targetRes = await pool.query(`SELECT user_id FROM refresh_tokens WHERE id=$1 AND revoked_at IS NULL LIMIT 1`, [sessionId]);
    if (!targetRes.rowCount) return next(Errors.notFound("Session"));

    const userId = targetRes.rows[0].user_id as string;

    await pool.query(`UPDATE refresh_tokens SET revoked_at = now(), revoke_reason = $2 WHERE id=$1 AND revoked_at IS NULL`, [sessionId, reason]);

    // Best-effort: compute access token exp from redis index if present.
    const redis = await import("../../infra/redis.js").then((m) => m.getRedisClient());
    let expEpochSeconds = Math.floor(Date.now() / 1000) + authConfig.accessTtlSeconds;
    if (redis) {
      try {
        const expRaw = await redis.get(`auth:jti:exp:${sessionId}`);
        if (expRaw) expEpochSeconds = Number(expRaw);
      } catch {
        // ignore
      }
    }

    await tokenService.blacklistAccessJti({ userId, jti: sessionId, expEpochSeconds, reason });

    await auditService.record({
      eventType: "admin_session_revoked",
      userId,
      actorId: req.user!.id,
      success: true,
      metadata: { reason },
      ip: req.ip ?? null,
      userAgent: req.headers["user-agent"]?.toString() ?? null,
      fingerprint: null,
    });

    return res.status(204).send();
  } catch (e) {
    next(e);
  }
});

function parseBodySafe<T>(schema: z.ZodType<T>, body: unknown, next: (err?: unknown) => void): T | null {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    next(Errors.validation(parsed.error.issues as any));
    return null;
  }
  return parsed.data;
}

function sha256Hex(input: string) {
  // Simple hash helper for reset-link token storage.
  // We keep it local to this route to avoid extra cross-module deps.
  return createHash("sha256").update(input).digest("hex");
}

export const authRoutes = router;

