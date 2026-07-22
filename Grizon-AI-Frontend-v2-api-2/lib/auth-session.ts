import { jwtDecode } from 'jwt-decode';
import { PLATFORM_WEB } from './auth-constants';
import { authRefresh, ApiError } from './auth-api';

type JwtPayload = { exp?: number };

let getAccessToken: () => string | null = () => null;
let getRefreshToken: () => string | null = () => null;
let setTokenPair: (access: string, refresh: string) => void = () => {};
let clearAll: () => void = () => {};
let getApiBase: () => string = () => '';

let refreshPromise: Promise<string | null> | null = null;

export function registerAuthSessionBridge(opts: {
  getAccessToken: () => string | null;
  getRefreshToken: () => string | null;
  setTokenPair: (access: string, refresh: string) => void;
  clearAll: () => void;
  getApiBase: () => string;
}) {
  getAccessToken = opts.getAccessToken;
  getRefreshToken = opts.getRefreshToken;
  setTokenPair = opts.setTokenPair;
  clearAll = opts.clearAll;
  getApiBase = opts.getApiBase;
}

function isAccessTokenValid(token: string | null): boolean {
  if (!token) return false;
  try {
    const d = jwtDecode<JwtPayload>(token);
    if (!d.exp) return true;
    return d.exp * 1000 > Date.now() + 5000;
  } catch {
    return false;
  }
}

/** Single-flight refresh; returns new access token or null on failure. */
export async function refreshAccessToken(): Promise<string | null> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      const rt = getRefreshToken();
      if (!rt) return null;

      // Retry once on network errors (ECONNRESET, fetch TypeError, etc.)
      let lastError: unknown = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const bundle = await authRefresh(rt);
          setTokenPair(bundle.access_token, bundle.refresh_token);
          return bundle.access_token;
        } catch (e) {
          lastError = e;
          // Only retry on network errors, not auth errors
          if (e instanceof ApiError && (e.status === 400 || e.status === 401 || e.status === 403)) {
            clearAll();
            return null;
          }
          // Network error — wait briefly then retry once
          if (attempt === 0) {
            await new Promise((r) => setTimeout(r, 500));
            continue;
          }
        }
      }
      // All retries exhausted
      console.warn('[Auth] Refresh failed after retries:', lastError);
      return null;
    } catch (e) {
      if (e instanceof ApiError && (e.status === 400 || e.status === 401 || e.status === 403)) {
        clearAll();
      }
      return null;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

export async function ensureAccessToken(): Promise<string | null> {
  const at = getAccessToken();
  if (isAccessTokenValid(at)) return at;
  return refreshAccessToken();
}

/**
 * Fetch with Bearer + x-platform. On 401, runs single-flight refresh and retries once.
 * Do not use for `POST /api/v1/auth/refresh` — use `authRefresh` from `auth-api` instead.
 */
export async function authenticatedFetch(input: string | URL, init: RequestInit = {}): Promise<Response> {
  const base = getApiBase().replace(/\/$/, '');
  const url = typeof input === 'string' && input.startsWith('/') ? `${base}${input}` : String(input);

  const doFetch = async (access: string | null) => {
    const headers = new Headers(init.headers);
    headers.set('x-platform', PLATFORM_WEB);
    if (access) headers.set('Authorization', `Bearer ${access}`);
    return fetch(url, { ...init, headers });
  };

  const access = await ensureAccessToken();
  let res = await doFetch(access);

  if (res.status === 401) {
    const newAccess = await refreshAccessToken();
    if (newAccess) {
      res = await doFetch(newAccess);
    }
  }

  return res;
}

export { ApiError };
