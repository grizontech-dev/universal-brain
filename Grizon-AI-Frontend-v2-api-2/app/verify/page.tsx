'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { authEmailVerifyConfirm, ApiError } from '@/lib/auth-api';
import { REFRESH_TOKEN_STORAGE_KEY } from '@/lib/auth-constants';

function MissingToken() {
  const router = useRouter();
  return (
    <div className="text-center max-w-md">
      <p className="text-red-400 mb-4">Missing verification token.</p>
      <button
        type="button"
        onClick={() => router.push('/')}
        className="rounded-xl bg-surface-3 px-4 py-2 text-sm hover:bg-surface-4"
      >
        Go home
      </button>
    </div>
  );
}

function VerifyWithToken({ token }: { token: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await authEmailVerifyConfirm(token);
        if (cancelled) return;
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new Event('grizon:auth-changed'));
        }
        const hasSession =
          typeof window !== 'undefined' && !!localStorage.getItem(REFRESH_TOKEN_STORAGE_KEY);
        router.replace(hasSession ? '/brain' : '/');
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof ApiError ? e.message : 'Verification failed');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, router]);

  if (error) {
    return (
      <div className="text-center max-w-md">
        <p className="text-red-400 mb-4">{error}</p>
        <button
          type="button"
          onClick={() => router.push('/')}
          className="rounded-xl bg-surface-3 px-4 py-2 text-sm hover:bg-surface-4"
        >
          Go home
        </button>
      </div>
    );
  }

  return <p className="text-text-secondary">Verifying your email…</p>;
}

function VerifyInner() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  if (!token) {
    return <MissingToken />;
  }
  return <VerifyWithToken token={token} />;
}

export default function VerifyPage() {
  return (
    <div className="min-h-screen bg-app flex flex-col items-center justify-center p-4 text-text-primary">
      <Suspense fallback={<p className="text-text-muted">Loading…</p>}>
        <VerifyInner />
      </Suspense>
    </div>
  );
}
