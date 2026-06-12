/** localStorage key for refresh token (access token stays in memory only). */
export const REFRESH_TOKEN_STORAGE_KEY = 'grizon_refresh_token';

/** Required on all API requests per backend contract. */
export const PLATFORM_WEB = 'web' as const;

export function getApiBaseUrl(): string {
  if (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_API_URL) {
    return process.env.NEXT_PUBLIC_API_URL.replace(/\/$/, '');
  }
  return '';
}
