'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Zap,
  CheckCircle2,
  Calendar,
  CreditCard,
  ShieldCheck,
  ChevronRight,
  Loader2,
  AlertTriangle,
  ArrowUpCircle,
  XCircle,
} from 'lucide-react';
import {
  fetchSubscription,
  fetchWalletTransactions,
  cancelSubscription,
} from '@/lib/chat-rest-api';
import { ApiError } from '@/lib/auth-api';
import type { SubscriptionResponse } from '@/lib/chat-contracts';
import type { WalletTransactionDto } from '@/types/settings-api';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function formatAmount(paise: number): string {
  return `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 0 })}`;
}

type CancelState = 'idle' | 'confirm' | 'loading' | 'done' | 'error';

export default function SettingsBillingPanel() {
  const router = useRouter();

  const [sub, setSub] = useState<SubscriptionResponse | null>(null);
  const [subLoading, setSubLoading] = useState(true);
  const [subError, setSubError] = useState<string | null>(null);

  const [txns, setTxns] = useState<WalletTransactionDto[]>([]);
  const [txnLoading, setTxnLoading] = useState(true);

  const [cancelState, setCancelState] = useState<CancelState>('idle');
  const [cancelError, setCancelError] = useState<string | null>(null);

  const loadSubscription = useCallback(async () => {
    setSubLoading(true);
    setSubError(null);
    try {
      const res = await fetchSubscription();
      setSub(res.subscription);
    } catch (e) {
      setSubError(e instanceof ApiError ? e.message : 'Failed to load subscription');
    } finally {
      setSubLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSubscription();
  }, [loadSubscription]);

  useEffect(() => {
    setTxnLoading(true);
    fetchWalletTransactions({ page_size: 5 })
      .then((r) => setTxns(r.transactions ?? []))
      .catch(() => setTxns([]))
      .finally(() => setTxnLoading(false));
  }, []);

  const handleCancel = async (immediate: boolean) => {
    setCancelState('loading');
    setCancelError(null);
    try {
      await cancelSubscription({ immediate });
      setCancelState('done');
      await loadSubscription();
    } catch (e) {
      setCancelError(e instanceof ApiError ? e.message : 'Cancellation failed');
      setCancelState('error');
    }
  };

  const isFree = !sub || sub.planSnapshot?.slug === 'free' || sub.planSnapshot?.name?.toLowerCase() === 'free';
  const isActive = sub?.status === 'active';
  const isCancelling = sub?.cancelAtPeriodEnd === true;

  const statusConfig = {
    active: { label: 'Active', color: 'text-emerald-400', bg: 'bg-emerald-400/10', border: 'border-emerald-400/20' },
    past_due: { label: 'Past Due', color: 'text-amber-400', bg: 'bg-amber-400/10', border: 'border-amber-400/20' },
    cancelled: { label: 'Cancelled', color: 'text-red-400', bg: 'bg-red-400/10', border: 'border-red-400/20' },
    paused: { label: 'Paused', color: 'text-blue-400', bg: 'bg-blue-400/10', border: 'border-blue-400/20' },
  } as const;

  const status = (sub?.status ?? 'active') as keyof typeof statusConfig;
  const { label: statusLabel, color: statusColor, bg: statusBg, border: statusBorder } = statusConfig[status] ?? statusConfig.active;

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 duration-300 space-y-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white mb-2">Billing & Subscription</h1>
        <p className="text-[14px] text-white/40">Manage your plan, payment method, and billing history.</p>
      </div>

      {/* Current Plan Card */}
      <div className="bg-[#0c0c0e] border border-white/5 rounded-[28px] p-6 lg:p-8 relative overflow-hidden">
        <div className="absolute top-0 right-0 p-8 opacity-[0.03] pointer-events-none">
          <Zap className="w-28 h-28 text-purple-400" fill="currentColor" />
        </div>

        {subLoading ? (
          <div className="flex items-center gap-3 text-white/40">
            <Loader2 size={18} className="animate-spin" />
            <span className="text-sm">Loading subscription…</span>
          </div>
        ) : subError ? (
          <div className="flex items-center gap-3 text-red-400 text-sm">
            <XCircle size={16} />
            {subError}
          </div>
        ) : isFree ? (
          /* Free Plan State */
          <div className="space-y-6 relative z-10">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="space-y-2">
                <div className="px-2.5 py-0.5 bg-white/5 text-white/30 text-[9px] font-black uppercase rounded-full border border-white/10 tracking-widest w-fit">
                  Free Plan
                </div>
                <h2 className="text-3xl font-black text-white tracking-tighter">No active subscription</h2>
                <p className="text-[13px] text-white/40">Upgrade to unlock premium AI models and more credits.</p>
              </div>
              <button
                onClick={() => router.push('/pricing')}
                className="flex items-center gap-2 px-6 py-3 bg-indigo-500 text-white rounded-xl font-black text-sm hover:bg-indigo-400 transition-all active:scale-95 shadow-lg shadow-indigo-500/20 whitespace-nowrap"
              >
                <ArrowUpCircle size={16} />
                Upgrade Now
              </button>
            </div>
          </div>
        ) : (
          /* Paid Plan State */
          <div className="space-y-6 relative z-10">
            <div className="flex flex-col md:flex-row md:items-start justify-between gap-6">
              <div className="space-y-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <div className={`px-2.5 py-0.5 ${statusBg} ${statusColor} text-[9px] font-black uppercase rounded-full border ${statusBorder} tracking-widest`}>
                    {statusLabel}
                  </div>
                  <div className="px-2.5 py-0.5 bg-purple-500/10 text-purple-400 text-[9px] font-black uppercase rounded-full border border-purple-500/20 tracking-widest">
                    {sub?.billingCycle === 'annual' ? 'Annual' : 'Monthly'}
                  </div>
                  {isCancelling && (
                    <div className="px-2.5 py-0.5 bg-amber-400/10 text-amber-400 text-[9px] font-black uppercase rounded-full border border-amber-400/20 tracking-widest">
                      Cancels at period end
                    </div>
                  )}
                </div>
                <h2 className="text-4xl font-black text-white tracking-tighter capitalize">
                  {sub?.planSnapshot?.name ?? 'Pro'}
                </h2>
                <div className="flex items-center gap-6 text-[12px] text-white/40 font-medium">
                  <div className="flex items-center gap-1.5">
                    <CheckCircle2 size={12} className="text-emerald-400" />
                    {sub?.planSnapshot?.credits?.included?.toLocaleString() ?? '—'} credits / cycle
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Calendar size={12} className="text-blue-400" />
                    {isCancelling ? 'Cancels' : 'Renews'}{' '}
                    {sub?.currentPeriodEnd ? formatDate(sub.currentPeriodEnd) : '—'}
                  </div>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-2 shrink-0">
                <button
                  onClick={() => router.push('/pricing')}
                  className="px-5 py-2.5 bg-white text-gray-950 rounded-xl font-black text-[13px] hover:bg-gray-200 transition-all active:scale-95"
                >
                  Change Plan
                </button>

                {isActive && !isCancelling && cancelState === 'idle' && (
                  <button
                    onClick={() => setCancelState('confirm')}
                    className="px-5 py-2.5 bg-white/5 text-white/50 rounded-xl font-black text-[13px] hover:bg-white/10 hover:text-white transition-all border border-white/10 active:scale-95"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </div>

            {/* Cancel confirmation */}
            {cancelState === 'confirm' && (
              <div className="border border-white/10 rounded-2xl p-5 bg-white/[0.02] space-y-4 animate-in fade-in slide-in-from-top-2 duration-200">
                <p className="text-[13px] text-white/60 font-medium">Choose how you'd like to cancel:</p>
                <div className="flex flex-col sm:flex-row gap-3">
                  <button
                    onClick={() => handleCancel(false)}
                    className="flex-1 px-4 py-3 bg-white/5 border border-white/10 text-white/80 rounded-xl font-bold text-[13px] hover:bg-white/10 transition-all text-left space-y-0.5"
                  >
                    <div className="font-black text-white text-sm">Cancel at Period End</div>
                    <div className="text-[11px] text-white/30">Access continues until {sub?.currentPeriodEnd ? formatDate(sub.currentPeriodEnd) : 'renewal date'}</div>
                  </button>
                  <button
                    onClick={() => handleCancel(true)}
                    className="flex-1 px-4 py-3 bg-red-500/5 border border-red-500/20 text-red-400 rounded-xl font-bold text-[13px] hover:bg-red-500/10 transition-all text-left space-y-0.5"
                  >
                    <div className="font-black text-sm">Cancel Immediately</div>
                    <div className="text-[11px] text-red-400/60">Subscription ends now</div>
                  </button>
                </div>
                <button
                  onClick={() => setCancelState('idle')}
                  className="text-[12px] text-white/30 hover:text-white/60 transition-colors"
                >
                  Keep my subscription
                </button>
              </div>
            )}

            {cancelState === 'loading' && (
              <div className="flex items-center gap-2 text-white/40 text-sm">
                <Loader2 size={14} className="animate-spin" />
                Processing cancellation…
              </div>
            )}

            {cancelState === 'done' && (
              <div className="flex items-center gap-2 text-emerald-400 text-sm">
                <CheckCircle2 size={14} />
                Cancellation processed successfully.
              </div>
            )}

            {cancelState === 'error' && cancelError && (
              <div className="flex items-center gap-2 text-red-400 text-sm">
                <XCircle size={14} />
                {cancelError}
                <button onClick={() => setCancelState('idle')} className="underline ml-1">Dismiss</button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Payment Method Card */}
      <div className="bg-[#0c0c0e] border border-white/5 rounded-2xl p-6 flex flex-col sm:flex-row items-start sm:items-center gap-4">
        <div className="w-12 h-12 rounded-xl bg-indigo-500/10 flex items-center justify-center border border-indigo-500/20 shrink-0">
          <CreditCard size={22} className="text-indigo-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[11px] font-black text-white/20 uppercase tracking-widest mb-1">Payment Method</div>
          <p className="text-white font-bold text-[14px]">PhonePe UPI AutoPay</p>
          <p className="text-[12px] text-white/30 mt-0.5">We do not store your payment details. Mandate is managed securely by PhonePe.</p>
        </div>
        <div className="flex items-center gap-1.5 px-3 py-1 bg-emerald-400/5 border border-emerald-400/10 rounded-lg shrink-0">
          <ShieldCheck size={12} className="text-emerald-400" />
          <span className="text-[9px] font-black text-emerald-400/70 uppercase tracking-widest">PCI DSS</span>
        </div>
      </div>

      {/* Payment History */}
      <div className="bg-[#0c0c0e] border border-white/5 rounded-2xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-[11px] font-black text-white/30 uppercase tracking-widest">Payment History</h3>
          <button
            onClick={() => router.push('/settings/wallet')}
            className="flex items-center gap-1 text-[10px] font-black text-indigo-400 hover:text-indigo-300 uppercase tracking-wider transition-colors"
          >
            View all <ChevronRight size={12} />
          </button>
        </div>

        {txnLoading ? (
          <div className="flex items-center gap-2 text-white/30 text-sm py-4">
            <Loader2 size={14} className="animate-spin" /> Loading…
          </div>
        ) : txns.length === 0 ? (
          <div className="py-8 text-center">
            <AlertTriangle size={24} className="text-white/10 mx-auto mb-2" />
            <p className="text-[13px] text-white/20">No payment history yet.</p>
          </div>
        ) : (
          <div className="space-y-0">
            {txns.map((tx) => (
              <div
                key={tx.id}
                className="flex items-center justify-between py-3.5 border-b border-white/[0.04] last:border-0"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center shrink-0">
                    <Zap size={14} className="text-indigo-400" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[13px] text-white font-bold truncate capitalize">
                      {tx.type === 'topup' ? 'Credit Top-up' : tx.type === 'grant' ? 'Plan Credits' : tx.type}
                    </p>
                    <p className="text-[10px] text-white/25 font-medium">
                      {new Date(tx.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-[13px] font-black text-white">
                    {tx.type === 'deduct' ? '-' : '+'}{Math.abs(tx.amount).toLocaleString()} cr
                  </span>
                  <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded ${
                    tx.type === 'deduct' ? 'bg-red-400/10 text-red-400' : 'bg-emerald-400/10 text-emerald-400'
                  }`}>
                    {tx.type === 'deduct' ? 'Spent' : 'Received'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
