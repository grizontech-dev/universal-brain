'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { authCheckEmail, authPasswordForgot, ApiError, type CheckEmailResult } from '@/lib/auth-api';

export default function LoginPage() {
  const router = useRouter();
  const { login, register, user, isLoading } = useAuth();

  const [step, setStep] = useState<'email' | 'login' | 'register' | 'forgot' | 'forgot-sent'>('email');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isLoading && user?.email_verified_at) {
      router.push('/brain');
    }
  }, [user, isLoading, router]);

  const handleCheckEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!email.trim()) { setError('Enter your email'); return; }
    setBusy(true);
    try {
      const r = await authCheckEmail(email.trim());
      setStep(r.suggested_action === 'register' ? 'register' : 'login');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not verify email');
    } finally {
      setBusy(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 10) { setError('Password must be at least 10 characters'); return; }
    setBusy(true);
    try {
      await login({ email: email.trim(), password });
      router.push('/brain');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Login failed');
    } finally {
      setBusy(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim()) { setError('Enter your name'); return; }
    if (password.length < 10) { setError('Password must be at least 10 characters'); return; }
    setBusy(true);
    try {
      await register({ email: email.trim(), password, name: name.trim() });
      router.push('/brain');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Registration failed');
    } finally {
      setBusy(false);
    }
  };

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!email.trim()) { setError('Enter your email'); return; }
    setBusy(true);
    try {
      await authPasswordForgot(email.trim());
      setStep('forgot-sent');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Request failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-app px-4">
      {/* Background gradient orbs */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-accent/10 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-accent/5 rounded-full blur-3xl" />
      </div>

      <div className="w-full max-w-md relative z-10">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 mb-4">
            <img src="/Logo.svg" alt="Grizon" className="w-full h-full object-contain" />
          </div>
          <h1 className="text-2xl font-bold text-text-primary tracking-tight">
            {step === 'email' && 'Welcome to Grizon AI'}
            {step === 'login' && 'Welcome back'}
            {step === 'register' && 'Create your account'}
            {step === 'forgot' && 'Reset your password'}
            {step === 'forgot-sent' && 'Check your email'}
          </h1>
          <p className="text-sm text-text-muted mt-2">
            {step === 'email' && 'Sign in or create an account to continue'}
            {step === 'login' && email}
            {step === 'register' && email}
            {step === 'forgot' && "We'll send you a reset link"}
            {step === 'forgot-sent' && `If an account exists for ${email}, you'll receive instructions shortly.`}
          </p>
        </div>

        {/* Card */}
        <div className="glass-container p-8">
          {step === 'email' && (
            <form onSubmit={handleCheckEmail} className="space-y-4">
              <div>
                <label className="block text-xs text-text-muted mb-1.5 font-medium">Email address</label>
                <input
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-xl border border-border-default bg-surface-2 px-4 py-3 text-sm outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20 transition-all"
                  placeholder="you@example.com"
                  autoFocus
                />
              </div>
              {error && <p className="text-sm text-danger">{error}</p>}
              <button
                type="submit"
                disabled={busy}
                className="w-full py-3 rounded-xl bg-accent hover:bg-accent-hover text-white text-sm font-semibold transition-all duration-200 disabled:opacity-50 active:scale-[0.98]"
              >
                {busy ? 'Checking...' : 'Continue'}
              </button>
              <button
                type="button"
                onClick={() => { setStep('forgot'); setError(null); }}
                className="w-full text-sm text-text-muted hover:text-accent transition-colors"
              >
                Forgot password?
              </button>
            </form>
          )}

          {step === 'login' && (
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="block text-xs text-text-muted mb-1.5 font-medium">Password</label>
                <input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-xl border border-border-default bg-surface-2 px-4 py-3 text-sm outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20 transition-all"
                  placeholder="Enter your password"
                  autoFocus
                />
              </div>
              {error && <p className="text-sm text-danger">{error}</p>}
              <button
                type="submit"
                disabled={busy}
                className="w-full py-3 rounded-xl bg-accent hover:bg-accent-hover text-white text-sm font-semibold transition-all duration-200 disabled:opacity-50 active:scale-[0.98]"
              >
                {busy ? 'Signing in...' : 'Sign in'}
              </button>
              <button
                type="button"
                onClick={() => { setStep('email'); setPassword(''); setError(null); }}
                className="w-full text-sm text-text-muted hover:text-accent transition-colors"
              >
                Use a different email
              </button>
            </form>
          )}

          {step === 'register' && (
            <form onSubmit={handleRegister} className="space-y-4">
              <div>
                <label className="block text-xs text-text-muted mb-1.5 font-medium">Full name</label>
                <input
                  type="text"
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full rounded-xl border border-border-default bg-surface-2 px-4 py-3 text-sm outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20 transition-all"
                  placeholder="Your name"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1.5 font-medium">Password</label>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-xl border border-border-default bg-surface-2 px-4 py-3 text-sm outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20 transition-all"
                  placeholder="Min 10 characters"
                />
              </div>
              <p className="text-xs text-text-faint">Minimum 10 characters with at least one letter and one number.</p>
              {error && <p className="text-sm text-danger">{error}</p>}
              <button
                type="submit"
                disabled={busy}
                className="w-full py-3 rounded-xl bg-accent hover:bg-accent-hover text-white text-sm font-semibold transition-all duration-200 disabled:opacity-50 active:scale-[0.98]"
              >
                {busy ? 'Creating account...' : 'Create account'}
              </button>
              <button
                type="button"
                onClick={() => { setStep('email'); setPassword(''); setName(''); setError(null); }}
                className="w-full text-sm text-text-muted hover:text-accent transition-colors"
              >
                Back
              </button>
            </form>
          )}

          {step === 'forgot' && (
            <form onSubmit={handleForgot} className="space-y-4">
              <div>
                <label className="block text-xs text-text-muted mb-1.5 font-medium">Email address</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-xl border border-border-default bg-surface-2 px-4 py-3 text-sm outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20 transition-all"
                  placeholder="you@example.com"
                  autoFocus
                />
              </div>
              {error && <p className="text-sm text-danger">{error}</p>}
              <button
                type="submit"
                disabled={busy}
                className="w-full py-3 rounded-xl bg-accent hover:bg-accent-hover text-white text-sm font-semibold transition-all duration-200 disabled:opacity-50 active:scale-[0.98]"
              >
                {busy ? 'Sending...' : 'Send reset link'}
              </button>
              <button
                type="button"
                onClick={() => { setStep('email'); setError(null); }}
                className="w-full text-sm text-text-muted hover:text-accent transition-colors"
              >
                Back to sign in
              </button>
            </form>
          )}

          {step === 'forgot-sent' && (
            <div className="text-center space-y-4">
              <div className="w-16 h-16 mx-auto rounded-full bg-success/10 flex items-center justify-center">
                <svg className="w-8 h-8 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <button
                onClick={() => router.push('/')}
                className="w-full py-3 rounded-xl bg-accent hover:bg-accent-hover text-white text-sm font-semibold transition-all"
              >
                Done
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-text-faint mt-6">
          By continuing, you agree to our Terms of Service and Privacy Policy.
        </p>
      </div>
    </div>
  );
}
