import type { RequestHandler } from 'express';

import { getPool } from '../db/pool.js';
import { Errors } from '../utils/errors.js';
import { tokenService } from '../services/token.service.js';
import { sessionService } from '../services/session.service.js';
import { auditService } from '../services/audit.service.js';
import type { Platform } from '../types/auth.js';

const allowedPlatforms = [
  'web',
  'admin',
  'mobile-ios',
  'mobile-android',
] as const satisfies readonly Platform[];

function parsePlatform(xPlatform: string | undefined): Platform | null {
  if (!xPlatform) return null;
  if ((allowedPlatforms as readonly string[]).includes(xPlatform))
    return xPlatform as Platform;
  return null;
}

function isFoundationPublicPath(path: string) {
  return (
    path === '/api/v1/ping' ||
    path === '/api/v1/error' ||
    path === '/api/v1/plans' ||
    path === '/health' ||
    path === '/'
  );
}

function isPublicAuthPath(path: string) {
  return (
    path === '/api/v1/auth/check-email' ||
    path === '/api/v1/auth/register' ||
    path === '/api/v1/auth/login' ||
    path === '/api/v1/auth/google' ||
    path === '/api/v1/auth/refresh' ||
    path === '/api/v1/auth/password/forgot' ||
    path === '/api/v1/auth/password/reset' ||
    path === '/api/v1/auth/email/verify/confirm'
  );
}

// Paths that crawlers/bots hit without an x-platform header — skip auth entirely.
// Also includes payment webhooks which are verified by HMAC, not JWT.
const STATIC_BYPASS_PATHS = new Set(['/sitemap.xml', '/robots.txt', '/favicon.ico', '/payments/webhook']);

export const authMiddleware: RequestHandler = async (req, res, next) => {
  if (req.path === '/health' || req.method === 'OPTIONS' || STATIC_BYPASS_PATHS.has(req.path)) {
    return next();
  }

  const rawPlatformHeader = req.header('x-platform') ?? undefined;

  const platform = parsePlatform(rawPlatformHeader);
  if (!platform) {
    return next(Errors.platformMismatch());
  }
  req.platform = platform;

  // Public endpoints: allow through without Bearer auth.
  if (isPublicAuthPath(req.path) || isFoundationPublicPath(req.path)) {
    return next();
  }

  const authHeader = req.header('Authorization');
  if (!authHeader) return next(Errors.notAuthenticated());

  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1];
  if (!token) return next(Errors.notAuthenticated());

  let decoded: any;
  try {
    decoded = await tokenService.verifyAccess(token, platform);
  } catch (e: any) {
    const msg = String(e?.message ?? '');
    if (msg.toLowerCase().includes('expired'))
      return next(Errors.tokenExpired());
    return next(Errors.invalidToken());
  }

  // Blacklist check (hot-path Redis, cold-restart Postgres mirror).
  try {
    const isBlacklisted = await tokenService.isAccessJtiBlacklisted({
      jti: decoded.jti,
    });
    if (isBlacklisted) return next(Errors.tokenRevoked());
  } catch {
    // If blacklist is unavailable, still try to validate session.
  }

  // Load the refresh session row that this access token maps to.
  const session = await sessionService.loadActiveSessionById({
    sessionId: decoded.jti,
  });
  if (!session) return next(Errors.tokenRevoked());

  // Load user and enforce status.
  const pool = getPool();
  const userRes = await pool.query(
    `
    SELECT id,email,name,bio,avatar_url,role,status,email_verified_at,mfa_enabled,password_hash IS NOT NULL AS has_password
    FROM users
    WHERE id = $1
    LIMIT 1
  `,
    [decoded.sub],
  );

  if (!userRes.rowCount) return next(Errors.tokenRevoked());
  const userRow = userRes.rows[0] as any;

  if (userRow.status === 'banned') return next(Errors.userBanned());
  if (userRow.status === 'suspended' && req.method !== 'GET')
    return next(Errors.userBanned());

  req.user = {
    id: userRow.id,
    email: userRow.email,
    name: userRow.name,
    bio: userRow.bio,
    avatar_url: userRow.avatar_url,
    role: userRow.role,
    status: userRow.status,
    plan_id: null,
    email_verified_at: userRow.email_verified_at,
    mfa_enabled: Boolean(userRow.mfa_enabled),
    has_password: Boolean(userRow.has_password),
    linked_providers: [],
  };

  req.session = {
    id: session.id,
    platform: session.platform,
    device_name: session.device_name,
    fingerprint: session.fingerprint,
    issued_at: session.issued_at,
    expires_at: session.expires_at,
    last_used_at: session.last_used_at,
  };
  res.setHeader('x-user-id', req.user.id);
  res.setHeader('x-session-id', req.session.id);
  req.token = {
    jti: decoded.jti,
    exp: decoded.exp,
    aud: decoded.aud,
    iss: decoded.iss,
  } as any;

  // Impersonation token: token.act.sub is the acting admin id.
  if (decoded.act?.sub) {
    req.actor = { id: decoded.act.sub };

    // Audit all impersonation actions (best-effort on response finish).
    res.on('finish', () => {
      void auditService.record({
        eventType: 'admin_impersonate_action',
        userId: req.user?.id ?? null,
        actorId: req.actor?.id ?? null,
        ip: req.ip ?? null,
        userAgent: req.headers['user-agent']?.toString() ?? null,
        fingerprint: req.session?.fingerprint ?? null,
        success: res.statusCode < 400,
        metadata: { path: req.path, method: req.method },
      });
    });
  }

  return next();
};
