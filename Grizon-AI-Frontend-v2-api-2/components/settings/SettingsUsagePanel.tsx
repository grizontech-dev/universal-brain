'use client';

import { useCallback, useEffect, useState } from 'react';
import { Info, Loader2, RefreshCw } from 'lucide-react';
import { fetchUsageHistory, fetchUsageRateLimit, fetchUsageSummary } from '@/lib/chat-rest-api';
import { ApiError } from '@/lib/auth-api';
import {
  RATE_LIMIT_WINDOW_LABELS,
  RATE_LIMIT_WINDOW_ORDER,
  formatRateLimitResetAt,
  rateLimitBarColorClass,
  rateLimitWindowPercent,
} from '@/lib/rate-limit-ui';
import type {
  RateLimitWindowDto,
  RateLimitWindowKey,
  UsageHistoryDto,
  UsageRateLimitDto,
  UsageSummaryDto,
} from '@/types/settings-api';

function num(v: number | string | undefined): number {
  if (v === undefined) return 0;
  return typeof v === 'number' ? v : Number(v) || 0;
}

function formatCooldownUntil(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function formatDay(value: string): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function RateLimitRow({ label, window }: { label: string; window: RateLimitWindowDto }) {
  const pct = rateLimitWindowPercent(window);
  const unlimited = window.limit == null;
  const barClass = rateLimitBarColorClass(pct);

  return (
    <div className="space-y-2 py-4 border-b border-border-subtle last:border-0">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-semibold text-text-primary text-[15px]">{label}</p>
          <p className="text-text-muted mt-0.5 text-[13px]">{formatRateLimitResetAt(window.resetAt)}</p>
        </div>
        <div className="shrink-0 text-right text-[13px]">
          {unlimited ? (
            <span className="text-text-secondary">{window.used.toLocaleString()} used</span>
          ) : (
            <>
              <span className="text-text-primary font-medium">{pct.toFixed(1)}% used</span>
              <p className="text-[11px] text-text-muted mt-0.5">
                {window.used.toLocaleString()} / {window.limit!.toLocaleString()}
              </p>
            </>
          )}
        </div>
      </div>
      <div className="w-full rounded-full bg-surface-3 overflow-hidden h-1.5">
        <div
          className={`h-full rounded-full transition-all duration-300 ${barClass}`}
          style={{ width: `${unlimited ? 0 : pct}%` }}
        />
      </div>
      {!unlimited ? (
        <p className="text-[11px] text-text-faint">{window.remaining.toLocaleString()} remaining</p>
      ) : null}
    </div>
  );
}

function RateLimitSection({
  rateLimit,
  rateLimitError,
}: {
  rateLimit: UsageRateLimitDto | null;
  rateLimitError: string | null;
}) {
  if (rateLimitError) {
    return (
      <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-amber-200/90 text-sm mb-8">
        {rateLimitError}
      </div>
    );
  }

  if (!rateLimit) return null;

  const rows = RATE_LIMIT_WINDOW_ORDER.map((key) => {
    const w = rateLimit.windows[key];
    return w ? { key, window: w } : null;
  }).filter((r): r is { key: RateLimitWindowKey; window: RateLimitWindowDto } => r != null);

  return (
    <section className="mb-10">
      <div className="mb-6">
        <h2 className="text-lg font-bold text-text-primary mb-1">Rate limiting</h2>
        <p className="text-[13px] text-text-muted">
          Request limits for your plan across hourly, daily, weekly, and monthly windows.
        </p>
        <div className="flex flex-wrap items-center gap-2 mt-3">
          {rateLimit.degraded ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-300 text-[10px] font-bold uppercase tracking-wider border border-amber-500/20">
              <Info size={12} />
              Degraded
            </span>
          ) : null}
          {rateLimit.cooldown.active ? (
            <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-red-500/10 text-red-300 text-[10px] font-bold uppercase tracking-wider border border-red-500/20">
              Cooldown
              {rateLimit.cooldown.cooldownUntil
                ? ` until ${formatCooldownUntil(rateLimit.cooldown.cooldownUntil)}`
                : rateLimit.cooldown.retryAfterSeconds != null
                  ? ` · ${rateLimit.cooldown.retryAfterSeconds}s`
                  : ''}
            </span>
          ) : null}
        </div>
      </div>

      <div className="rounded-xl border border-border-subtle bg-card px-5 sm:px-6">
        {rows.length === 0 ? (
          <p className="py-8 text-center text-text-muted text-sm">No rate limit windows available.</p>
        ) : (
          rows.map(({ key, window }) => (
            <RateLimitRow key={key} label={RATE_LIMIT_WINDOW_LABELS[key]} window={window} />
          ))
        )}
      </div>
    </section>
  );
}

export default function SettingsUsagePanel() {
  const [summary, setSummary] = useState<UsageSummaryDto | null>(null);
  const [history, setHistory] = useState<UsageHistoryDto | null>(null);
  const [rateLimit, setRateLimit] = useState<UsageRateLimitDto | null>(null);
  const [rateLimitError, setRateLimitError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setRateLimitError(null);
    try {
      const [s, h, rl] = await Promise.all([
        fetchUsageSummary(),
        fetchUsageHistory(30),
        fetchUsageRateLimit().catch((e) => {
          setRateLimitError(e instanceof ApiError ? e.message : 'Could not load rate limits');
          return null;
        }),
      ]);
      setSummary(s);
      setHistory(h);
      setRateLimit(rl);
      setLastUpdated(new Date());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load usage');
      setSummary(null);
      setHistory(null);
      setRateLimit(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-text-muted gap-2">
        <Loader2 className="animate-spin" size={20} />
        Loading usage…
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary mb-2">Usage</h1>
          <p className="text-[14px] text-text-muted">Rate limits, summary, and daily history for your account.</p>
          {lastUpdated ? (
            <p className="text-[11px] text-text-faint mt-2 flex items-center gap-1.5">
              Last updated: {lastUpdated.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center gap-2 self-start px-4 py-2 rounded-xl border border-border-default text-text-secondary text-xs font-bold hover:bg-surface-2"
        >
          <RefreshCw size={14} />
          Refresh
        </button>
      </div>

      <RateLimitSection rateLimit={rateLimit} rateLimitError={rateLimitError} />

      {error ? (
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4 text-red-300 text-sm">
          {error}
        </div>
      ) : null}

      {summary ? (
        <div>
          <h2 className="text-[11px] font-bold text-text-faint uppercase tracking-wider mb-3">Request usage</h2>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { label: 'Requests', value: summary.requests },
              { label: 'Total tokens', value: summary.total_tokens.toLocaleString() },
              { label: 'Credits used', value: summary.credits_used.toLocaleString() },
              { label: 'Cost (USD)', value: num(summary.cost_usd).toFixed(4) },
            ].map((c) => (
              <div key={c.label} className="rounded-xl border border-border-subtle bg-card p-4">
                <p className="text-[10px] font-black text-text-faint uppercase tracking-wider mb-1">{c.label}</p>
                <p className="text-lg font-bold text-text-primary">{c.value}</p>
                <p className="text-[10px] text-text-faint mt-1">
                  {summary.periodStart} → {summary.periodEnd}
                </p>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="rounded-xl border border-border-subtle bg-card overflow-hidden">
        <div className="px-5 py-4 border-b border-border-subtle flex justify-between items-center">
          <h2 className="text-[11px] font-bold text-text-faint uppercase tracking-wider">Daily history</h2>
          {history ? (
            <span className="text-[10px] text-text-faint">Last {history.days} days</span>
          ) : null}
        </div>
        <div className="overflow-x-auto max-h-[420px] overflow-y-auto custom-scrollbar">
          {!history?.points?.length ? (
            <p className="p-8 text-center text-text-muted text-sm">No usage points in this range.</p>
          ) : (
            <table className="w-full text-left text-[13px]">
              <thead className="sticky top-0 bg-card z-10 border-b border-border-subtle">
                <tr className="text-text-muted text-[10px] uppercase tracking-wider">
                  <th className="px-5 py-3 font-bold">Day</th>
                  <th className="px-3 py-3 font-bold">Requests</th>
                  <th className="px-3 py-3 font-bold">Tokens</th>
                  <th className="px-3 py-3 font-bold">Credits</th>
                  <th className="px-5 py-3 font-bold text-right">USD</th>
                </tr>
              </thead>
              <tbody>
                {history.points.map((p) => (
                  <tr key={p.day} className="border-b border-border-subtle hover:bg-surface-1">
                    <td className="px-5 py-3 text-text-secondary whitespace-nowrap">{formatDay(p.day)}</td>
                    <td className="px-3 py-3 text-text-secondary">{p.request_count}</td>
                    <td className="px-3 py-3 text-text-secondary">{p.total_tokens.toLocaleString()}</td>
                    <td className="px-3 py-3 text-text-secondary">{p.credits_deducted}</td>
                    <td className="px-5 py-3 text-right text-text-secondary">{num(p.cost_usd).toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}