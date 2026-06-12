import { createHash, randomUUID } from "crypto";
import { getPool } from "../db/pool.js";
import { authConfig } from "../config/auth.js";
import type { Platform, UserRole } from "../types/auth.js";
import { tokenService } from "./token.service.js";
import { passwordService } from "./password.service.js";
import { auditService } from "./audit.service.js";
import { profileService } from "./profile.service.js";
import { sessionService } from "./session.service.js";
import { oauthService } from "./oauth.service.js";
import { authkeyTransactionalEmailMids } from "../config/authkey.js";
import { mailerService } from "../infra/mailer.js";
import { authEvents } from "../events/auth.events.js";
import { fingerprintFromParts } from "../utils/fingerprint.js";
import { randomToken } from "../utils/secureRandom.js";
import { Errors } from "../utils/errors.js";
import { subscriptionService } from "./subscription.service.js";
import { walletService } from "./wallet.service.js";

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function isPasswordStrong(plain: string): boolean {
  // Contract: min 10 chars + contains letter + number.
  return plain.length >= 10 && /[A-Za-z]/.test(plain) && /\d/.test(plain);
}

function deriveDeviceType(userAgent: string | undefined): "desktop" | "mobile" | "tablet" | "unknown" {
  if (!userAgent) return "unknown";
  const ua = userAgent.toLowerCase();
  if (ua.includes("ipad") || ua.includes("tablet")) return "tablet";
  if (ua.includes("mobile") || ua.includes("android") || ua.includes("iphone")) return "mobile";
  return "desktop";
}

type DeviceContext = {
  platform: Platform;
  deviceName: string;
  fingerprint: string;
  deviceType: string;
  os: string | null;
  browser: string | null;
  appVersion: string | null;
  ip: string | undefined;
  userAgent: string | undefined;
};

function buildDeviceContext(args: {
  platform: Platform;
  deviceName?: string;
  userAgent?: string;
  acceptLanguage?: string;
  ip?: string;
  deviceType?: string;
}): DeviceContext {
  const ua = args.userAgent ?? "";
  const fingerprint = fingerprintFromParts({
    userAgent: ua,
    ip: args.ip,
    acceptLanguage: args.acceptLanguage,
  });

  return {
    platform: args.platform,
    deviceName: args.deviceName?.trim() || "Unknown device",
    fingerprint,
    deviceType: args.deviceType ?? deriveDeviceType(args.userAgent),
    os: null,
    browser: null,
    appVersion: null,
    ip: args.ip,
    userAgent: args.userAgent,
  };
}

async function loadUserMinimalById(userId: string) {
  const pool = getPool();
  const res = await pool.query(
    `
    SELECT id,email,name,bio,avatar_url,role,status,email_verified_at,mfa_enabled,password_hash IS NOT NULL AS has_password,
           created_at,last_login_at
    FROM users
    WHERE id = $1
  `,
    [userId],
  );
  if (!res.rowCount) throw Errors.notFound("User");
  return res.rows[0] as any;
}

async function issueTokensForUserSession(args: {
  userId: string;
  role: UserRole;
  device: DeviceContext;
  via: "password" | "google";
}): Promise<{ user: any; access_token: string; refresh_token: string; expires_in: number; sessionId: string }> {
  const pool = getPool();
  const familyId = randomUUID();
  const refreshTokenRaw = randomToken(32);
  const tokenHash = tokenService.hashToken(refreshTokenRaw);

  const inserted = await tokenService.createRefreshTokenRow({
    userId: args.userId,
    familyId,
    tokenHash,
    platform: args.device.platform,
    deviceName: args.device.deviceName,
    fingerprint: args.device.fingerprint,
    deviceType: args.device.deviceType,
    ip: args.device.ip,
    userAgent: args.device.userAgent,
    os: args.device.os,
    browser: args.device.browser,
    appVersion: args.device.appVersion,
  });

  // Create access token with jti == refresh_tokens.id so middleware can map jti->session.
  const { accessToken } = await tokenService.signAccess({
    userId: args.userId,
    role: args.role,
    planId: null,
    platform: args.device.platform,
    sessionId: inserted.refreshRowId,
  });

  const user = await profileService.getMe(args.userId);

  return {
    user,
    access_token: accessToken,
    refresh_token: refreshTokenRaw,
    expires_in: authConfig.accessTtlSeconds,
    sessionId: inserted.refreshRowId,
  };
}

// In-memory rate limiters for Phase 1 (tests/dev). In production, these should use Redis.
const emailCheckRate = new Map<string, { windowStart: number; count: number }>();
const emailCheckEmailRate = new Map<string, { windowStart: number; count: number }>();
const emailCheckCaptcha429 = new Map<string, { windowStart: number; count: number }>();
const emailVerifyRequestRate = new Map<string, { windowStart: number; count: number }>();
const passwordForgotEmailRate = new Map<string, { windowStart: number; count: number }>();
const passwordForgotIpRate = new Map<string, { windowStart: number; count: number }>();

function hitCounter(map: Map<string, { windowStart: number; count: number }>, key: string, windowMs: number): number {
  const now = Date.now();
  const current = map.get(key);
  if (!current || now - current.windowStart > windowMs) {
    map.set(key, { windowStart: now, count: 1 });
    return 1;
  }
  const next = { ...current, count: current.count + 1 };
  map.set(key, next);
  return next.count;
}

export const authService = {
  async checkEmail(args: { email: string; captchaToken?: string; ip?: string; platform: Platform; device: DeviceContext }) {
    const pool = getPool();
    const emailNorm = normalizeEmail(args.email);
    const emailHash = sha256Hex(emailNorm);

    // Validate email early for the contract.
    const emailLooksValid = /^\S+@\S+\.\S+$/.test(emailNorm);
    if (!emailLooksValid) throw Errors.invalidEmail();

    const ip = args.ip ?? "unknown";
    const ipMinuteCount = hitCounter(emailCheckRate, `ip:${ip}:min`, 60 * 1000);
    const ipHourCount = hitCounter(emailCheckRate, `ip:${ip}:hour`, 60 * 60 * 1000);
    const emailHourCount = hitCounter(emailCheckEmailRate, `email:${emailNorm}:hour`, 60 * 60 * 1000);

    const ipExceeded = ipMinuteCount > authConfig.emailCheckRateLimits.ipPerMinute || ipHourCount > authConfig.emailCheckRateLimits.ipPerHour;
    const emailExceeded = emailHourCount > authConfig.emailCheckRateLimits.emailPerHour;

    if (ipExceeded || emailExceeded) {
      const captchaKey = `ip:${ip}`;
      const captcha429Count = hitCounter(emailCheckCaptcha429, captchaKey, authConfig.captcha.requireAfterEmailCheck429WindowSeconds * 1000);

      if (!args.captchaToken) {
        // After the configured 429 streak, require captcha token.
        if (captcha429Count >= authConfig.captcha.requireAfterEmailCheck429Count) throw Errors.captchaRequired();
        throw Errors.tooManyRequests();
      }
      // Captcha provided: proceed (no further gating).
    }

    const res = await pool.query(
      `
      SELECT id, password_hash, status
      FROM users
      WHERE email_normalised = $1
      LIMIT 1
    `,
      [emailNorm],
    );

    // Always returns 200; banned users pretend not to exist.
    const user = res.rowCount ? (res.rows[0] as any) : null;
    const isBanned = user?.status === "banned";

    const oauthRes = await pool.query(
      `
      SELECT 1
      FROM oauth_accounts
      WHERE user_id = $1 AND provider = 'google'
      LIMIT 1
    `,
      [user?.id ?? null],
    );
    const has_google = !isBanned && Boolean(oauthRes.rowCount);
    const has_password = !isBanned && Boolean(user?.password_hash);

    const exists = !isBanned && Boolean(user?.id);
    const suggested_action = !exists
      ? "register"
      : has_password
        ? "login"
        : has_google
          ? "login_with_google"
          : "register";

    await auditService.record({
      eventType: "email_check",
      userId: exists ? user!.id : null,
      ip: args.ip ?? null,
      userAgent: args.device.userAgent ?? null,
      fingerprint: args.device.fingerprint,
      actorId: null,
      success: true,
      metadata: { email_hash: emailHash, suggested_action },
    });

    authEvents.emit("auth.email_check" as any, { emailHash, ip, suggestedAction: suggested_action });

    return { exists, has_password, has_google, suggested_action };
  },

  async register(args: {
    email: string;
    password: string;
    name: string;
    bio?: string;
    locale?: string;
    timezone?: string;
    device: DeviceContext;
  }) {
    const pool = getPool();
    const emailNorm = normalizeEmail(args.email);

    if (!isPasswordStrong(args.password)) throw Errors.passwordTooWeak();

    const password_hash = await passwordService.hash(args.password);

    const nowIso = new Date().toISOString();

    let userId: string;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const res = await client.query(
        `
        INSERT INTO users (
          email, email_normalised, password_hash,
          role, status,
          name, bio, avatar_url,
          locale, timezone,
          registration_platform,
          created_at, updated_at
        )
        VALUES ($1,$2,$3,'user','active',$4,$5,NULL,$6,$7,$8,$9,$10)
        RETURNING id
      `,
        [args.email, emailNorm, password_hash, args.name, args.bio ?? null, args.locale ?? null, args.timezone ?? null, args.device.platform, nowIso, nowIso],
      );

      userId = res.rows[0].id as string;
      await subscriptionService.assignFreePlan(userId, { client, deferGrants: true });
      await client.query("COMMIT");
    } catch (e: any) {
      await client.query("ROLLBACK");
      if (e && typeof e.code === "string" && e.code === "23505") {
        throw Errors.emailTaken();
      }
      throw e;
    } finally {
      client.release();
    }

    await walletService.createForUser(userId);
    await subscriptionService.ensureGrantsForUser(userId);

    // Create email verification token and send.
    const verifyTokenRaw = randomToken(32);
    const verifyTokenHash = sha256Hex(verifyTokenRaw);
    const expiresAtIso = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    await pool.query(
      `
        INSERT INTO email_verification_tokens (user_id, token_hash, expires_at)
        VALUES ($1,$2,$3)
      `,
      [userId, verifyTokenHash, expiresAtIso],
    );

    const verifyLink = `${process.env.PUBLIC_URL ?? ""}/verify?token=${encodeURIComponent(verifyTokenRaw)}`;
    await mailerService.send({
      to: args.email,
      subject: "Verify your email",
      text: `Verify your email: ${verifyLink}`,
      authkeyMid: authkeyTransactionalEmailMids.emailVerify,
      authkeyParams: { link: verifyLink },
    });

    await auditService.record({
      eventType: "register",
      userId,
      actorId: null,
      ip: args.device.ip ?? null,
      userAgent: args.device.userAgent ?? null,
      fingerprint: args.device.fingerprint,
      success: true,
      metadata: { via: "password" },
    });

    authEvents.emit("auth.registered" as any, {
      userId,
      email: args.email,
      platform: args.device.platform,
      ip: args.device.ip ?? "unknown",
      via: "password",
    });

    const tokenBundle = await issueTokensForUserSession({
      userId,
      role: "user",
      device: args.device,
      via: "password",
    });

    return {
      user: tokenBundle.user,
      access_token: tokenBundle.access_token,
      refresh_token: tokenBundle.refresh_token,
      expires_in: tokenBundle.expires_in,
    };
  },

  async login(args: {
    email: string;
    password: string;
    device: DeviceContext;
  }) {
    const pool = getPool();
    const emailNorm = normalizeEmail(args.email);
    const now = new Date();
    const userRes = await pool.query(`SELECT * FROM users WHERE email_normalised = $1 LIMIT 1`, [emailNorm]);

    if (!userRes.rowCount) {
      throw Errors.invalidCredentials();
    }

    const user = userRes.rows[0] as any;
    if (user.status === "banned") throw Errors.userBanned();

    if (user.locked_until && new Date(user.locked_until).getTime() > now.getTime()) {
      throw Errors.accountLocked(new Date(user.locked_until).toISOString());
    }

    // Verify password.
    const passwordHash: string | null = user.password_hash ?? null;
    if (!passwordHash) throw Errors.invalidCredentials();

    const ok = await passwordService.verify(args.password, passwordHash);
    if (!ok) {
      const newFailedCount = Number(user.failed_login_attempts ?? 0) + 1;

      // If the user just crossed the threshold, set locked_until.
      const shouldLock = newFailedCount >= authConfig.lockoutPolicy.failedLoginThreshold;

      let lockUntilIso: string | null = null;
      if (shouldLock) {
        const recentLockRes = await pool.query(
          `
          SELECT COUNT(*)::int AS cnt
          FROM auth_audit
          WHERE user_id = $1 AND event_type = 'account_locked' AND created_at > now() - ($2 * interval '1 second')
        `,
          [user.id, authConfig.lockoutPolicy.doublingWindowSeconds],
        );

        const cnt = recentLockRes.rows[0]?.cnt ?? 0;
        const multiplier = Math.pow(2, Math.min(cnt, 2)); // base*2^0, base*2^1, base*2^2
        const lockSeconds = Math.min(authConfig.lockoutPolicy.baseLockoutSeconds * multiplier, authConfig.lockoutPolicy.maxLockoutSeconds);
        const lockUntil = new Date(Date.now() + lockSeconds * 1000);
        lockUntilIso = lockUntil.toISOString();
        await auditService.record({
          eventType: "account_locked",
          userId: user.id,
          actorId: null,
          ip: args.device.ip ?? null,
          userAgent: args.device.userAgent ?? null,
          fingerprint: args.device.fingerprint,
          success: false,
          metadata: { locked_until: lockUntilIso },
        });
      }

      await pool.query(
        `UPDATE users SET failed_login_attempts = $1, locked_until = $2 WHERE id = $3`,
        [newFailedCount, lockUntilIso, user.id],
      );

      await auditService.record({
        eventType: "login_failed",
        userId: user.id,
        actorId: null,
        ip: args.device.ip ?? null,
        userAgent: args.device.userAgent ?? null,
        fingerprint: args.device.fingerprint,
        success: false,
        metadata: { failed_login_attempts: newFailedCount },
      });

      if (lockUntilIso) {
        throw Errors.accountLocked(lockUntilIso);
      }

      throw Errors.invalidCredentials();
    }

    // Success: reset counters.
    await pool.query(
      `
      UPDATE users
      SET failed_login_attempts = 0,
          locked_until = NULL,
          last_login_at = now(),
          last_login_ip = $1,
          updated_at = now()
      WHERE id = $2
    `,
      [args.device.ip ?? null, user.id],
    );

    // Determine "new device" for audit event.
    const fpRes = await pool.query(
      `SELECT 1 FROM refresh_tokens WHERE user_id = $1 AND fingerprint = $2 AND revoked_at IS NULL LIMIT 1`,
      [user.id, args.device.fingerprint],
    );
    const isNewDevice = fpRes.rowCount === 0;

    const tokenBundle = await issueTokensForUserSession({
      userId: user.id,
      role: user.role as UserRole,
      device: args.device,
      via: "password",
    });

    await auditService.record({
      eventType: isNewDevice ? "login_new_device" : "login",
      userId: user.id,
      actorId: null,
      ip: args.device.ip ?? null,
      userAgent: args.device.userAgent ?? null,
      fingerprint: args.device.fingerprint,
      success: true,
      metadata: { via: "password", is_new_device: isNewDevice },
    });

    return {
      user: tokenBundle.user,
      access_token: tokenBundle.access_token,
      refresh_token: tokenBundle.refresh_token,
      expires_in: tokenBundle.expires_in,
    };
  },

  async google(args: {
    id_token: string;
    name?: string;
    timezone?: string;
    locale?: string;
    device: DeviceContext;
  }) {
    const { userId, outcome, userWasBanned, providerEmail } = await oauthService.signInOrLinkByGoogleToken({
      idToken: args.id_token,
      platform: args.device.platform,
      nameOverride: args.name,
      timezone: args.timezone,
      locale: args.locale,
    });

    if (userWasBanned) throw Errors.userBanned();

    if (outcome === "registered") {
      await subscriptionService.assignFreePlan(userId);
    }

    const pool = getPool();
    const userRes = await pool.query(`SELECT role FROM users WHERE id = $1 LIMIT 1`, [userId]);
    const role = (userRes.rows[0].role ?? "user") as UserRole;

    const tokenBundle = await issueTokensForUserSession({
      userId,
      role,
      device: args.device,
      via: "google",
    });

    await auditService.record({
      eventType: outcome === "registered" ? "register_google" : "login_google",
      userId,
      actorId: null,
      ip: args.device.ip ?? null,
      userAgent: args.device.userAgent ?? null,
      fingerprint: args.device.fingerprint,
      success: true,
      metadata: { outcome, provider_email: providerEmail },
    });

    return {
      user: tokenBundle.user,
      access_token: tokenBundle.access_token,
      refresh_token: tokenBundle.refresh_token,
      expires_in: tokenBundle.expires_in,
      outcome,
    };
  },

  async refresh(args: {
    refresh_token: string;
    device: { platform: Platform; deviceName: string; deviceType: string; ip?: string; userAgent?: string; fingerprint: string };
  }) {
    try {
      const res = await tokenService.rotateRefreshToken({
        refreshTokenRaw: args.refresh_token,
        platform: args.device.platform,
        deviceName: args.device.deviceName,
        deviceType: args.device.deviceType,
        ip: args.device.ip,
        userAgent: args.device.userAgent,
        fingerprint: args.device.fingerprint,
      });

      await auditService.record({
        eventType: "refresh",
        userId: res.userId,
        actorId: null,
        ip: args.device.ip ?? null,
        userAgent: args.device.userAgent ?? null,
        fingerprint: args.device.fingerprint,
        success: true,
        metadata: {},
      });

      return {
        access_token: res.accessToken,
        refresh_token: res.refreshToken,
        expires_in: authConfig.accessTtlSeconds,
      };
    } catch (e: any) {
      if (e?.code === "TOKEN_REUSED") {
        throw Errors.tokenReused();
      }
      if (e?.code === "INVALID_TOKEN") {
        throw Errors.invalidToken();
      }
      if (e?.message?.includes("reused")) {
        throw Errors.tokenReused();
      }
      throw e;
    }
  },

  async logout(args: {
    userId: string;
    refresh_token: string;
    currentSessionId: string;
    tokenExpEpochSeconds: number;
  }) {
    const pool = getPool();
    const refreshHash = tokenService.hashToken(args.refresh_token);

    // Revoke the refresh token row if it matches this user+session.
    await pool.query(
      `
      UPDATE refresh_tokens
      SET revoked_at = now(), revoke_reason = 'logout'
      WHERE id = $1 AND user_id = $2 AND token_hash = $3 AND revoked_at IS NULL
    `,
      [args.currentSessionId, args.userId, refreshHash],
    );

    // Blacklist the access token JTI (jti == session id).
    await tokenService.blacklistAccessJti({
      userId: args.userId,
      jti: args.currentSessionId,
      expEpochSeconds: args.tokenExpEpochSeconds,
      reason: "logout",
    });

    await auditService.record({
      eventType: "logout",
      userId: args.userId,
      actorId: null,
      success: true,
      ip: null,
      userAgent: null,
      fingerprint: null,
      metadata: { session_id: args.currentSessionId },
    });
  },

  async logoutAll(args: { userId: string; tokenExpEpochSeconds: number }) {
    // Revoke all refresh tokens for user.
    await tokenService.revokeAllRefreshTokensForUser({ userId: args.userId, reason: "logout_all" });
    // Blacklist all active access tokens for user (best-effort TTLs from redis index).
    await tokenService.blacklistAllActiveUserJtis({ userId: args.userId, reason: "logout_all" });

    const countRes = await getPool().query(
      `SELECT COUNT(*)::int AS cnt FROM refresh_tokens WHERE user_id = $1 AND revoked_at IS NULL`,
      [args.userId],
    );
    await auditService.record({ eventType: "logout_all", userId: args.userId, actorId: null, success: true, metadata: { count: countRes.rows[0]?.cnt ?? 0 } });
  },

  async changePassword(args: {
    userId: string;
    current_password: string;
    new_password: string;
    device: DeviceContext;
    sessionId: string;
  }) {
    const pool = getPool();
    if (!isPasswordStrong(args.new_password)) throw Errors.passwordTooWeak();

    const userRes = await pool.query(`SELECT password_hash, role, status FROM users WHERE id = $1 LIMIT 1`, [args.userId]);
    if (!userRes.rowCount) throw Errors.userNotFound();
    const passwordHash = userRes.rows[0].password_hash as string | null;
    if (!passwordHash) throw Errors.invalidCurrentPassword();

    const ok = await passwordService.verify(args.current_password, passwordHash);
    if (!ok) {
      throw Errors.invalidCurrentPassword();
    }

    const newHash = await passwordService.hash(args.new_password);
    await pool.query(
      `UPDATE users SET password_hash = $1, password_changed_at = now(), failed_login_attempts = 0, locked_until = NULL WHERE id = $2`,
      [newHash, args.userId],
    );

    // Revoke all sessions and blacklist active tokens.
    await tokenService.revokeAllRefreshTokensForUser({ userId: args.userId, reason: "password_changed" });
    await tokenService.blacklistAllActiveUserJtis({ userId: args.userId, reason: "password_changed" });

    const tokenBundle = await issueTokensForUserSession({
      userId: args.userId,
      role: userRes.rows[0].role as UserRole,
      device: args.device,
      via: "password",
    });

    await auditService.record({
      eventType: "password_changed",
      userId: args.userId,
      actorId: null,
      success: true,
      metadata: {},
    });

    return { access_token: tokenBundle.access_token, refresh_token: tokenBundle.refresh_token, expires_in: tokenBundle.expires_in };
  },

  async forgotPassword(args: { email: string; ip?: string; platform: Platform; userAgent?: string; acceptLanguage?: string; deviceName?: string; deviceType?: string }) {
    const pool = getPool();
    const emailNorm = normalizeEmail(args.email);

    // Rate limit (per email + per IP) per contract: 3 / hour per email + 10 / hour per IP.
    const emailKey = `email:${emailNorm}`;
    const ipKey = `ip:${args.ip ?? "unknown"}`;
    const emailCount = hitCounter(passwordForgotEmailRate, emailKey, 60 * 60 * 1000);
    const ipCount = hitCounter(passwordForgotIpRate, ipKey, 60 * 60 * 1000);
    if (emailCount > 3 || ipCount > 10) {
      // Contract says silent drop with 200 ok true (no enumeration).
      return { ok: true };
    }

    const userRes = await pool.query(`SELECT id, email FROM users WHERE email_normalised = $1 LIMIT 1`, [emailNorm]);
    if (!userRes.rowCount) return { ok: true };

    const userId = userRes.rows[0].id as string;
    const device: DeviceContext = buildDeviceContext({
      platform: args.platform,
      deviceName: args.deviceName,
      userAgent: args.userAgent,
      acceptLanguage: args.acceptLanguage,
      ip: args.ip,
      deviceType: args.deviceType,
    });

    // Generate reset token and store hash.
    const resetTokenRaw = randomToken(32);
    const tokenHash = sha256Hex(resetTokenRaw);
    const expiresAtIso = new Date(Date.now() + 30 * 60 * 1000).toISOString();

    await pool.query(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, ip) VALUES ($1,$2,$3,$4)`,
      [userId, tokenHash, expiresAtIso, args.ip ?? null],
    );

    const resetLink = `${process.env.PUBLIC_URL ?? ""}/reset-password?token=${encodeURIComponent(resetTokenRaw)}`;
    await mailerService.send({
      to: userRes.rows[0].email,
      subject: "Reset your password",
      text: `Reset your password: ${resetLink}`,
      authkeyMid: authkeyTransactionalEmailMids.passwordReset,
      authkeyParams: { link: resetLink },
    });

    await auditService.record({
      eventType: "password_reset_requested",
      userId,
      actorId: null,
      success: true,
      ip: args.ip ?? null,
      userAgent: args.userAgent ?? null,
      fingerprint: device.fingerprint,
      metadata: {},
    });

    return { ok: true };
  },

  async resetPassword(args: { token: string; new_password: string; platform: Platform; ip?: string; userAgent?: string; acceptLanguage?: string; deviceName?: string; deviceType?: string }) {
    const pool = getPool();
    if (!isPasswordStrong(args.new_password)) throw Errors.passwordTooWeak();

    const tokenHash = sha256Hex(args.token);
    const now = new Date();
    const res = await pool.query(
      `
      SELECT prt.user_id, prt.expires_at, prt.used_at
      FROM password_reset_tokens prt
      WHERE prt.token_hash = $1
      LIMIT 1
    `,
      [tokenHash],
    );

    if (!res.rowCount) throw Errors.invalidOrExpiredToken();
    const row = res.rows[0] as any;
    if (row.used_at) throw Errors.invalidOrExpiredToken();
    if (new Date(row.expires_at).getTime() < now.getTime()) throw Errors.invalidOrExpiredToken();

    const newHash = await passwordService.hash(args.new_password);
    await pool.query(
      `UPDATE users SET password_hash = $1, password_changed_at = now(), failed_login_attempts = 0, locked_until = NULL WHERE id = $2`,
      [newHash, row.user_id],
    );
    await pool.query(`UPDATE password_reset_tokens SET used_at = now() WHERE token_hash = $1`, [tokenHash]);

    // Revoke all sessions and blacklist active access tokens.
    await tokenService.revokeAllRefreshTokensForUser({ userId: row.user_id, reason: "password_reset_completed" });
    await tokenService.blacklistAllActiveUserJtis({ userId: row.user_id, reason: "password_reset_completed" });

    const device: DeviceContext = buildDeviceContext({
      platform: args.platform,
      deviceName: args.deviceName,
      userAgent: args.userAgent,
      acceptLanguage: args.acceptLanguage,
      ip: args.ip,
      deviceType: args.deviceType,
    });

    const userRoleRes = await pool.query(`SELECT role FROM users WHERE id = $1 LIMIT 1`, [row.user_id]);
    const role = userRoleRes.rows[0].role as UserRole;

    const tokenBundle = await issueTokensForUserSession({
      userId: row.user_id,
      role,
      device,
      via: "password",
    });

    await auditService.record({
      eventType: "password_reset_completed",
      userId: row.user_id,
      actorId: null,
      success: true,
      ip: args.ip ?? null,
      userAgent: args.userAgent ?? null,
      fingerprint: device.fingerprint,
      metadata: {},
    });

    return { access_token: tokenBundle.access_token, refresh_token: tokenBundle.refresh_token, expires_in: tokenBundle.expires_in };
  },

  async getMe(userId: string) {
    return profileService.getMe(userId);
  },

  async updateMe(args: { userId: string; patch: { name?: string; bio?: string | null; avatar_url?: string | null; locale?: string | null; timezone?: string | null } }) {
    const beforeFields: string[] = [];
    if (args.patch.name !== undefined) beforeFields.push("name");
    if (args.patch.bio !== undefined) beforeFields.push("bio");
    if (args.patch.avatar_url !== undefined) beforeFields.push("avatar_url");
    if (args.patch.locale !== undefined) beforeFields.push("locale");
    if (args.patch.timezone !== undefined) beforeFields.push("timezone");

    const updated = await profileService.updateMe(args.userId, args.patch);

    await auditService.record({
      eventType: "profile_updated",
      userId: args.userId,
      actorId: null,
      success: true,
      metadata: { fields: beforeFields },
    });

    authEvents.emit("auth.profile_updated" as any, { userId: args.userId, fields: beforeFields });
    return updated;
  },

  async listSessions(userId: string, currentSessionId: string) {
    const sessions = await sessionService.listActiveSessionsForUser({ userId });
    // Order: current first, then most recently used.
    const mapped = sessions.map((s) => ({
      id: s.id,
      platform: s.platform,
      device_name: s.device_name,
      device_type: (s.device_type as any) ?? "unknown",
      os: s.os,
      browser: s.browser,
      app_version: s.app_version,
      ip: s.ip ? String(s.ip) : null,
      city: null,
      country: null,
      issued_at: s.issued_at,
      last_used_at: s.last_used_at,
      expires_at: s.expires_at,
      is_current: s.id === currentSessionId,
    }));

    mapped.sort((a, b) => Number(b.is_current) - Number(a.is_current) || (b.last_used_at ?? "").localeCompare(a.last_used_at ?? ""));
    return { sessions: mapped };
  },

  async revokeSession(args: { userId: string; sessionId: string; currentSessionId: string; tokenExpEpochSeconds?: number; refreshTokenRaw?: string; reason?: string }) {
    // If current session is revoked, it behaves like logout for this device.
    await sessionService.revokeSession({ sessionId: args.sessionId, userId: args.userId, reason: args.reason ?? "logout" });

    if (args.sessionId === args.currentSessionId && args.tokenExpEpochSeconds) {
      await tokenService.blacklistAccessJti({
        userId: args.userId,
        jti: args.sessionId,
        expEpochSeconds: args.tokenExpEpochSeconds,
        reason: args.reason ?? "logout",
      });
    }
    await auditService.record({
      eventType: "logout",
      userId: args.userId,
      actorId: null,
      success: true,
      metadata: { session_id: args.sessionId },
    });
  },

  async requestEmailVerify(args: { userId: string; ip?: string; userAgent?: string; acceptLanguage?: string; deviceName?: string; deviceType?: string; platform: Platform }) {
    const pool = getPool();

    // Rate limit: 3 / hour per user.
    const key = `user:${args.userId}`;
    const count = hitCounter(emailVerifyRequestRate, key, 60 * 60 * 1000);
    if (count > 3) return; // 204 no content (contract doesn’t define 429 code).

    const userRes = await pool.query(`SELECT email FROM users WHERE id = $1 LIMIT 1`, [args.userId]);
    if (!userRes.rowCount) throw Errors.userNotFound();

    const tokenRaw = randomToken(32);
    const tokenHash = sha256Hex(tokenRaw);
    const expiresAtIso = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    await pool.query(`INSERT INTO email_verification_tokens (user_id, token_hash, expires_at) VALUES ($1,$2,$3)`, [
      args.userId,
      tokenHash,
      expiresAtIso,
    ]);

    const link = `${process.env.PUBLIC_URL ?? ""}/verify?token=${encodeURIComponent(tokenRaw)}`;
    await mailerService.send({
      to: userRes.rows[0].email,
      subject: "Verify your email",
      text: `Verify: ${link}`,
      authkeyMid: authkeyTransactionalEmailMids.emailVerify,
      authkeyParams: { link },
    });

    await auditService.record({
      eventType: "email_verify_requested",
      userId: args.userId,
      actorId: null,
      success: true,
      ip: args.ip ?? null,
      userAgent: args.userAgent ?? null,
      fingerprint: fingerprintFromParts({ userAgent: args.userAgent ?? "", ip: args.ip, acceptLanguage: args.acceptLanguage }),
      metadata: {},
    });

    return;
  },

  async confirmEmailVerify(args: { token: string }) {
    const pool = getPool();
    const tokenHash = sha256Hex(args.token);
    const now = new Date();

    const res = await pool.query(
      `
      SELECT user_id, expires_at, used_at
      FROM email_verification_tokens
      WHERE token_hash = $1
      LIMIT 1
    `,
      [tokenHash],
    );
    if (!res.rowCount) throw Errors.invalidOrExpiredToken();
    const row = res.rows[0] as any;
    if (row.used_at) throw Errors.invalidOrExpiredToken();
    if (new Date(row.expires_at).getTime() < now.getTime()) throw Errors.invalidOrExpiredToken();

    await pool.query(`UPDATE users SET email_verified_at = now(), updated_at = now() WHERE id = $1`, [row.user_id]);
    await pool.query(`UPDATE email_verification_tokens SET used_at = now() WHERE token_hash = $1`, [tokenHash]);

    await auditService.record({ eventType: "email_verify_completed", userId: row.user_id, actorId: null, success: true, metadata: {} });

    const userRes = await pool.query(`SELECT email_verified_at FROM users WHERE id = $1 LIMIT 1`, [row.user_id]);
    return { email_verified_at: userRes.rows[0].email_verified_at };
  },

  async linkGoogle(args: { userId: string; id_token: string }) {
    const linked = await oauthService.linkGoogleToAuthenticatedUser({ userId: args.userId, idToken: args.id_token });
    await auditService.record({ eventType: "google_linked", userId: args.userId, actorId: null, success: true, metadata: { provider: "google" } });
    return linked;
  },

  async unlinkGoogle(args: { userId: string }) {
    await oauthService.unlinkGoogleFromAuthenticatedUser({ userId: args.userId });
    await auditService.record({ eventType: "google_unlinked", userId: args.userId, actorId: null, success: true, metadata: {} });
  },
};

