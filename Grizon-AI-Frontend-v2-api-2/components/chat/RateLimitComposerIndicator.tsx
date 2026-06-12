'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchUsageRateLimit } from '@/lib/chat-rest-api';
import {
  RATE_LIMIT_WINDOW_LABELS,
  RATE_LIMIT_WINDOW_ORDER,
  formatRateLimitResetAt,
  rateLimitBarColorClass,
  rateLimitPercentColorClass,
  rateLimitWindowPercent,
} from '@/lib/rate-limit-ui';
import type { RateLimitWindowDto, UsageRateLimitDto } from '@/types/settings-api';

function CircularUsageRing({
  percent,
  size = 14,
  colorClass,
}: {
  percent: number;
  size?: number;
  colorClass: string;
}) {
  const stroke = 3;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (percent / 100) * c;
  return (
    <svg width={size} height={size} className="shrink-0 -rotate-90" aria-hidden>
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth={stroke}
        className="text-text-faint"
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth={stroke}
        strokeDasharray={c}
        strokeDashoffset={offset}
        strokeLinecap="round"
        className={`transition-[stroke-dashoffset] duration-300 ${colorClass}`}
      />
    </svg>
  );
}

function CompactRateLimitRow({ label, window }: { label: string; window: RateLimitWindowDto }) {
  const pct = rateLimitWindowPercent(window);
  const unlimited = window.limit == null;
  const barClass = rateLimitBarColorClass(pct);

  return (
    <div className="space-y-1.5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[12px] font-semibold text-text-primary">{label}</p>
        <p className="text-[10px] text-text-muted shrink-0 text-right">
          {unlimited
            ? `${window.used.toLocaleString()} used`
            : `${pct.toFixed(0)}% · resets ${formatRateLimitResetAt(window.resetAt, true)}`}
        </p>
      </div>
      <div className="h-1 w-full rounded-full bg-surface-3 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ${barClass}`}
          style={{ width: `${unlimited ? 0 : pct}%` }}
        />
      </div>
    </div>
  );
}

export default function RateLimitComposerIndicator() {
  const [rateLimit, setRateLimit] = useState<UsageRateLimitDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await fetchUsageRateLimit();
      setRateLimit(data);
    } catch {
      setRateLimit(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(id);
  }, [load]);

  const aggregatePercent = useMemo(() => {
    if (!rateLimit) return 0;
    const values = RATE_LIMIT_WINDOW_ORDER.map((key) => rateLimit.windows[key])
      .filter((w): w is RateLimitWindowDto => !!w && w.limit != null)
      .map(rateLimitWindowPercent);

    if (!values.length) return 0;
    return Math.max(...values);
  }, [rateLimit]);

  const colorClass = rateLimitPercentColorClass(
    rateLimit?.cooldown.active ? 100 : aggregatePercent,
  );

  if (loading) {
    return (
      <span className="w-8 h-8 flex items-center justify-center" aria-hidden>
        <span className="h-3.5 w-3.5 rounded-full bg-surface-3" />
      </span>
    );
  }

  if (!rateLimit) return null;

  return (
    <div
      className="relative shrink-0"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setOpen(false);
      }}
    >
      <button
        type="button"
        className="flex items-center justify-center rounded-full p-0.5 outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
        aria-label={`Usage ${aggregatePercent}%`}
        aria-expanded={open}
      >
        <CircularUsageRing percent={aggregatePercent} colorClass={colorClass} />
      </button>
      {open ? (
        <div
          role="tooltip"
          className="absolute right-0 bottom-full z-[90] mb-2 w-[min(100vw-2rem,280px)] rounded-xl border border-border-default bg-elevated p-3 shadow-xl animate-in fade-in zoom-in-95 duration-150"
        >
          <p className="text-[11px] font-bold text-text-muted uppercase tracking-wider mb-2 px-1">
            Usage
          </p>
          {rateLimit.cooldown.active ? (
            <p className="text-[11px] text-red-300/90 mb-2 px-1">Rate limit cooldown active</p>
          ) : null}
          {rateLimit.degraded ? (
            <p className="text-[11px] text-amber-300/80 mb-2 px-1">Usage data may be unavailable</p>
          ) : null}
          <div className="space-y-3">
            {RATE_LIMIT_WINDOW_ORDER.map((key) => {
              const w = rateLimit.windows[key];
              if (!w) return null;
              return <CompactRateLimitRow key={key} label={RATE_LIMIT_WINDOW_LABELS[key]} window={w} />;
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}