import { getApiBaseUrl, PLATFORM_WEB } from './auth-constants';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string | undefined,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

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

export type CheckEmailResult = {
  exists: boolean;
  has_password: boolean;
  has_google: boolean;
  suggested_action: 'login' | 'register';
};

export type AuthTokenBundle = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
};

export type AuthUserProfile = {
  id: string;
  email: string;
  name: string;
  bio: string | null;
  avatar_url: string | null;
  locale: string | null;
  timezone: string | null;
  role: 'user' | 'admin' | 'superadmin';
  status: 'active' | 'banned' | 'suspended';
  email_verified_at: string | null;
  mfa_enabled: boolean;
  has_password: boolean;
  linked_providers: Array<{ provider: 'google'; provider_email: string; linked_at: string }>;
  created_at: string;
  last_login_at: string | null;
};

export type RegisterWithTokens = AuthTokenBundle & {
  user: AuthUserProfile;
};

export type EmailVerifyConfirmResult = {
  email_verified_at: string;
};

export type PasswordForgotAck = { ok: boolean };

type JsonRequestInit = Omit<RequestInit, 'body'> & {
  body?: unknown;
  accessToken?: string | null;
  skipAuthHeader?: boolean;
};

function buildHeaders(accessToken?: string | null, skipAuthHeader?: boolean): HeadersInit {
  const h: Record<string, string> = {
    'x-platform': PLATFORM_WEB,
  };
  if (!skipAuthHeader && accessToken) {
    h.Authorization = `Bearer ${accessToken}`;
  }
  return h;
}

export async function authRequestJson<T>(
  path: string,
  init: JsonRequestInit = {},
): Promise<T> {
  const base = getApiBaseUrl();
  if (!base) {
    throw new ApiError(0, 'CONFIG', 'NEXT_PUBLIC_API_URL is not set');
  }
  const url = `${base}${path.startsWith('/') ? path : `/${path}`}`;
  const { body, accessToken, skipAuthHeader, headers: extraHeaders, ...rest } = init;
  const headers = new Headers(buildHeaders(accessToken, skipAuthHeader));
  if (extraHeaders) {
    const eh = new Headers(extraHeaders);
    eh.forEach((v, k) => headers.set(k, v));
  }
  if (body !== undefined && body !== null) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(url, {
    ...rest,
    headers,
    body: body === undefined || body === null ? undefined : JSON.stringify(body),
  });

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

export function authCheckEmail(baseEmail: string, captchaToken?: string) {
  return authRequestJson<CheckEmailResult>('/api/v1/auth/check-email', {
    method: 'POST',
    body: { email: baseEmail.trim(), ...(captchaToken ? { captcha_token: captchaToken } : {}) },
    skipAuthHeader: true,
  });
}

export function authRegister(args: {
  email: string;
  password: string;
  name: string;
  bio?: string;
  locale?: string;
  timezone?: string;
}) {
  return authRequestJson<RegisterWithTokens>('/api/v1/auth/register', {
    method: 'POST',
    body: {
      email: args.email.trim(),
      password: args.password,
      name: args.name.trim(),
      ...(args.bio !== undefined ? { bio: args.bio } : {}),
      ...(args.locale ? { locale: args.locale } : {}),
      ...(args.timezone ? { timezone: args.timezone } : {}),
    },
    skipAuthHeader: true,
  });
}

export function authLogin(email: string, password: string) {
  return authRequestJson<RegisterWithTokens>('/api/v1/auth/login', {
    method: 'POST',
    body: { email: email.trim(), password },
    skipAuthHeader: true,
  });
}

export function authRefresh(refreshToken: string) {
  return authRequestJson<AuthTokenBundle>('/api/v1/auth/refresh', {
    method: 'POST',
    body: { refresh_token: refreshToken },
    skipAuthHeader: true,
  });
}

export function authMe(accessToken: string) {
  return authRequestJson<AuthUserProfile>('/api/v1/auth/me', {
    method: 'GET',
    accessToken,
  });
}

export function authEmailVerifyRequest(accessToken: string) {
  return authRequestJson<void>('/api/v1/auth/email/verify/request', {
    method: 'POST',
    accessToken,
  });
}

export function authEmailVerifyConfirm(token: string) {
  return authRequestJson<EmailVerifyConfirmResult>('/api/v1/auth/email/verify/confirm', {
    method: 'POST',
    body: { token },
    skipAuthHeader: true,
  });
}

export function authPasswordForgot(email: string) {
  return authRequestJson<PasswordForgotAck>('/api/v1/auth/password/forgot', {
    method: 'POST',
    body: { email: email.trim() },
    skipAuthHeader: true,
  });
}

export function authPasswordReset(token: string, newPassword: string) {
  return authRequestJson<RegisterWithTokens>('/api/v1/auth/password/reset', {
    method: 'POST',
    body: { token, new_password: newPassword },
    skipAuthHeader: true,
  });
}

export function authLogout(accessToken: string, refreshToken: string) {
  return authRequestJson<void>('/api/v1/auth/logout', {
    method: 'POST',
    accessToken,
    body: { refresh_token: refreshToken },
  });
}

export function authLogoutAll(accessToken: string) {
  return authRequestJson<void>('/api/v1/auth/logout-all', {
    method: 'POST',
    accessToken,
  });
}
