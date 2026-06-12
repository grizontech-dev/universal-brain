import type { Response } from "express";

export type ResponseMeta = {
  request_id?: string;
  pagination?: {
    page: number;
    page_size: number;
    total: number;
    total_pages: number;
  };
  rate_limit?: {
    remaining_hour: number;
    remaining_day: number;
    reset_at: string;
  };
  deprecation?: {
    sunset: string;
    alternative: string;
  };
};

function resolveRequestId(res: Response) {
  const requestId = res.getHeader("x-request-id");
  return typeof requestId === "string" ? requestId : undefined;
}

function withMeta(res: Response, meta?: ResponseMeta): ResponseMeta | undefined {
  const requestId = resolveRequestId(res);
  const merged = {
    ...(meta ?? {}),
    ...(requestId ? { request_id: requestId } : {}),
  };

  return Object.keys(merged).length ? merged : undefined;
}

export function ok<T>(res: Response, data: T, message: string, meta?: ResponseMeta) {
  res.status(200).json({
    success: true,
    message,
    data,
    ...(withMeta(res, meta) ? { meta: withMeta(res, meta) } : {}),
  });
}

export function created<T>(res: Response, data: T, message: string, meta?: ResponseMeta) {
  res.status(201).json({
    success: true,
    message,
    data,
    ...(withMeta(res, meta) ? { meta: withMeta(res, meta) } : {}),
  });
}

export function fail(
  res: Response,
  status: number,
  code: string,
  message: string,
  details?: unknown,
  meta?: ResponseMeta,
) {
  res.status(status).json({
    success: false,
    message,
    error: {
      code,
      ...(details !== undefined ? { details } : {}),
    },
    ...(withMeta(res, meta) ? { meta: withMeta(res, meta) } : {}),
  });
}
