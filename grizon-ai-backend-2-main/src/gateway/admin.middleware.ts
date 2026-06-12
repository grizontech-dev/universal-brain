import type { RequestHandler } from 'express';

import { Errors } from '../utils/errors.js';

function requireAdminLogic(
  req: Express.Request,
  next: (err?: unknown) => void,
) {
  if (!req.user?.role) return next(Errors.adminRequired());
  if (req.actor) return next(Errors.impersonationNotAllowed());
  if (req.user.role !== 'admin' && req.user.role !== 'superadmin')
    return next(Errors.adminRequired());
  return next();
}

function requireSuperadminLogic(
  req: Express.Request,
  next: (err?: unknown) => void,
) {
  if (!req.user?.role) return next(Errors.superadminRequired());
  if (req.user.role !== 'superadmin') return next(Errors.superadminRequired());
  return next();
}

export const requireAdmin: RequestHandler = (req, _res, next) => {
  requireAdminLogic(req, next);
};

export const requireSuperadmin: RequestHandler = (req, _res, next) => {
  requireSuperadminLogic(req, next);
};

export const adminMiddleware: RequestHandler = (req, _res, next) => {
  if (req.method === 'OPTIONS' || req.path === '/health') return next();
  if (!req.path.startsWith('/api/v1/admin')) return next();

  if (req.platform !== 'admin') {
    return next(Errors.platformMismatch());
  }
  return requireAdminLogic(req, next);
};
