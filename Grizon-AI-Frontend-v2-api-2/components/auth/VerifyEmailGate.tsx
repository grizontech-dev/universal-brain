'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';

export default function VerifyEmailGate() {
  const { user, requestEmailVerification, logout } = useAuth();
  const [cooldown, setCooldown] = useState(0);
  const [status, setStatus] = useState<'idle' | 'sending' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  const send = useCallback(async () => {
    setStatus('sending');
    setMessage(null);
    try {
      await requestEmailVerification();
      setStatus('idle');
      setCooldown(60);
    } catch (e: unknown) {
      setStatus('error');
      setMessage(e instanceof Error ? e.message : 'Could not send email');
    }
  }, [requestEmailVerification]);

  return (
    <div className="flex h-[100dvh] w-full flex-col items-center justify-center bg-chat text-text-primary p-6">
      <div className="w-full max-w-md rounded-2xl border border-border-default bg-input p-8 shadow-2xl">
        <h1 className="text-xl font-semibold mb-2">Verify your email</h1>
        <p className="text-sm text-text-secondary mb-6">
          We need to confirm <span className="text-text-primary font-medium">{user?.email}</span>. Click below to send a
          verification link, then open it in this browser.
        </p>
        <button
          type="button"
          disabled={cooldown > 0 || status === 'sending'}
          onClick={() => void send()}
          className="w-full py-2.5 rounded-xl bg-accent hover:bg-accent-hover disabled:opacity-50 text-sm font-medium transition-colors mb-3"
        >
          {cooldown > 0 ? `Resend in ${cooldown}s` : status === 'sending' ? 'Sending…' : 'Send verification email'}
        </button>
        <button
          type="button"
          onClick={() => void logout()}
          className="w-full py-2.5 rounded-xl border border-border-default text-text-secondary hover:bg-surface-2 text-sm transition-colors"
        >
          Sign out
        </button>
        <p className="text-xs text-text-muted mt-4 text-center">
          <a href="/verify-email-request" className="text-accent hover:text-accent-hover underline">
            Open verification page
          </a>
        </p>
        {message && <p className="text-sm text-red-400 mt-4 text-center">{message}</p>}
      </div>
    </div>
  );
}
