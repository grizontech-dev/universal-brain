'use client';

import { useEffect, useRef, useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { CheckCircle2, XCircle, AlertTriangle, Loader2, LayoutDashboard, Wallet, CreditCard } from 'lucide-react';
import { getTopupStatus, fetchSubscription } from '@/lib/chat-rest-api';
import { useCredits } from '@/context/CreditContext';
import { useAuth } from '@/context/AuthContext';

type CallbackState =
  | 'verifying'
  | 'success_topup'
  | 'success_subscription'
  | 'failed'
  | 'expired'
  | 'timeout';

const MAX_ATTEMPTS = 15;
const POLL_INTERVAL = 2000;

function CallbackScreen() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { refreshBalance } = useCredits();
  const { updateUser } = useAuth();

  const type = searchParams.get('type') ?? 'topup';
  const orderId = searchParams.get('orderId') ?? '';

  const [state, setState] = useState<CallbackState>('verifying');
  const [creditsAdded, setCreditsAdded] = useState(0);
  const [planName, setPlanName] = useState('');
  const attempts = useRef(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  };

  const handleSuccess = async (extra?: { credits?: number; plan?: string }) => {
    stopPolling();
    if (extra?.credits) setCreditsAdded(extra.credits);
    if (extra?.plan) setPlanName(extra.plan);
    try {
      await refreshBalance();
    } catch {
      /* non-fatal */
    }
    if (type === 'subscription' && extra?.plan) {
      try {
        await updateUser({ subscription: extra.plan, subscriptionStatus: 'Active' });
      } catch {
        /* non-fatal */
      }
    }
    setState(type === 'topup' ? 'success_topup' : 'success_subscription');
  };

  useEffect(() => {
    if (!orderId) {
      setState('failed');
      return;
    }

    const poll = async () => {
      attempts.current += 1;

      try {
        if (type === 'topup') {
          const res = await getTopupStatus(orderId);
          if (res.status === 'completed') {
            await handleSuccess({ credits: res.creditsToAdd });
            return;
          }
          if (res.status === 'failed') { stopPolling(); setState('failed'); return; }
          if (res.status === 'expired') { stopPolling(); setState('expired'); return; }
        } else {
          const res = await fetchSubscription();
          const sub = res.subscription;
          if (sub?.status === 'active' && sub.planSnapshot?.slug !== 'free') {
            await handleSuccess({ plan: sub.planSnapshot?.name });
            return;
          }
        }
      } catch {
        /* keep polling */
      }

      if (attempts.current >= MAX_ATTEMPTS) {
        stopPolling();
        setState('timeout');
      }
    };

    void poll();
    intervalRef.current = setInterval(() => void poll(), POLL_INTERVAL);
    return stopPolling;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, type]);

  return (
    <div className="min-h-screen bg-[#09090b] flex items-center justify-center p-4">
      <div className="absolute inset-0 pointer-events-none">
        <div className={`absolute -top-40 -left-40 w-80 h-80 rounded-full blur-[120px] opacity-20 ${
          state === 'verifying' ? 'bg-indigo-500' :
          state.startsWith('success') ? 'bg-emerald-500' :
          state === 'timeout' ? 'bg-amber-500' : 'bg-red-500'
        }`} />
      </div>

      <div className="w-full max-w-md bg-white/[0.03] backdrop-blur-xl border border-white/10 rounded-[32px] p-8 text-center space-y-6 shadow-2xl relative">

        {state === 'verifying' && (
          <>
            <div className="mx-auto w-20 h-20 rounded-full bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
              <Loader2 size={36} className="text-indigo-400 animate-spin" />
            </div>
            <div className="space-y-2">
              <h1 className="text-2xl font-black text-white tracking-tight">Verifying Payment</h1>
              <p className="text-white/40 text-sm">Confirming your payment with PhonePe…</p>
            </div>
            <div className="flex gap-1 justify-center">
              {Array.from({ length: MAX_ATTEMPTS }).map((_, i) => (
                <div
                  key={i}
                  className={`h-1 rounded-full transition-all duration-300 ${
                    i < attempts.current ? 'bg-indigo-500 w-3' : 'bg-white/10 w-1.5'
                  }`}
                />
              ))}
            </div>
          </>
        )}

        {state === 'success_topup' && (
          <>
            <div className="mx-auto w-20 h-20 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shadow-[0_0_40px_rgba(16,185,129,0.15)]">
              <CheckCircle2 size={36} className="text-emerald-400" />
            </div>
            <div className="space-y-2">
              <h1 className="text-2xl font-black text-white tracking-tight">Credits Added!</h1>
              <p className="text-white/50 text-sm">
                {creditsAdded > 0 ? (
                  <><span className="text-emerald-400 font-black text-lg">{creditsAdded.toLocaleString()}</span> credits have been added to your wallet.</>
                ) : (
                  'Your credits have been added to your wallet.'
                )}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 pt-2">
              <button
                onClick={() => router.push('/brain')}
                className="flex items-center justify-center gap-2 py-3 bg-white text-gray-950 rounded-xl font-black text-sm hover:bg-gray-200 transition-all active:scale-95"
              >
                <LayoutDashboard size={15} />
                Dashboard
              </button>
              <button
                onClick={() => router.push('/settings/wallet')}
                className="flex items-center justify-center gap-2 py-3 bg-white/5 text-white/80 rounded-xl font-black text-sm hover:bg-white/10 transition-all border border-white/10 active:scale-95"
              >
                <Wallet size={15} />
                View Wallet
              </button>
            </div>
          </>
        )}

        {state === 'success_subscription' && (
          <>
            <div className="mx-auto w-20 h-20 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shadow-[0_0_40px_rgba(16,185,129,0.15)]">
              <CheckCircle2 size={36} className="text-emerald-400" />
            </div>
            <div className="space-y-2">
              <h1 className="text-2xl font-black text-white tracking-tight">Subscription Active!</h1>
              <p className="text-white/50 text-sm">
                {planName ? (
                  <>Welcome to <span className="text-indigo-400 font-black">{planName}</span>. Your subscription is now active.</>
                ) : (
                  'Your subscription has been activated successfully.'
                )}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 pt-2">
              <button
                onClick={() => router.push('/brain')}
                className="flex items-center justify-center gap-2 py-3 bg-white text-gray-950 rounded-xl font-black text-sm hover:bg-gray-200 transition-all active:scale-95"
              >
                <LayoutDashboard size={15} />
                Dashboard
              </button>
              <button
                onClick={() => router.push('/settings/billing')}
                className="flex items-center justify-center gap-2 py-3 bg-white/5 text-white/80 rounded-xl font-black text-sm hover:bg-white/10 transition-all border border-white/10 active:scale-95"
              >
                <CreditCard size={15} />
                View Billing
              </button>
            </div>
          </>
        )}

        {(state === 'failed' || state === 'expired') && (
          <>
            <div className="mx-auto w-20 h-20 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center">
              <XCircle size={36} className="text-red-400" />
            </div>
            <div className="space-y-2">
              <h1 className="text-2xl font-black text-white tracking-tight">Payment Not Completed</h1>
              <p className="text-white/40 text-sm">
                {state === 'expired'
                  ? 'The payment session has expired. No amount was charged.'
                  : 'Your payment could not be processed. No amount was charged.'}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 pt-2">
              <button
                onClick={() => router.push('/pricing')}
                className="flex items-center justify-center gap-2 py-3 bg-indigo-500 text-white rounded-xl font-black text-sm hover:bg-indigo-400 transition-all active:scale-95"
              >
                Try Again
              </button>
              <button
                onClick={() => router.push('/brain')}
                className="flex items-center justify-center gap-2 py-3 bg-white/5 text-white/70 rounded-xl font-black text-sm hover:bg-white/10 transition-all border border-white/10 active:scale-95"
              >
                Go Home
              </button>
            </div>
          </>
        )}

        {state === 'timeout' && (
          <>
            <div className="mx-auto w-20 h-20 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
              <AlertTriangle size={36} className="text-amber-400" />
            </div>
            <div className="space-y-2">
              <h1 className="text-2xl font-black text-white tracking-tight">Still Processing</h1>
              <p className="text-white/40 text-sm">
                Your payment is being confirmed by PhonePe. This may take a few minutes.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 pt-2">
              <button
                onClick={() => router.push('/settings/billing')}
                className="flex items-center justify-center gap-2 py-3 bg-indigo-500 text-white rounded-xl font-black text-sm hover:bg-indigo-400 transition-all active:scale-95"
              >
                <CreditCard size={15} />
                Check Status
              </button>
              <button
                onClick={() => router.push('/brain')}
                className="flex items-center justify-center gap-2 py-3 bg-white/5 text-white/70 rounded-xl font-black text-sm hover:bg-white/10 transition-all border border-white/10 active:scale-95"
              >
                Go Home
              </button>
            </div>
            <p className="text-[11px] text-white/20">
              Your account will update automatically once confirmed.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

export default function PaymentCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#09090b] flex items-center justify-center text-white/40">
          <Loader2 size={24} className="animate-spin" />
        </div>
      }
    >
      <CallbackScreen />
    </Suspense>
  );
}
