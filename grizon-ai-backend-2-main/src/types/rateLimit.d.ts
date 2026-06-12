export interface RateLimitWindows {
  hourly: number | null;
  daily: number | null;
  weekly: number | null;
  monthly: number | null;
}

export type RateLimitWindowKey = keyof RateLimitWindows;

export interface RateLimitCheckResult {
  allowed: boolean;
  degraded?: boolean;
  deniedBy?: "window" | "cooldown";
  limitType?: RateLimitWindowKey;
  limit?: number;
  remaining?: number;
  resetAt?: Date;
  retryAfterSeconds?: number;
  cooldownUntil?: Date;
  headers?: Array<{ key: string; value: string }>;
}

export type RateLimitEventType = "hit" | "cooldown" | "flagged" | "cleared" | "flag_resolved";
