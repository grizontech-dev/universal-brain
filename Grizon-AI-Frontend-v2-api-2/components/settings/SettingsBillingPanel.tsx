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
        <h1 className="text-2xl font-bold text-text-primary mb-2 font-display">Billing & Subscription</h1>
        <p className="text-[14px] text-text-muted font-sans">Manage your plan, payment method, and billing history.</p>
      </div>

      {/* Current Plan Card */}
      <div className="bg-surface-2 border border-border-default rounded-3xl p-6 lg:p-8 relative overflow-hidden shadow-lg">
        <div className="absolute top-0 right-0 p-8 opacity-[0.05] pointer-events-none">
          <Zap className="w-28 h-28 text-accent" fill="currentColor" />
        </div>

        {subLoading ? (
          <div className="flex items-center gap-3 text-text-muted">
            <Loader2 size={18} className="animate-spin text-accent" />
            <span className="text-sm font-sans">Loading subscription…</span>
          </div>
        ) : subError ? (
          <div className="flex items-center gap-3 text-danger text-sm font-sans">
            <XCircle size={16} />
            {subError}
          </div>
        ) : isFree ? (
          /* Free Plan State */
          <div className="space-y-6 relative z-10">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="space-y-2">
                <div className="px-3 py-1 bg-surface-3 text-text-muted text-[10px] font-bold uppercase rounded-full border border-border-subtle tracking-widest w-fit font-sans">
                  Free Plan
                </div>
                <h2 className="text-3xl font-bold text-text-primary tracking-tight font-display">No active subscription</h2>
                <p className="text-[13px] text-text-muted font-sans">Upgrade to unlock premium AI models and more credits.</p>
              </div>
              <button
                onClick={() => router.push('/pricing')}
                className="flex items-center justify-center gap-2 px-6 py-3 bg-accent text-white border border-accent rounded-full font-semibold text-sm hover:brightness-110 transition-all active:scale-95 shadow-md shadow-accent/25 whitespace-nowrap cursor-pointer"
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
                  <div className="px-2.5 py-0.5 bg-accent/10 text-accent text-[9px] font-black uppercase rounded-full border border-accent/20 tracking-widest">
                    {sub?.billingCycle === 'annual' ? 'Annual' : 'Monthly'}
                  </div>
                  {isCancelling && (
                    <div className="px-2.5 py-0.5 bg-warning/10 text-warning text-[9px] font-black uppercase rounded-full border border-warning/20 tracking-widest">
                      Cancels at period end
                    </div>
                  )}
                </div>
                <h2 className="text-4xl font-bold text-text-primary tracking-tight capitalize font-display">
                  {sub?.planSnapshot?.name ?? 'Pro'}
                </h2>
                <div className="flex items-center gap-6 text-[12px] text-text-muted font-medium font-sans">
                  <div className="flex items-center gap-1.5">
                    <CheckCircle2 size={12} className="text-success" />
                    {sub?.planSnapshot?.credits?.included?.toLocaleString() ?? '—'} credits / cycle
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Calendar size={12} className="text-accent" />
                    {isCancelling ? 'Cancels' : 'Renews'}{' '}
                    {sub?.currentPeriodEnd ? formatDate(sub.currentPeriodEnd) : '—'}
                  </div>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-2 shrink-0">
                <button
                  onClick={() => router.push('/pricing')}
                  className="px-5 py-2.5 bg-accent border border-accent text-white rounded-full font-semibold text-[13px] hover:brightness-110 transition-all active:scale-95 shadow-md cursor-pointer"
                >
                  Change Plan
                </button>

                {isActive && !isCancelling && cancelState === 'idle' && (
                  <button
                    onClick={() => setCancelState('confirm')}
                    className="px-5 py-2.5 bg-surface-3 text-text-secondary rounded-full font-semibold text-[13px] hover:text-text-primary hover:bg-surface-4 transition-all border border-border-subtle active:scale-95 cursor-pointer"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </div>

            {/* Cancel confirmation */}
            {cancelState === 'confirm' && (
              <div className="border border-border-default rounded-2xl p-5 bg-surface-3/50 space-y-4 animate-in fade-in slide-in-from-top-2 duration-200">
                <p className="text-[13px] text-text-secondary font-medium font-sans">Choose how you'd like to cancel:</p>
                <div className="flex flex-col sm:flex-row gap-3">
                  <button
                    onClick={() => handleCancel(false)}
                    className="flex-1 px-4 py-3 bg-surface-2 border border-border-default text-text-primary rounded-xl font-bold text-[13px] hover:bg-surface-3 transition-all text-left space-y-0.5"
                  >
                    <div className="font-bold text-text-primary text-sm">Cancel at Period End</div>
                    <div className="text-[11px] text-text-muted">Access continues until {sub?.currentPeriodEnd ? formatDate(sub.currentPeriodEnd) : 'renewal date'}</div>
                  </button>
                  <button
                    onClick={() => handleCancel(true)}
                    className="flex-1 px-4 py-3 bg-danger/10 border border-danger/20 text-danger rounded-xl font-bold text-[13px] hover:bg-danger/20 transition-all text-left space-y-0.5"
                  >
                    <div className="font-bold text-sm">Cancel Immediately</div>
                    <div className="text-[11px] text-danger/80">Subscription ends now</div>
                  </button>
                </div>
                <button
                  onClick={() => setCancelState('idle')}
                  className="text-[12px] text-text-muted hover:text-text-primary transition-colors font-sans"
                >
                  Keep my subscription
                </button>
              </div>
            )}

            {cancelState === 'loading' && (
              <div className="flex items-center gap-2 text-text-muted text-sm font-sans">
                <Loader2 size={14} className="animate-spin text-accent" />
                Processing cancellation…
              </div>
            )}

            {cancelState === 'done' && (
              <div className="flex items-center gap-2 text-success text-sm font-sans">
                <CheckCircle2 size={14} />
                Cancellation processed successfully.
              </div>
            )}

            {cancelState === 'error' && cancelError && (
              <div className="flex items-center gap-2 text-danger text-sm font-sans">
                <XCircle size={14} />
                {cancelError}
                <button onClick={() => setCancelState('idle')} className="underline ml-1">Dismiss</button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Payment Method Card */}
      <div className="bg-surface-2 border border-border-default rounded-2xl p-6 flex flex-col sm:flex-row items-start sm:items-center gap-4 shadow-md">
        <div className="w-12 h-12 rounded-xl bg-accent/10 flex items-center justify-center border border-accent/20 shrink-0">
          <CreditCard size={22} className="text-accent" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[11px] font-bold text-text-muted uppercase tracking-wider mb-1 font-sans">Payment Method</div>
          <p className="text-text-primary font-bold text-[15px] font-display">PhonePe UPI AutoPay</p>
          <p className="text-[12px] text-text-muted mt-0.5 font-sans">We do not store your payment details. Mandate is managed securely by PhonePe.</p>
        </div>
        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-success/10 border border-success/20 rounded-full shrink-0">
          <ShieldCheck size={13} className="text-success" />
          <span className="text-[10px] font-bold text-success uppercase tracking-widest">PCI DSS</span>
        </div>
      </div>

      {/* Payment History Card */}
      <div className="bg-surface-2 border border-border-default rounded-2xl p-6 space-y-4 shadow-md">
        <div className="flex items-center justify-between">
          <h3 className="text-[11px] font-bold text-text-muted uppercase tracking-wider font-sans">Payment History</h3>
          <button
            onClick={() => router.push('/settings/wallet')}
            className="flex items-center gap-1 text-[11px] font-bold text-accent hover:text-accent-hover uppercase tracking-wider transition-colors cursor-pointer"
          >
            View all <ChevronRight size={12} />
          </button>
        </div>

        {txnLoading ? (
          <div className="flex items-center gap-2 text-text-muted text-sm py-4 font-sans">
            <Loader2 size={14} className="animate-spin text-accent" /> Loading…
          </div>
        ) : txns.length === 0 ? (
          <div className="py-8 text-center">
            <AlertTriangle size={24} className="text-text-faint mx-auto mb-2" />
            <p className="text-[13px] text-text-muted font-sans">No payment history yet.</p>
          </div>
        ) : (
          <div className="space-y-0">
            {txns.map((tx) => (
              <div
                key={tx.id}
                className="flex items-center justify-between py-3.5 border-b border-border-subtle last:border-0"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-lg bg-surface-3 flex items-center justify-center shrink-0">
                    <Zap size={14} className="text-accent" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[13.5px] text-text-primary font-bold truncate capitalize font-sans">
                      {tx.type === 'topup' ? 'Credit Top-up' : tx.type === 'grant' ? 'Plan Credits' : tx.type}
                    </p>
                    <p className="text-[11px] text-text-muted font-medium font-sans">
                      {new Date(tx.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-[13.5px] font-bold text-text-primary font-mono">
                    {tx.type === 'deduct' ? '-' : '+'}{Math.abs(tx.amount).toLocaleString()} cr
                  </span>
                  <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${
                    tx.type === 'deduct' ? 'bg-danger/10 text-danger border border-danger/20' : 'bg-success/10 text-success border border-success/20'
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

