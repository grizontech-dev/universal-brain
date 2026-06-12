'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { ApiError } from '@/lib/auth-api';

export default function VerifyEmailRequestPage() {
  const { isAuthenticated, isLoading, requestEmailVerification, user } = useAuth();
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [message, setMessage] = useState('');

  const handleResend = async () => {
    setStatus('sending');
    setMessage('');
    try {
      await requestEmailVerification();
      setStatus('sent');
      setMessage('If your account is eligible, a verification email has been sent.');
    } catch (e) {
      setStatus('error');
      setMessage(e instanceof ApiError ? e.message : 'Could not send verification email.');
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-app flex items-center justify-center text-text-secondary">Loading…</div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-app flex flex-col items-center justify-center p-6 text-text-primary text-center max-w-md mx-auto">
        <h1 className="text-xl font-bold mb-2">Sign in required</h1>
        <p className="text-text-muted text-sm mb-6">Request a new verification email from your signed-in account.</p>
        <Link href="/" className="rounded-xl bg-accent px-6 py-3 text-sm font-semibold hover:bg-accent-hover">
          Go home
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-app flex flex-col items-center justify-center p-6 text-text-primary">
      <div className="w-full max-w-md bg-input border border-border-default rounded-2xl p-8 shadow-2xl">
        <h1 className="text-xl font-bold mb-2">Email verification</h1>
        <p className="text-sm text-text-muted mb-6">
          Signed in as <span className="text-text-secondary">{user?.email}</span>
          {user?.email_verified_at ? (
            <span className="block mt-2 text-emerald-400/90">Your email is already verified.</span>
          ) : null}
        </p>

        {!user?.email_verified_at ? (
          <>
            <p className="text-sm text-text-muted mb-6">
              We will send a verification link to your email address. This may take a minute to arrive.
            </p>
            <button
              type="button"
              onClick={() => void handleResend()}
              disabled={status === 'sending'}
              className="w-full bg-accent hover:bg-accent-hover disabled:opacity-50 font-semibold py-3 rounded-xl transition-all"
            >
              {status === 'sending' ? 'Sending…' : 'Resend verification email'}
            </button>
            {message ? (
              <p
                className={`mt-4 text-sm text-center ${status === 'error' ? 'text-red-400' : 'text-text-secondary'}`}
              >
                {message}
              </p>
            ) : null}
          </>
        ) : null}

        <Link href="/chat" className="mt-8 block text-center text-sm text-accent hover:text-accent-hover">
          Back to chat
        </Link>
      </div>
    </div>
  );
}
