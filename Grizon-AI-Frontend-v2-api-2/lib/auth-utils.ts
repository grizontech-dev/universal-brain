import { jwtDecode } from 'jwt-decode';
import { REFRESH_TOKEN_STORAGE_KEY } from './auth-constants';

/** Refresh token only — access JWT must stay in memory (see `auth-flow-nextjs.md`). */
export const getRefreshToken = (): string | null => {
  if (typeof window !== 'undefined') {
    return localStorage.getItem(REFRESH_TOKEN_STORAGE_KEY);
  }
  return null;
};

export const setRefreshToken = (token: string): void => {
  if (typeof window !== 'undefined') {
    localStorage.setItem(REFRESH_TOKEN_STORAGE_KEY, token);
  }
};

export const clearAuthStorage = (): void => {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(REFRESH_TOKEN_STORAGE_KEY);
    localStorage.removeItem('user_data');
    localStorage.removeItem('auth_token');
  }
};

/** @deprecated Use getRefreshToken; access tokens must not live in localStorage */
export const getToken = (): string | null => getRefreshToken();

/** @deprecated Use setRefreshToken only for refresh token */
export const setToken = (token: string): void => setRefreshToken(token);

/** @deprecated Use clearAuthStorage */
export const removeToken = (): void => clearAuthStorage();

/** True if JWT `exp` is in the past (pass access token from memory). */
export const isAccessTokenExpired = (accessToken: string | null): boolean => {
  if (!accessToken) return true;
  try {
    const decoded: { exp?: number } = jwtDecode(accessToken);
    if (!decoded.exp) return false;
    return decoded.exp * 1000 < Date.now();
  } catch {
    return true;
  }
};
