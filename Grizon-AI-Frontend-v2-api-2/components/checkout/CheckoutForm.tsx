"use client";
import { useState, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { CheckCircle2, CreditCard, Loader2, ShieldCheck, Zap, History, ChevronRight, Check } from "lucide-react";
import { useAuth } from "@/context/AuthContext";

const planDetails: Record<string, { price: number; name: string; features: string[] }> = {
  basic: {
    price: 9,
    name: "Basic Plan",
    features: ["Up to 10 projects", "Basic analytics", "24-hour support response time"]
  },
  pro: {
    price: 29,
    name: "Pro Plan",
    features: ["Unlimited projects", "Advanced analytics", "1-hour support response time"]
  },
  premium: {
    price: 99,
    name: "Premium Plan",
    features: ["Everything in Pro", "Dedicated account manager", "Custom integrations"]
  }
};

export default function CheckoutForm() {
  const router = useRouter();
  const { updateUser } = useAuth();
  const searchParams = useSearchParams();
  const planParam = searchParams.get("plan") || "pro";
  
  const [selectedPlan, setSelectedPlan] = useState(planDetails[planParam] || planDetails.pro);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  useEffect(() => {
    if (planParam && planDetails[planParam]) {
      setSelectedPlan(planDetails[planParam]);
    }
  }, [planParam]);

  const tax = selectedPlan.price * 0.1;
  const total = selectedPlan.price + tax;

  const handlePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsProcessing(true);
    
    setTimeout(async () => {
      try {
        await updateUser({ 
          subscription: planParam,
          subscriptionStatus: 'Active',
          subscriptionExpiry: 'Jan 5, 2026'
        });
        setIsProcessing(false);
        setIsSuccess(true);
      } catch (err) {
        console.error("Failed to update subscription:", err);
        setIsProcessing(false);
      }
    }, 2000);
  };

  if (isSuccess) {
    return (
      <div className="min-h-screen bg-app flex flex-col items-center justify-center p-6 selection:bg-emerald-500/30 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 via-transparent to-transparent pointer-events-none" />
        <div className="bg-surface-2 backdrop-blur-2xl border border-border-default rounded-[32px] p-10 max-w-md w-full text-center space-y-6 shadow-2xl animate-in zoom-in duration-700 relative overflow-hidden">
          <div className="mx-auto flex items-center justify-center h-20 w-20 rounded-full bg-emerald-500/10 border border-emerald-500/20 shadow-[0_0_50px_rgba(16,185,129,0.1)]">
            <CheckCircle2 className="h-10 w-10 text-emerald-500" strokeWidth={2.5} />
          </div>
          <div className="space-y-2">
            <h2 className="text-3xl font-black text-text-primary tracking-tighter">Upgrade Success</h2>
            <p className="text-text-muted font-bold text-sm leading-relaxed">
              Your account is now active on the <span className="text-emerald-400">{selectedPlan.name}</span>.
            </p>
          </div>
          <div className="pt-4 space-y-3">
            <button 
              onClick={() => router.push('/chat')}
              className="w-full bg-white text-gray-950 h-12 rounded-xl font-black text-sm hover:bg-gray-200 transition-all active:scale-95"
            >
              Go to Dashboard
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-app text-text-primary font-sans selection:bg-indigo-500/30 overflow-x-hidden">
      <div className="max-w-[1100px] mx-auto px-6 py-4 lg:py-6">
        
        {/* Header - Premium Compact Header */}
        <div className="mb-6 flex flex-col sm:flex-row sm:items-end justify-between border-b border-border-default pb-4 animate-in fade-in slide-in-from-top-4 duration-500">
          <div className="space-y-0.5">
            <button 
              onClick={() => router.push('/pricing')}
              className="flex items-center gap-1.5 text-[10px] font-black text-indigo-400 hover:text-indigo-300 transition-all mb-1 group uppercase tracking-[0.2em]"
            >
              <svg className="w-3 h-3 transition-transform group-hover:-translate-x-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path d="M15 19l-7-7 7-7" />
              </svg>
              Pricing
            </button>
            <h1 className="text-3xl font-black tracking-tighter text-text-primary">Upgrade Account</h1>
          </div>
          <div className="flex items-center gap-2.5 text-emerald-400/80 bg-emerald-400/5 px-3 py-1.5 rounded-full border border-emerald-400/10 backdrop-blur-md hidden md:flex animate-pulse">
            <ShieldCheck size={12} strokeWidth={3} />
            <span className="text-[9px] font-black uppercase tracking-widest leading-none">Secure Session</span>
          </div>
        </div>
 
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-8 items-start relative">
          
          {/* Main Column: Interactive Form */}
          <div className="space-y-6 animate-in fade-in slide-in-from-left-6 duration-700 delay-100">
            {/* Unified Glass Container */}
            <div className="bg-surface-2 backdrop-blur-xl border border-border-default rounded-[28px] p-6 lg:p-8 shadow-2xl ring-1 ring-border-subtle space-y-8">
              
              {/* Part 1: Contact & Billing */}
              <section className="space-y-6">
                <div className="flex items-center gap-3">
                   <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
                      <span className="text-[13px] font-black text-text-primary">1</span>
                   </div>
                   <h2 className="text-lg font-black text-text-primary uppercase tracking-tight">Billing Details</h2>
                </div>
 
                <form onSubmit={handlePayment} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5 group/input">
                    <label htmlFor="fullName" className="text-[10px] font-black text-text-faint uppercase tracking-[0.2em] pl-1 group-focus-within/input:text-indigo-400 transition-colors">Full Name</label>
                    <input
                      type="text"
                      id="fullName"
                      required
                      placeholder="e.g. John Doe"
                      className="w-full bg-surface-2 border border-border-default rounded-xl py-3 px-5 text-text-primary text-sm focus:bg-surface-3 focus:ring-1 focus:ring-indigo-500/40 focus:border-indigo-500/40 outline-none transition-all placeholder:text-text-faint font-bold"
                    />
                  </div>
                  <div className="space-y-1.5 group/input">
                    <label htmlFor="email" className="text-[10px] font-black text-text-faint uppercase tracking-[0.2em] pl-1 group-focus-within/input:text-indigo-400 transition-colors">Business Email</label>
                    <input
                      type="email"
                      id="email"
                      required
                      placeholder="john@grizon.ai"
                      className="w-full bg-surface-2 border border-border-default rounded-xl py-3 px-5 text-text-primary text-sm focus:bg-surface-3 focus:ring-1 focus:ring-indigo-500/40 focus:border-indigo-500/40 outline-none transition-all placeholder:text-text-faint font-bold"
                    />
                  </div>
 
                  <div className="sm:col-span-2 space-y-1.5 group/input">
                    <label htmlFor="address" className="text-[10px] font-black text-text-faint uppercase tracking-[0.2em] pl-1 group-focus-within/input:text-indigo-400 transition-colors">Street Address</label>
                    <input
                      type="text"
                      id="address"
                      required
                      placeholder="e.g. 123 Business Avenue"
                      className="w-full bg-surface-2 border border-border-default rounded-xl py-3 px-5 text-text-primary text-sm focus:bg-surface-3 focus:ring-1 focus:ring-indigo-500/40 focus:border-indigo-500/40 outline-none transition-all placeholder:text-text-faint font-bold"
                    />
                  </div>
 
                  <div className="grid grid-cols-2 gap-4 sm:col-span-2">
                    <div className="space-y-1.5 group/input">
                      <label htmlFor="city" className="text-[10px] font-black text-text-faint uppercase tracking-[0.2em] pl-1 group-focus-within/input:text-indigo-400 transition-colors">City</label>
                      <input
                        type="text"
                        id="city"
                        required
                        placeholder="San Francisco"
                        className="w-full bg-surface-2 border border-border-default rounded-xl py-3 px-5 text-text-primary text-sm focus:bg-surface-3 focus:ring-1 focus:ring-indigo-500/40 focus:border-indigo-500/40 outline-none transition-all placeholder:text-text-faint font-bold"
                      />
                    </div>
                    <div className="space-y-1.5 group/input">
                      <label htmlFor="zip" className="text-[10px] font-black text-text-faint uppercase tracking-[0.2em] pl-1 group-focus-within/input:text-indigo-400 transition-colors">ZIP Code</label>
                      <input
                        type="text"
                        id="zip"
                        required
                        placeholder="94103"
                        className="w-full bg-surface-2 border border-border-default rounded-xl py-3 px-5 text-text-primary text-sm focus:bg-surface-3 focus:ring-1 focus:ring-indigo-500/40 focus:border-indigo-500/40 outline-none transition-all placeholder:text-text-faint font-bold"
                      />
                    </div>
                  </div>
                </form>
              </section>
 
              {/* Part 2: Secure Payment Execution */}
              <section className="space-y-6 pt-6 border-t border-border-default">
                <div className="flex items-center gap-3">
                   <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
                      <span className="text-[13px] font-black text-text-primary">2</span>
                   </div>
                   <h2 className="text-lg font-black text-text-primary uppercase tracking-tight">Payment Method</h2>
                </div>
 
                <div className="bg-indigo-500/[0.08] border border-indigo-500/20 rounded-2xl p-5 lg:p-6 flex flex-col sm:flex-row items-center justify-between gap-6 shadow-inner relative group/btn-con">
                   <div className="flex items-center gap-4 relative z-10">
                      <div className="w-12 h-12 rounded-xl bg-surface-2 backdrop-blur-xl flex items-center justify-center border border-border-default grow-0 shrink-0">
                         <CreditCard className="text-indigo-400" size={24} strokeWidth={2.5} />
                      </div>
                      <div className="space-y-0.5">
                         <p className="text-text-primary font-black text-base tracking-tight leading-none">External Redirection</p>
                         <p className="text-[11px] text-text-muted font-bold leading-tight max-w-[150px]">No local data storage. Finalized via our partner gateway.</p>
                      </div>
                   </div>
 
                   <button
                     onClick={handlePayment}
                     disabled={isProcessing}
                     className="w-full sm:w-auto bg-indigo-500 text-text-primary rounded-xl h-12 px-8 font-black text-sm hover:bg-indigo-400 hover:scale-[1.03] disabled:opacity-50 transition-all flex items-center justify-center gap-2.5 shadow-lg active:scale-95 relative z-10 whitespace-nowrap group/paybtn"
                   >
                     {isProcessing ? (
                        <div className="flex items-center gap-2.5">
                           <Loader2 className="animate-spin h-4 w-4" />
                           <span>Redirecting...</span>
                        </div>
                     ) : (
                       <div className="flex items-center gap-2">
                         <span>Pay Now</span>
                         <svg className="w-4 h-4 transition-transform group-hover/paybtn:translate-x-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3.5}>
                           <path d="M13 7l5 5m0 0l-5 5m5-5H6" />
                         </svg>
                       </div>
                     )}
                   </button>
                </div>
              </section>
            </div>
          </div>
 
          {/* Sidebar Column: Sticky Premium Summary */}
          <aside className="lg:sticky lg:top-6 space-y-4 animate-in fade-in slide-in-from-right-8 duration-700 delay-200">
             <div className="bg-surface-2 backdrop-blur-2xl border border-border-default rounded-[24px] p-6 lg:p-8 shadow-2xl relative overflow-hidden group/summary">
                <div className="absolute top-0 right-0 p-8 opacity-5 group-hover/summary:opacity-10 transition-all duration-1000 group-hover/summary:scale-110">
                   <Zap size={100} fill="currentColor" className="text-text-primary" />
                </div>
 
                <h3 className="text-[10px] font-black text-indigo-400 uppercase tracking-[0.4em] mb-8 leading-none">Order Summary</h3>
                
                <div className="space-y-6 relative z-10">
                  <div className="space-y-1.5">
                    <h4 className="text-2xl font-black text-text-primary tracking-tighter leading-none">{selectedPlan.name}</h4>
                    <p className="text-[11px] text-text-faint font-black uppercase tracking-widest font-mono">Monthly Access</p>
                  </div>
 
                  <div className="space-y-3.5 py-6 border-y border-border-default">
                    {selectedPlan.features.slice(0, 3).map((feature, idx) => (
                      <div key={idx} className="flex items-start gap-3 group/item">
                        <CheckCircle2 size={14} className="text-emerald-500/40 mt-0.5 shrink-0 group-hover/item:text-emerald-500 transition-colors" />
                        <span className="text-[12px] text-text-muted font-bold leading-tight group-hover/item:text-text-primary transition-colors">{feature}</span>
                      </div>
                    ))}
                  </div>
 
                  <div className="space-y-3 pt-1">
                    <div className="flex justify-between items-center text-[11px] font-bold">
                      <span className="text-text-faint uppercase tracking-widest">Base Rate</span>
                      <span className="text-text-secondary font-mono tracking-tighter">${selectedPlan.price.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between items-center text-[11px] font-bold">
                      <span className="text-text-faint uppercase tracking-widest">Fee</span>
                      <span className="text-text-secondary font-mono tracking-tighter">${tax.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between items-center pt-5 border-t border-border-default">
                      <span className="text-[12px] font-black text-text-muted tracking-[0.1em] uppercase leading-none">Total Due</span>
                      <span className="text-4xl font-black text-text-primary tracking-tighter leading-none">${total.toFixed(2)}</span>
                    </div>
                  </div>
                </div>
             </div>
 
             <div className="bg-surface-1 backdrop-blur-xl border border-border-default rounded-2xl p-4 flex items-start gap-4 hover:bg-surface-2 transition-colors group/sec border-l-4 border-l-indigo-500 shadow-xl">
               <div className="bg-indigo-500/10 p-2.5 rounded-lg border border-indigo-500/20">
                 <ShieldCheck className="w-5 h-5 text-indigo-400" strokeWidth={2.5} />
               </div>
               <div className="space-y-0.5">
                  <p className="text-[13px] font-black text-text-primary uppercase tracking-wider leading-none">Enterprise Security</p>
                  <p className="text-[11px] text-text-faint leading-relaxed font-bold">
                    PCI-DSS protocols on all transactions.
                  </p>
               </div>
             </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
