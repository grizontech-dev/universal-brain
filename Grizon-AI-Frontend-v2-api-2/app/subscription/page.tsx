'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  CheckCircle2,
  ChevronRight,
  CreditCard,
  LayoutDashboard,
  Zap,
  Calendar,
  Loader2,
  XCircle,
  ArrowUpCircle,
  ShieldCheck,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { fetchSubscription, cancelSubscription } from '@/lib/chat-rest-api';
import { ApiError } from '@/lib/auth-api';
import type { SubscriptionResponse } from '@/lib/chat-contracts';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

type CancelState = 'idle' | 'confirm' | 'loading' | 'done' | 'error';

export default function SubscriptionPage() {
  const router = useRouter();
  const [sub, setSub] = useState<SubscriptionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancelState, setCancelState] = useState<CancelState>('idle');
  const [cancelError, setCancelError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchSubscription();
      setSub(res.subscription);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load subscription');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleCancel = async (immediate: boolean) => {
    setCancelState('loading');
    setCancelError(null);
    try {
      await cancelSubscription({ immediate });
      setCancelState('done');
      await load();
    } catch (e) {
      setCancelError(e instanceof ApiError ? e.message : 'Cancellation failed');
      setCancelState('error');
    }
  };

  const isFree = !sub || sub.planSnapshot?.slug === 'free' || sub.planSnapshot?.name?.toLowerCase() === 'free';
  const isActive = sub?.status === 'active';
  const isCancelling = sub?.cancelAtPeriodEnd === true;

  const statusColors: Record<string, { label: string; color: string; bg: string; border: string }> = {
    active: { label: 'Active', color: 'text-emerald-400', bg: 'bg-emerald-400/10', border: 'border-emerald-400/20' },
    past_due: { label: 'Past Due', color: 'text-amber-400', bg: 'bg-amber-400/10', border: 'border-amber-400/20' },
    cancelled: { label: 'Cancelled', color: 'text-red-400', bg: 'bg-red-400/10', border: 'border-red-400/20' },
    paused: { label: 'Paused', color: 'text-blue-400', bg: 'bg-blue-400/10', border: 'border-blue-400/20' },
  };
  const st = statusColors[sub?.status ?? 'active'] ?? statusColors.active;

  return (
    <div className="min-h-screen bg-app py-16 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">

        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-3xl font-black text-text-primary tracking-tight sm:text-4xl">Billing & Subscription</h1>
            <p className="text-text-muted font-medium">Manage your plan, billing history, and payment methods.</p>
          </div>
          <button
            onClick={() => router.push('/chat')}
            className="flex items-center justify-center gap-2 bg-indigo-500 text-text-primary rounded-xl py-3 px-6 font-bold hover:bg-indigo-400 transition-all active:scale-95 shadow-xl shadow-indigo-500/20"
          >
            <LayoutDashboard size={18} />
            Dashboard
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Plan Card */}
          <div className="lg:col-span-2 bg-card border border-border-default rounded-3xl p-8 relative overflow-hidden group shadow-[0_30px_100px_rgba(0,0,0,0.4)]">
            <div className="absolute top-0 right-0 p-8 flex flex-col items-end">
              <Zap className="w-12 h-12 text-indigo-500 opacity-20 mb-2" fill="currentColor" />
            </div>

            {loading ? (
              <div className="flex items-center gap-3 text-white/40 py-8">
                <Loader2 size={20} className="animate-spin" />
                Loading subscription…
              </div>
            ) : error ? (
              <div className="flex items-center gap-2 text-red-400 text-sm py-8">
                <XCircle size={16} /> {error}
              </div>
            ) : isFree ? (
              <div className="space-y-6 relative z-10">
                <div className="flex items-center gap-4">
                  <div className="w-16 h-16 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
                    <Zap className="w-8 h-8 text-indigo-400" fill="currentColor" />
                  </div>
                  <div>
                    <p className="text-[11px] font-black text-white/30 uppercase tracking-[0.2em] mb-1">Current Membership</p>
                    <h2 className="text-4xl font-black text-white leading-none">Free</h2>
                  </div>
                </div>
                <button
                  onClick={() => router.push('/pricing')}
                  className="flex items-center gap-2 bg-indigo-500 text-white rounded-2xl py-4 px-6 font-bold hover:bg-indigo-400 transition-all active:scale-95"
                >
                  <ArrowUpCircle size={18} />
                  Upgrade Now
                </button>
              </div>
            ) : (
              <div className="space-y-6 relative z-10">
                <div className="flex items-center gap-4">
                  <div className="w-16 h-16 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
                    <Zap className="w-8 h-8 text-indigo-400" fill="currentColor" />
                  </div>
                  <div>
                    <p className="text-[11px] font-black text-white/30 uppercase tracking-[0.2em] mb-1">Current Membership</p>
                    <h2 className="text-4xl font-black text-white leading-none">{sub?.planSnapshot?.name}</h2>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 py-6 border-y border-white/5">
                  <div className="flex flex-col gap-1.5">
                    <div className={`flex items-center gap-2 text-[10px] font-black ${st.color} uppercase tracking-widest`}>
                      <CheckCircle2 size={12} />
                      Status
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-white font-bold`}>{st.label}</span>
                      {isCancelling && (
                        <span className="text-[9px] font-black text-amber-400 bg-amber-400/10 border border-amber-400/20 px-1.5 py-0.5 rounded-full uppercase tracking-widest">
                          Cancels at end
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center gap-2 text-white/40 text-[10px] font-black uppercase tracking-widest">
                      <Calendar size={12} className="text-blue-400" />
                      {isCancelling ? 'Cancels On' : 'Renews On'}
                    </div>
                    <p className="text-white font-bold">
                      {sub?.currentPeriodEnd ? formatDate(sub.currentPeriodEnd) : '—'}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-3 pt-2">
                  <button
                    onClick={() => router.push('/pricing')}
                    className="flex-1 bg-white text-gray-950 rounded-2xl py-4 font-bold hover:bg-gray-200 transition-all shadow-xl shadow-white/5 active:scale-95"
                  >
                    Change Plan
                  </button>

                  {isActive && !isCancelling && cancelState === 'idle' && (
                    <button
                      onClick={() => setCancelState('confirm')}
                      className="flex-1 bg-white/5 text-white/80 rounded-2xl py-4 font-bold hover:bg-white/10 transition-all border border-white/5 active:scale-95"
                    >
                      Cancel Subscription
                    </button>
                  )}
                </div>

                {cancelState === 'confirm' && (
                  <div className="border border-white/10 rounded-2xl p-5 bg-white/[0.02] space-y-4 animate-in fade-in duration-200">
                    <p className="text-[13px] text-white/60 font-medium">Choose how you'd like to cancel:</p>
                    <div className="flex flex-col sm:flex-row gap-3">
                      <button
                        onClick={() => handleCancel(false)}
                        className="flex-1 px-4 py-3 bg-white/5 border border-white/10 text-white/80 rounded-xl font-bold text-[13px] hover:bg-white/10 transition-all text-left"
                      >
                        <div className="font-black text-white text-sm">Cancel at Period End</div>
                        <div className="text-[11px] text-white/30 mt-0.5">Access until {sub?.currentPeriodEnd ? formatDate(sub.currentPeriodEnd) : 'renewal'}</div>
                      </button>
                      <button
                        onClick={() => handleCancel(true)}
                        className="flex-1 px-4 py-3 bg-red-500/5 border border-red-500/20 text-red-400 rounded-xl font-bold text-[13px] hover:bg-red-500/10 transition-all text-left"
                      >
                        <div className="font-black text-sm">Cancel Immediately</div>
                        <div className="text-[11px] text-red-400/60 mt-0.5">Ends now</div>
                      </button>
                    </div>
                    <button onClick={() => setCancelState('idle')} className="text-[12px] text-white/30 hover:text-white/60 transition-colors">
                      Keep my subscription
                    </button>
                  </div>
                )}

                {cancelState === 'loading' && (
                  <div className="flex items-center gap-2 text-white/40 text-sm">
                    <Loader2 size={14} className="animate-spin" /> Processing…
                  </div>
                )}

                {cancelState === 'done' && (
                  <div className="flex items-center gap-2 text-emerald-400 text-sm">
                    <CheckCircle2 size={14} /> Cancellation processed.
                  </div>
                )}

                {cancelState === 'error' && cancelError && (
                  <div className="flex items-center gap-2 text-red-400 text-sm">
                    <XCircle size={14} /> {cancelError}
                    <button onClick={() => setCancelState('idle')} className="underline ml-1 text-xs">Dismiss</button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            <div className="bg-gray-900/50 border border-white/5 rounded-3xl p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-black text-white/30 uppercase tracking-widest">Payment</h3>
                <ShieldCheck size={16} className="text-emerald-400 opacity-50" />
              </div>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center shrink-0">
                  <CreditCard size={18} className="text-indigo-400" />
                </div>
                <div>
                  <p className="text-white text-[13px] font-bold">PhonePe UPI AutoPay</p>
                  <p className="text-white/30 text-[11px]">No stored card details</p>
                </div>
              </div>
              <div className="pt-1">
                <span className="text-[10px] font-black text-white/20 uppercase tracking-widest border border-white/5 px-2 py-1 rounded-md">
                  PCI DSS Compliant
                </span>
              </div>
            </div>

            <div className="bg-card/50 border border-border-subtle rounded-3xl p-6 space-y-4">
              <h3 className="text-sm font-black text-text-faint uppercase tracking-widest">Quick Links</h3>
              <div className="space-y-2">
                {[
                  { label: 'View Wallet & Credits', href: '/settings/wallet' },
                  { label: 'Billing Details', href: '/settings/billing' },
                  { label: 'Change Plan', href: '/pricing' },
                ].map((link) => (
                  <button
                    key={link.href}
                    onClick={() => router.push(link.href)}
                    className="w-full flex items-center justify-between py-2.5 px-1 group hover:opacity-80 transition-opacity"
                  >
                    <span className="text-text-secondary text-[12px] font-bold">{link.label}</span>
                    <ChevronRight size={14} className="text-text-faint group-hover:text-indigo-400 transition-colors" />
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
