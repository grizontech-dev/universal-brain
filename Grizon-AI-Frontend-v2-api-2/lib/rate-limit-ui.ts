import type { RateLimitWindowDto, RateLimitWindowKey } from '@/types/settings-api';

export const RATE_LIMIT_WINDOW_ORDER: RateLimitWindowKey[] = [
  'hourly',
  'daily',
  'weekly',
  'monthly',
];

export const RATE_LIMIT_WINDOW_LABELS: Record<RateLimitWindowKey, string> = {
  hourly: 'Hourly limit',
  daily: 'Daily limit',
  weekly: 'Weekly limit',
  monthly: 'Monthly limit',
};

export function rateLimitWindowPercent(w: RateLimitWindowDto): number {
  if (w.usagePercent != null) return Math.min(100, Math.max(0, w.usagePercent));
  if (w.limit != null && w.limit > 0) return Math.min(100, (w.used / w.limit) * 100);
  return 0;
}

/** Stroke/fill color by usage fill level. */
export function rateLimitPercentColorClass(percent: number): string {
  if (percent >= 85) return 'text-red-500';
  if (percent >= 60) return 'text-amber-400';
  return 'text-emerald-500';
}

export function rateLimitBarColorClass(percent: number): string {
  if (percent >= 85) return 'bg-red-500';
  if (percent >= 60) return 'bg-amber-400';
  return 'bg-emerald-500';
}

export function aggregateRateLimitPercent(
  windows: Partial<Record<RateLimitWindowKey, RateLimitWindowDto>>,
): number {
  const values = RATE_LIMIT_WINDOW_ORDER.map((k) => windows[k])
    .filter((w): w is RateLimitWindowDto => !!w && w.limit != null)
    .map(rateLimitWindowPercent);
  if (!values.length) return 0;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

export function formatRateLimitResetAt(iso: string, short = false): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const now = Date.now();
  const diffMs = d.getTime() - now;
  if (diffMs <= 0) return short ? 'soon' : 'Resets soon';
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 60) return short ? `${mins}m` : `Resets in ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return short ? `${hours}h` : `Resets in ${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 14) return short ? `${days}d` : `Resets in ${days}d`;
  const formatted = d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  return short ? formatted : `Resets ${formatted}`;
}
