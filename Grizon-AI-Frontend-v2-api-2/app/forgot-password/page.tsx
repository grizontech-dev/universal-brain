'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { authPasswordForgot, ApiError } from '@/lib/auth-api';

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await authPasswordForgot(email);
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-app flex flex-col items-center justify-center p-4 selection:bg-accent/30 text-text-primary">
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-accent/10 blur-[120px] rounded-full" />
        <div className="absolute right-[-10%] bottom-[-10%] w-[40%] h-[40%] bg-violet-600/10 blur-[120px] rounded-full" />
      </div>

      <div className="w-full max-w-md relative z-10 bg-input border border-border-default rounded-2xl p-8 shadow-2xl">
        <div className="flex justify-center mb-6">
          <div className="w-12 h-12 flex items-center justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element -- static SVG asset */}
            <img src="/Logo.svg" alt="Grizon" className="w-full h-full object-contain" />
          </div>
        </div>

        <h1 className="text-[22px] font-bold text-center mb-1 tracking-tight">Forgot password</h1>
        <p className="text-[13px] text-text-muted text-center mb-8">
          {sent
            ? 'If an account exists for this email, you will receive reset instructions shortly.'
            : 'Enter your email and we will send you a reset link if the account exists.'}
        </p>

        {sent ? (
          <div className="space-y-4">
            <button
              type="button"
              onClick={() => router.push('/')}
              className="w-full bg-accent hover:bg-accent-hover text-white font-semibold py-3 rounded-[12px] transition-all"
            >
              Back to home
            </button>
            <Link
              href="/reset-password"
              className="block text-center text-sm text-accent hover:text-accent-hover"
            >
              I already have a reset link
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-[12px] text-text-muted font-medium mb-1.5">Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-surface-2 border border-border-default rounded-[10px] px-3.5 py-2.5 text-[14px] text-text-primary placeholder:text-text-faint outline-none focus:border-border-strong"
                placeholder="you@example.com"
                autoComplete="email"
              />
            </div>
            <button
              type="submit"
              disabled={loading || !email.trim()}
              className="w-full bg-accent hover:bg-accent-hover text-white font-semibold py-3 rounded-[12px] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Sending…' : 'Send reset link'}
            </button>
            {error ? <p className="text-[13px] text-red-400 text-center">{error}</p> : null}
            <p className="text-center text-sm text-text-muted">
              <Link href="/" className="text-accent hover:text-accent-hover">
                Sign in
              </Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
