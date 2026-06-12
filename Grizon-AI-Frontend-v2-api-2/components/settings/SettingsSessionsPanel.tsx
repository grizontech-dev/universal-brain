'use client';

import { useCallback, useEffect, useState } from 'react';
import { Monitor, Trash2, Loader2 } from 'lucide-react';
import { deleteAuthSession, fetchAuthSessions } from '@/lib/chat-rest-api';
import { ApiError } from '@/lib/auth-api';
import type { AuthSessionListItem } from '@/types/settings-api';

function fmtDate(iso: string | null | undefined) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export default function SettingsSessionsPanel({
  onRevokedCurrentSession,
}: {
  onRevokedCurrentSession: () => void;
}) {
  const [sessions, setSessions] = useState<AuthSessionListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchAuthSessions();
      setSessions(res.sessions ?? []);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load sessions');
      setSessions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const revoke = async (row: AuthSessionListItem) => {
    if (!window.confirm(`Revoke session on ${row.device_name}?`)) return;
    setBusyId(row.id);
    setError(null);
    try {
      await deleteAuthSession(row.id);
      if (row.is_current) {
        onRevokedCurrentSession();
      } else {
        await load();
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not revoke session');
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-text-muted gap-2">
        <Loader2 className="animate-spin" size={20} />
        Loading sessions…
      </div>
    );
  }

  if (error && sessions.length === 0) {
    return (
      <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-6 text-red-300 text-sm">
        {error}
        <button type="button" onClick={() => void load()} className="mt-4 block text-accent hover:text-accent-hover">
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div>
        <h1 className="text-2xl font-bold text-text-primary mb-2">Sessions</h1>
        <p className="text-[14px] text-text-muted">Devices where you are signed in. Revoke any you do not recognize.</p>
      </div>

      {error ? <p className="text-sm text-amber-400/90">{error}</p> : null}

      {sessions.length === 0 ? (
        <div className="rounded-xl border border-border-default bg-card p-10 text-center text-text-muted text-sm">
          No active sessions found.
        </div>
      ) : (
        <div className="space-y-3">
          {sessions.map((s) => (
            <div
              key={s.id}
              className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-xl border border-border-subtle bg-card p-5"
            >
              <div className="flex gap-4 min-w-0">
                <div className="w-10 h-10 rounded-lg bg-accent/10 border border-accent/20 flex items-center justify-center shrink-0">
                  <Monitor size={18} className="text-accent" />
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-text-primary text-[14px] truncate">{s.device_name}</span>
                    {s.is_current ? (
                      <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">
                        This device
                      </span>
                    ) : null}
                  </div>
                  <p className="text-[12px] text-text-muted mt-1">
                    {s.platform} · {s.device_type}
                    {s.ip ? ` · ${s.ip}` : ''}
                  </p>
                  <p className="text-[11px] text-text-faint mt-1">
                    Last used {fmtDate(s.last_used_at)} · Expires {fmtDate(s.expires_at)}
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={busyId === s.id}
                onClick={() => void revoke(s)}
                className="shrink-0 inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-border-default text-text-secondary hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/20 text-xs font-bold transition-all disabled:opacity-50"
              >
                {busyId === s.id ? <Loader2 className="animate-spin" size={14} /> : <Trash2 size={14} />}
                Revoke
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
