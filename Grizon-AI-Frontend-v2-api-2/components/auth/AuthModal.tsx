'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { authCheckEmail, authPasswordForgot, ApiError, type CheckEmailResult } from '@/lib/auth-api';
import type { AuthModalScreen } from '@/lib/types';

export type { AuthModalScreen };

interface AuthModalProps {
  isOpen: boolean;
  initialScreen?: AuthModalScreen;
  onClose: () => void;
  blockClose?: boolean;
}

function isStrongPassword(p: string): boolean {
  return p.length >= 10 && /[A-Za-z]/.test(p) && /\d/.test(p);
}

export default function AuthModal({ isOpen, initialScreen, onClose, blockClose }: AuthModalProps) {
  const { login, register, error, clearError, requestEmailVerification, user } = useAuth();

  const [step, setStep] = useState<'email' | 'login-password' | 'register' | 'forgot' | 'forgot-sent' | 'verify'>(
    'email',
  );
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [checkResult, setCheckResult] = useState<CheckEmailResult | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  const displayError = localError || error;

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  const resetForm = useCallback(() => {
    setStep('email');
    setEmail('');
    setPassword('');
    setName('');
    setCheckResult(null);
    setLocalError(null);
    clearError();
  }, [clearError]);

  useEffect(() => {
    if (!isOpen) {
      resetForm();
      return;
    }
    clearError();
    setLocalError(null);
    if (initialScreen === 'forgot-password') {
      setStep('forgot');
      return;
    }
    if (initialScreen === 'verify-email') {
      setStep('verify');
      return;
    }
    setStep('email');
  }, [isOpen, initialScreen, clearError, resetForm]);

  const handleCheckEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    clearError();
    if (!email.trim()) {
      setLocalError('Enter your email');
      return;
    }
    setBusy(true);
    try {
      const r = await authCheckEmail(email.trim());
      setCheckResult(r);
      if (r.suggested_action === 'register') {
        setStep('register');
      } else {
        setStep('login-password');
      }
    } catch (err) {
      setLocalError(err instanceof ApiError ? err.message : 'Could not verify email');
    } finally {
      setBusy(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    clearError();
    if (!isStrongPassword(password)) {
      setLocalError('Password must be at least 10 characters with a letter and a number');
      return;
    }
    setBusy(true);
    try {
      await login({ email: email.trim(), password });
    } catch {
      /* error surfaced via context */
    } finally {
      setBusy(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    clearError();
    if (!name.trim()) {
      setLocalError('Enter your name');
      return;
    }
    if (!isStrongPassword(password)) {
      setLocalError('Password must be at least 10 characters with a letter and a number');
      return;
    }
    setBusy(true);
    try {
      await register({ email: email.trim(), password, name: name.trim() });
    } catch {
      /* context error */
    } finally {
      setBusy(false);
    }
  };

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    clearError();
    const em = email.trim();
    if (!em) {
      setLocalError('Enter your email');
      return;
    }
    setBusy(true);
    try {
      await authPasswordForgot(em);
      setStep('forgot-sent');
    } catch (err) {
      setLocalError(err instanceof ApiError ? err.message : 'Request failed');
    } finally {
      setBusy(false);
    }
  };

  const resendVerify = async () => {
    if (cooldown > 0) return;
    setBusy(true);
    try {
      await requestEmailVerification();
      setCooldown(60);
    } catch (err) {
      setLocalError(err instanceof ApiError ? err.message : 'Could not resend');
    } finally {
      setBusy(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-border-default bg-input p-6 text-text-primary shadow-2xl relative">
        {!blockClose && (
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="absolute top-4 right-4 text-text-muted hover:text-text-secondary text-lg leading-none"
          >
            ×
          </button>
        )}

        {step === 'verify' && (
          <div>
            <h2 className="text-lg font-semibold mb-2 pr-8">Verify your email</h2>
            <p className="text-sm text-text-secondary mb-6">
              Account: <span className="text-text-primary">{user?.email}</span>. Send a verification link to your inbox,
              then open the link (use <span className="text-text-secondary">/verify?token=…</span> from the email).
            </p>
            <button
              type="button"
              disabled={busy || cooldown > 0}
              onClick={() => void resendVerify()}
              className="w-full py-2.5 rounded-xl bg-accent hover:bg-accent-hover disabled:opacity-50 text-sm font-medium"
            >
              {cooldown > 0 ? `Resend in ${cooldown}s` : 'Send verification email'}
            </button>
          </div>
        )}

        {step === 'email' && (
          <form onSubmit={handleCheckEmail}>
            <h2 className="text-lg font-semibold mb-1 pr-8">Sign in or create account</h2>
            <p className="text-sm text-text-muted mb-6">Enter your email to continue.</p>
            <label className="block text-xs text-text-muted mb-1.5">Email</label>
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(ev) => setEmail(ev.target.value)}
              className="w-full mb-4 rounded-xl border border-border-default bg-surface-2 px-3 py-2.5 text-sm outline-none focus:border-border-strong"
              placeholder="you@example.com"
            />
            {displayError && <p className="text-sm text-red-400 mb-3">{displayError}</p>}
            <button
              type="submit"
              disabled={busy}
              className="w-full py-2.5 rounded-xl bg-white text-gray-950 text-sm font-medium hover:bg-gray-100 disabled:opacity-50"
            >
              {busy ? 'Please wait…' : 'Continue'}
            </button>
            <button
              type="button"
              className="mt-3 w-full text-sm text-text-muted hover:text-text-secondary"
              onClick={() => {
                setStep('forgot');
                setLocalError(null);
                clearError();
              }}
            >
              Forgot password?
            </button>
          </form>
        )}

        {step === 'login-password' && (
          <form onSubmit={handleLogin}>
            <h2 className="text-lg font-semibold mb-1 pr-8">Welcome back</h2>
            <p className="text-sm text-text-muted mb-4">{email}</p>
            <label className="block text-xs text-text-muted mb-1.5">Password</label>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(ev) => setPassword(ev.target.value)}
              className="w-full mb-4 rounded-xl border border-border-default bg-surface-2 px-3 py-2.5 text-sm outline-none focus:border-border-strong"
            />
            {checkResult?.has_google && (
              <p className="text-xs text-amber-200/90 mb-3">This account may be linked to Google. Use password if you set one.</p>
            )}
            {displayError && <p className="text-sm text-red-400 mb-3">{displayError}</p>}
            <button
              type="submit"
              disabled={busy}
              className="w-full py-2.5 rounded-xl bg-white text-gray-950 text-sm font-medium hover:bg-gray-100 disabled:opacity-50"
            >
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
            <button
              type="button"
              className="mt-3 w-full text-sm text-text-muted hover:text-text-secondary"
              onClick={() => {
                setStep('email');
                setPassword('');
                setLocalError(null);
                clearError();
              }}
            >
              Use a different email
            </button>
          </form>
        )}

        {step === 'register' && (
          <form onSubmit={handleRegister}>
            <h2 className="text-lg font-semibold mb-1 pr-8">Create account</h2>
            <p className="text-sm text-text-muted mb-4">{email}</p>
            <label className="block text-xs text-text-muted mb-1.5">Name</label>
            <input
              type="text"
              autoComplete="name"
              value={name}
              onChange={(ev) => setName(ev.target.value)}
              className="w-full mb-3 rounded-xl border border-border-default bg-surface-2 px-3 py-2.5 text-sm outline-none focus:border-border-strong"
            />
            <label className="block text-xs text-text-muted mb-1.5">Password</label>
            <input
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(ev) => setPassword(ev.target.value)}
              className="w-full mb-4 rounded-xl border border-border-default bg-surface-2 px-3 py-2.5 text-sm outline-none focus:border-border-strong"
            />
            <p className="text-xs text-text-muted mb-3">Min 10 characters, at least one letter and one number.</p>
            {displayError && <p className="text-sm text-red-400 mb-3">{displayError}</p>}
            <button
              type="submit"
              disabled={busy}
              className="w-full py-2.5 rounded-xl bg-accent hover:bg-accent-hover text-sm font-medium disabled:opacity-50"
            >
              {busy ? 'Creating…' : 'Create account'}
            </button>
            <button
              type="button"
              className="mt-3 w-full text-sm text-text-muted hover:text-text-secondary"
              onClick={() => {
                setStep('email');
                setPassword('');
                setName('');
                setLocalError(null);
                clearError();
              }}
            >
              Back
            </button>
          </form>
        )}

        {step === 'forgot' && (
          <form onSubmit={handleForgot}>
            <h2 className="text-lg font-semibold mb-2 pr-8">Reset password</h2>
            <p className="text-sm text-text-muted mb-4">We&apos;ll email you a reset link.</p>
            <label className="block text-xs text-text-muted mb-1.5">Email</label>
            <input
              type="email"
              value={email}
              onChange={(ev) => setEmail(ev.target.value)}
              className="w-full mb-4 rounded-xl border border-border-default bg-surface-2 px-3 py-2.5 text-sm outline-none focus:border-border-strong"
            />
            {displayError && <p className="text-sm text-red-400 mb-3">{displayError}</p>}
            <button
              type="submit"
              disabled={busy}
              className="w-full py-2.5 rounded-xl bg-white text-gray-950 text-sm font-medium disabled:opacity-50"
            >
              {busy ? 'Sending…' : 'Send reset link'}
            </button>
            <button
              type="button"
              className="mt-3 w-full text-sm text-text-muted hover:text-text-secondary"
              onClick={() => {
                setStep('email');
                setLocalError(null);
                clearError();
              }}
            >
              Back to sign in
            </button>
            <a
              href="/forgot-password"
              className="mt-4 block text-center text-xs text-accent hover:text-accent-hover"
            >
              Open full-page reset form
            </a>
          </form>
        )}

        {step === 'forgot-sent' && (
          <div>
            <h2 className="text-lg font-semibold mb-2">Check your email</h2>
            <p className="text-sm text-text-secondary mb-6">
              If an account exists for {email.trim()}, you will receive reset instructions shortly.
            </p>
            <button
              type="button"
              onClick={() => {
                setStep('email');
                onClose();
              }}
              className="w-full py-2.5 rounded-xl bg-white text-gray-950 text-sm font-medium"
            >
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
