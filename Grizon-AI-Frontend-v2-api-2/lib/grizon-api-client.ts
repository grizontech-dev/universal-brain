import { getApiBaseUrl } from './auth-constants';
import { authenticatedFetch } from './auth-session';
import { ApiError } from './auth-api';

export type ApiEnvelopeSuccess<T> = {
  success: true;
  message: string;
  data: T;
  meta?: unknown;
};

export type ApiEnvelopeError = {
  success: false;
  message: string;
  error?: { code?: string; details?: unknown };
  meta?: unknown;
};

export type GrizonJsonInit = Omit<RequestInit, 'body'> & {
  body?: unknown;
  /** Skip JSON body serialization */
  rawBody?: BodyInit | null;
};

/**
 * Authenticated JSON request to `/api/v1/*`.
 * Parses universal envelope per backend `03_REQUEST_RESPONSE.md`.
 */
export async function grizonRequestJson<T>(path: string, init: GrizonJsonInit = {}): Promise<T> {
  const base = getApiBaseUrl();
  if (!base) {
    throw new ApiError(0, 'CONFIG', 'NEXT_PUBLIC_API_URL is not set');
  }
  const url = `${base.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
  const { body, rawBody, headers: extraHeaders, ...rest } = init;
  const headers = new Headers(extraHeaders);

  if (rawBody !== undefined) {
    const res = await authenticatedFetch(url, {
      ...rest,
      headers,
      body: rawBody,
    });
    return parseResponse<T>(res);
  }

  if (body !== undefined && body !== null) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await authenticatedFetch(url, {
    ...rest,
    headers,
    body: body === undefined || body === null ? undefined : JSON.stringify(body),
  });
  return parseResponse<T>(res);
}

async function parseResponse<T>(res: Response): Promise<T> {
  if (res.status === 204) {
    return undefined as T;
  }

  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    throw new ApiError(res.status, undefined, text || 'Invalid JSON response');
  }

  const envelope = parsed as {
    success?: boolean;
    message?: string;
    data?: T;
    error?: { code?: string; details?: unknown };
  } | null;

  if (!res.ok) {
    const code = envelope?.error?.code;
    const message = envelope?.message || res.statusText || 'Request failed';
    throw new ApiError(res.status, code, message, envelope?.error?.details);
  }

  if (envelope && envelope.success === false) {
    const code = envelope.error?.code;
    throw new ApiError(res.status, code, envelope.message || 'Request failed', envelope.error?.details);
  }

  if (envelope && envelope.data !== undefined) {
    return envelope.data as T;
  }

  return parsed as T;
}
