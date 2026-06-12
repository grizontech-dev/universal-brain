'use client';

import { useEffect, useState } from 'react';
import { Check, ArrowLeft, Loader2, X, Phone, Zap } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { fetchPlans, initiateSubscription } from '@/lib/chat-rest-api';
import { ApiError } from '@/lib/auth-api';
import type { Plan } from '@/lib/chat-contracts';

type BillingCycle = 'monthly' | 'annual';

function formatPrice(rupees: number): string {
  return `₹${rupees.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

function MobileModal({
  plan,
  billingCycle,
  onClose,
}: {
  plan: Plan;
  billingCycle: BillingCycle;
  onClose: () => void;
}) {
  const [mobile, setMobile] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await initiateSubscription({
        planId: plan.id,
        billingCycle,
        mobileNumber: mobile.trim() || undefined,
      });
      window.location.href = res.redirectUrl;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#111115] shadow-2xl animate-in fade-in slide-in-from-bottom-4 duration-300">
        <div className="flex items-center justify-between p-5 border-b border-white/5">
          <div>
            <h3 className="text-[15px] font-black text-white">Proceed to PhonePe</h3>
            <p className="text-[11px] text-white/40 mt-0.5">
              {plan.name} · {billingCycle === 'annual' ? 'Annual' : 'Monthly'} · {formatPrice(plan.pricing[billingCycle])}
            </p>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 text-white/30 hover:text-white transition-colors">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="space-y-1.5">
            <label className="text-[11px] font-black text-white/40 uppercase tracking-widest flex items-center gap-1.5">
              Mobile Number
              <span className="text-red-400">*</span>
            </label>
            <div className="flex items-center bg-white/5 border border-white/10 rounded-xl px-4 gap-3 focus-within:border-indigo-500/40 transition-colors">
              <Phone size={14} className="text-white/30 shrink-0" />
              <input
                type="tel"
                value={mobile}
                onChange={(e) => setMobile(e.target.value)}
                placeholder="e.g. 9876543210"
                maxLength={10}
                required
                className="flex-1 bg-transparent py-3 text-white text-sm font-bold outline-none placeholder:text-white/20"
              />
            </div>
            <p className="text-[10px] text-red-400/70">Required to process your UPI AutoPay payment via PhonePe.</p>
          </div>

          {error && (
            <div className="flex items-start gap-2 text-red-400 text-[12px] bg-red-400/5 border border-red-400/20 rounded-xl p-3">
              <X size={14} className="shrink-0 mt-0.5" />
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3.5 bg-indigo-500 text-white rounded-xl font-black text-[14px] hover:bg-indigo-400 disabled:opacity-50 transition-all flex items-center justify-center gap-2 active:scale-[0.98]"
          >
            {loading ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Redirecting to PhonePe…
              </>
            ) : (
              <>
                <Zap size={15} fill="currentColor" />
                Continue to Payment
              </>
            )}
          </button>

          <p className="text-[10px] text-white/20 text-center">
            Secure UPI AutoPay via PhonePe · No card stored
          </p>
        </form>
      </div>
    </div>
  );
}

export default function PricingCards() {
  const router = useRouter();
  const { user } = useAuth();

  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [billingCycle, setBillingCycle] = useState<BillingCycle>('monthly');
  const [modalPlan, setModalPlan] = useState<Plan | null>(null);

  const currentPlan = user?.subscription?.toLowerCase();
  const hasPaidPlan = currentPlan && currentPlan !== 'free';

  useEffect(() => {
    fetchPlans()
      .then((res) => setPlans(res.plans.filter((p) => p.isPublic && p.slug !== 'free')))
      .catch(() => setPlans([]))
      .finally(() => setLoading(false));
  }, []);

  const annualSaving = (plan: Plan) => {
    if (!plan.pricing.monthly || !plan.pricing.annual) return 0;
    const monthlyAnnualized = plan.pricing.monthly * 12;
    return Math.round(((monthlyAnnualized - plan.pricing.annual) / monthlyAnnualized) * 100);
  };

  return (
    <div className="py-10 bg-app text-text-primary min-h-screen relative overflow-x-hidden overflow-y-auto custom-scrollbar">
      {modalPlan && (
        <MobileModal
          plan={modalPlan}
          billingCycle={billingCycle}
          onClose={() => setModalPlan(null)}
        />
      )}


      <div className="absolute inset-x-0 -top-40 -z-10 transform-gpu overflow-hidden blur-3xl" aria-hidden="true">
        <div className="relative left-[calc(50%-11rem)] aspect-[1155/678] w-[36.125rem] -translate-x-1/2 rotate-[30deg] bg-gradient-to-tr from-purple-500/10 to-indigo-500/10 opacity-30" />
      </div>

      <div className="mx-auto max-w-7xl px-6 lg:px-8 pb-10">
        <div className="mb-6 animate-in fade-in duration-700">
          <button
            onClick={() => router.push('/chat')}
            className="flex items-center gap-2 text-[10px] font-black text-text-faint hover:text-text-primary transition-all group uppercase tracking-[0.3em] bg-surface-2 px-4 py-2 rounded-full border border-border-default"
          >
            <ArrowLeft className="w-3 h-3 transition-transform group-hover:-translate-x-1" strokeWidth={3} />
            Back
          </button>
        </div>

        <div className="mx-auto max-w-4xl text-center mb-10 sm:mb-12">
          <h2 className="text-[10px] font-black leading-7 text-indigo-400 uppercase tracking-[0.4em]">Premium Access</h2>
          <p className="mt-2 text-4xl font-black tracking-tighter text-text-primary sm:text-6xl">
            Choose your edge
          </p>
          <p className="mt-4 text-[13px] font-bold text-text-faint max-w-lg mx-auto leading-relaxed">
            Upgrade your intelligence with enterprise-grade models and more credits.
          </p>

          {/* Billing cycle toggle */}
          <div className="mt-8 inline-flex items-center bg-white/5 border border-white/10 rounded-full p-1 gap-1">
            <button
              onClick={() => setBillingCycle('monthly')}
              className={`px-5 py-1.5 rounded-full text-[12px] font-black uppercase tracking-wider transition-all ${
                billingCycle === 'monthly'
                  ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/20'
                  : 'text-white/40 hover:text-white'
              }`}
            >
              Monthly
            </button>
            <button
              onClick={() => setBillingCycle('annual')}
              className={`px-5 py-1.5 rounded-full text-[12px] font-black uppercase tracking-wider transition-all flex items-center gap-2 ${
                billingCycle === 'annual'
                  ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/20'
                  : 'text-white/40 hover:text-white'
              }`}
            >
              Annual
              <span className="text-[9px] bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded-full font-black">SAVE</span>
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-24 gap-3 text-text-muted">
            <Loader2 size={24} className="animate-spin" />
            <span className="text-[14px] font-medium">Loading plans…</span>
          </div>
        ) : plans.length === 0 ? (
          <div className="text-center py-24 text-text-muted text-sm">No plans available. Please try again later.</div>
        ) : (
          <div className={`isolate mx-auto grid max-w-md grid-cols-1 gap-y-6 lg:mx-0 lg:max-w-none gap-x-6 ${
            plans.length === 1 ? 'lg:grid-cols-1 lg:max-w-sm' :
            plans.length === 2 ? 'lg:grid-cols-2 lg:max-w-2xl' :
            'lg:grid-cols-3'
          }`}>
            {plans.map((plan, idx) => {
              const isCurrent = currentPlan === plan.slug.toLowerCase();
              const isPopular = idx === Math.floor(plans.length / 2);
              const saving = annualSaving(plan);

              return (
                <div
                  key={plan.id}
                  className={`rounded-[32px] p-6 lg:p-8 transition-all duration-500 relative flex flex-col justify-between group ${
                    isPopular
                      ? 'bg-surface-2 border-2 border-indigo-500/40 shadow-xl lg:z-20 backdrop-blur-xl'
                      : 'bg-surface-1 border border-border-subtle backdrop-blur-md'
                  }`}
                >
                  {isPopular && !isCurrent && (
                    <div className="absolute -top-3 left-0 right-0 mx-auto w-24 rounded-full bg-indigo-500 px-2 py-0.5 text-center text-[9px] font-black text-white uppercase tracking-widest shadow-lg shadow-indigo-500/20">
                      Recommended
                    </div>
                  )}
                  {isCurrent && (
                    <div className="absolute -top-3 left-0 right-0 mx-auto w-24 rounded-full bg-emerald-500 px-2 py-0.5 text-center text-[9px] font-black text-white uppercase tracking-widest">
                      Active
                    </div>
                  )}

                  <div className="space-y-6">
                    <div>
                      <h3 className="text-lg font-black leading-none text-white uppercase tracking-wider">{plan.name}</h3>
                      <div className="mt-6 flex items-baseline gap-x-1">
                        <span className="text-4xl font-black tracking-tighter text-white">
                          {formatPrice(plan.pricing[billingCycle])}
                        </span>
                        <span className="text-[11px] font-black leading-6 text-white/20 uppercase tracking-widest">
                          /{billingCycle === 'annual' ? 'yr' : 'mo'}
                        </span>
                      </div>
                      {billingCycle === 'annual' && saving > 0 && (
                        <p className="text-[11px] text-emerald-400 font-bold mt-1">Save {saving}% vs monthly</p>
                      )}
                      <p className="text-[11px] text-white/30 font-bold mt-2">
                        {plan.credits.included.toLocaleString()} credits / {billingCycle === 'annual' ? 'year' : 'month'}
                      </p>
                    </div>

                    <ul role="list" className="space-y-3 pt-6 border-t border-white/5">
                      {Object.entries(plan.featureFlags)
                        .filter(([, v]) => v)
                        .slice(0, 5)
                        .map(([key]) => (
                          <li key={key} className="flex gap-x-3 items-center group/feat">
                            <div className="w-4 h-4 rounded-full bg-indigo-500/10 flex items-center justify-center shrink-0 group-hover:bg-indigo-500/20 transition-colors">
                              <Check className="h-2.5 w-2.5 text-indigo-400" strokeWidth={3.5} />
                            </div>
                            <span className="text-[12px] font-bold text-white/40 group-hover/feat:text-white/70 transition-colors capitalize">
                              {key.replace(/_/g, ' ')}
                            </span>
                          </li>
                        ))}
                      {plan.credits.topupEnabled && (
                        <li className="flex gap-x-3 items-center group/feat">
                          <div className="w-4 h-4 rounded-full bg-indigo-500/10 flex items-center justify-center shrink-0">
                            <Check className="h-2.5 w-2.5 text-indigo-400" strokeWidth={3.5} />
                          </div>
                          <span className="text-[12px] font-bold text-white/40">Credit top-ups available</span>
                        </li>
                      )}
                    </ul>
                  </div>

                  <button
                    onClick={() => {
                      if (isCurrent) return;
                      if (hasPaidPlan) {
                        router.push('/settings/billing');
                      } else {
                        setModalPlan(plan);
                      }
                    }}
                    disabled={isCurrent}
                    className={`mt-10 block rounded-2xl px-3 py-4 text-center text-[13px] font-black tracking-tight transition-all active:scale-95 shadow-xl ${
                      isCurrent
                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 cursor-not-allowed opacity-50'
                        : hasPaidPlan
                        ? 'bg-white/5 text-white/60 hover:bg-white/10 hover:text-white border border-white/10'
                        : isPopular
                        ? 'bg-indigo-500 text-white hover:bg-indigo-400 shadow-indigo-500/20'
                        : 'bg-white/5 text-white/60 hover:bg-white/10 hover:text-white border border-white/10'
                    }`}
                  >
                    {isCurrent ? 'Current Plan' : hasPaidPlan ? 'Manage Plan' : `Join ${plan.name}`}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
