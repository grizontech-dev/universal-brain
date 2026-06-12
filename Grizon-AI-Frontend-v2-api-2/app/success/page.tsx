"use client";
import { CheckCircle2, ChevronRight, CreditCard, LayoutDashboard, Zap } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";

function SuccessScreen() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const plan = searchParams.get("plan") || "pro";

  const planName = plan.charAt(0).toUpperCase() + plan.slice(1) + " Plan";

  return (
    <div className="min-h-screen bg-app flex flex-col items-center justify-center p-4">
      <div className="bg-card border border-border-default rounded-3xl p-8 max-w-lg w-full text-center space-y-8 shadow-[0_30px_100px_rgba(0,0,0,0.8)] relative overflow-hidden group">
        {/* Glow Effects */}
        <div className="absolute -top-24 -right-24 w-64 h-64 bg-indigo-500/10 blur-[80px] rounded-full group-hover:bg-indigo-500/15 transition-all duration-700" />
        <div className="absolute -bottom-24 -left-24 w-64 h-64 bg-purple-500/10 blur-[80px] rounded-full group-hover:bg-purple-500/15 transition-all duration-700" />

        <div className="relative space-y-6">
          <div className="mx-auto flex items-center justify-center h-24 w-24 rounded-full bg-emerald-500/10 border border-emerald-500/20 shadow-2xl shadow-emerald-500/20 animate-in zoom-in duration-700">
            <CheckCircle2 className="h-12 w-12 text-emerald-400" />
          </div>
          
          <div className="space-y-2">
            <h1 className="text-3xl font-black text-text-primary tracking-tight sm:text-4xl">Payment Successful! 🎉</h1>
            <p className="text-text-muted text-lg">
              Welcome to the <span className="text-indigo-400 font-bold">{planName}</span>. Your premium account is now active.
            </p>
          </div>

          <div className="bg-surface-2 border border-border-subtle rounded-2xl p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-indigo-500/20 flex items-center justify-center">
                <Zap className="w-5 h-5 text-indigo-400" fill="currentColor" />
              </div>
              <div className="text-left">
                <p className="text-[10px] font-black text-text-faint uppercase tracking-[0.2em] mb-0.5">Active Plan</p>
                <p className="text-text-primary font-bold">{planName}</p>
              </div>
            </div>
            <div className="px-3 py-1 bg-emerald-500/10 text-emerald-400 text-[10px] font-black uppercase rounded-lg border border-emerald-500/20">
              Active
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-4">
            <button
              onClick={() => router.push('/chat')}
              className="group flex items-center justify-center gap-2 bg-white text-gray-950 rounded-2xl py-4 px-6 font-bold hover:bg-gray-200 transition-all active:scale-95 shadow-xl shadow-white/10"
            >
              <LayoutDashboard size={18} />
              Go to Dashboard
            </button>
            <button
              onClick={() => router.push('/subscription')}
              className="flex items-center justify-center gap-2 bg-surface-2 text-text-secondary rounded-2xl py-4 px-6 font-bold hover:bg-surface-3 hover:text-text-primary transition-all border border-border-subtle"
            >
              View Billing
              <ChevronRight size={18} />
            </button>
          </div>
          
          <p className="text-text-faint text-[11px] font-medium pt-2">
            A confirmation email has been sent to your registered address.
          </p>
        </div>

        {/* Expiring Background Progress Bar */}
        <div className="absolute bottom-0 left-0 right-0 h-1 bg-surface-2">
          <div className="h-full bg-gradient-to-r from-emerald-500 to-indigo-500 w-full animate-toast-progress origin-left" style={{ animationDuration: '3000ms' }} />
        </div>
      </div>
    </div>
  );
}

export default function SuccessPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-app flex items-center justify-center text-text-primary">Loading...</div>}>
      <SuccessScreen />
    </Suspense>
  );
}
