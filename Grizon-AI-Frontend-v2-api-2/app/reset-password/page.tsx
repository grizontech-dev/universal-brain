'use client';

import { useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { authPasswordReset, ApiError } from '@/lib/auth-api';

function isStrongPassword(p: string): boolean {
  return p.length >= 10 && /[A-Za-z]/.test(p) && /\d/.test(p);
}

function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { applySessionFromTokenBundle } = useAuth();

  const token = searchParams.get('token');

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const calculateStrength = (pass: string) => {
    let score = 0;
    if (pass.length > 8) score += 25;
    if (pass.match(/[A-Z]/)) score += 25;
    if (pass.match(/[0-9]/)) score += 25;
    if (pass.match(/[^A-Za-z0-9]/)) score += 25;
    
    if (score === 0) return { width: '0%', color: 'transparent' };
    if (score <= 25) return { width: '25%', color: '#EF4444' };
    if (score <= 50) return { width: '50%', color: '#EAB308' };
    if (score <= 75) return { width: '75%', color: '#22C55E' };
    return { width: '100%', color: '#14B8A6' };
  };

  const strength = calculateStrength(password);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) {
      setError('Invalid or expired reset link.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (!isStrongPassword(password)) {
      setError('Password must be at least 10 characters with a letter and a number');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const bundle = await authPasswordReset(token, password);
      await applySessionFromTokenBundle(bundle);
      setSuccess(true);
      setTimeout(() => router.push('/brain'), 1500);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Reset failed');
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <div className="bg-input border border-border-default rounded-2xl p-8 max-w-md w-full mx-auto shadow-2xl">
        <div className="text-center">
          <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center mx-auto mb-4 border border-red-500/20">
            <svg className="w-8 h-8 text-red-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </div>
          <h2 className="text-xl font-bold text-text-primary mb-2">Invalid Reset Link</h2>
          <p className="text-sm text-text-muted mb-6">
            The reset link is invalid or has expired. Please request a new one.
          </p>
          <button 
            onClick={() => router.push('/')}
            className="w-full bg-surface-2 hover:bg-surface-3 text-text-primary font-medium py-3 rounded-xl transition-all border border-border-default"
          >
            Go to Homepage
          </button>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="bg-input border border-border-default rounded-2xl p-8 max-w-md w-full mx-auto shadow-2xl">
        <div className="text-center">
          <div className="w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center mx-auto mb-4 border border-emerald-500/20">
            <svg className="w-8 h-8 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
              <polyline points="22 4 12 14.01 9 11.01"></polyline>
            </svg>
          </div>
          <h2 className="text-xl font-bold text-text-primary mb-2">Password Reset Successfully</h2>
          <p className="text-sm text-text-muted mb-6">
            Your password has been changed. Redirecting to chat…
          </p>
          <button 
            onClick={() => router.push('/')}
            className="w-full bg-accent hover:bg-accent-hover text-text-primary font-medium py-3 rounded-xl transition-all"
          >
            Sign In Now
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-input border border-border-default rounded-2xl p-8 max-w-md w-full mx-auto shadow-2xl">
      <div className="flex justify-center mb-6">
        <div className="w-12 h-12 flex items-center justify-center">
          {/* eslint-disable-next-line @next/next/no-img-element -- static SVG asset */}
          <img src="/Logo.svg" alt="Grizon" className="w-full h-full object-contain" />
        </div>
      </div>
      
      <h2 className="text-[22px] font-bold text-text-primary text-center mb-1 tracking-tight">
        Set new password
      </h2>
      <p className="text-[13px] text-text-muted text-center mb-8">
        Create a new, strong password for your account
      </p>

      <form onSubmit={handleSubmit}>
        <div className="mb-4">
          <label className="block text-[12px] text-text-muted font-medium mb-1.5">
            New password
          </label>
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-surface-2 border border-border-default rounded-[10px] px-3.5 py-2.5 text-[14px] text-text-primary placeholder:text-text-faint outline-none transition-all focus:border-border-strong focus:bg-surface-3"
              placeholder="Enter new password"
              required
            />
            <button
              type="button"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-text-faint hover:text-text-muted transition-colors"
              onClick={() => setShowPassword(!showPassword)}
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </button>
          </div>
          {password && (
            <div className="mt-2.5">
              <div className="h-0.5 w-full bg-surface-3 rounded-full overflow-hidden">
                <div
                  className="h-full transition-all duration-300 rounded-full"
                  style={{ width: strength.width, backgroundColor: strength.color }}
                ></div>
              </div>
            </div>
          )}
        </div>

        <div className="mb-8">
          <label className="block text-[12px] text-text-muted font-medium mb-1.5">
            Confirm password
          </label>
          <input
            type={showPassword ? 'text' : 'password'}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="w-full bg-surface-2 border border-border-default rounded-[10px] px-3.5 py-2.5 text-[14px] text-text-primary placeholder:text-text-faint outline-none transition-all focus:border-border-strong focus:bg-surface-3"
            placeholder="Confirm new password"
            required
          />
        </div>

        <button
          type="submit"
          disabled={loading || !password || !isStrongPassword(password) || password !== confirmPassword}
          className="w-full bg-accent hover:bg-accent-hover text-text-primary font-semibold py-3 rounded-[12px] transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-xl shadow-purple-900/20 active:scale-[0.98]"
        >
          {loading ? 'Resetting...' : 'Reset Password'}
        </button>

        {error && (
          <p className="text-[13px] text-red-400 mt-4 text-center">
            {error}
          </p>
        )}
      </form>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="min-h-screen bg-app flex flex-col items-center justify-center p-4 selection:bg-accent/30">
      {/* Background gradients */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-accent/10 blur-[120px] rounded-full" />
        <div className="absolute right-[-10%] bottom-[-10%] w-[40%] h-[40%] bg-violet-600/10 blur-[120px] rounded-full" />
      </div>
      
      <div className="w-full max-w-md relative z-10">
        <Suspense fallback={<div className="text-text-muted text-center">Loading...</div>}>
          <ResetPasswordForm />
        </Suspense>
      </div>
    </div>
  );
}
