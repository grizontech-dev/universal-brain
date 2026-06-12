'use client';

import React, { createContext, useContext, useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from './AuthContext';
import { fetchWallet, fetchUsageSummary } from '@/lib/chat-rest-api';
import { ApiError } from '@/lib/auth-api';
import type { UsageSummaryDto } from '@/types/settings-api';

export interface CreditBalance {
  available: number;
  reserved: number;
  total: number;
  lifetimeEarned: number;
  lifetimeSpent: number;
  lastRefreshedAt?: string;
}

interface CreditContextType {
  balance: CreditBalance | null;
  usageSummary: UsageSummaryDto | null;
  isLoading: boolean;
  error: string | null;
  refreshBalance: () => Promise<void>;
  refreshUsageSummary: () => Promise<void>;
}

const CreditContext = createContext<CreditContextType | undefined>(undefined);

export const CreditProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated } = useAuth();
  const [balance, setBalance] = useState<CreditBalance | null>(null);
  const [usageSummary, setUsageSummary] = useState<UsageSummaryDto | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshBalance = useCallback(async () => {
    if (!isAuthenticated) {
      setBalance(null);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const w = await fetchWallet();
      setBalance({
        available: w.spendable,
        reserved: w.pending,
        total: w.balance,
        lifetimeEarned: w.lifetimeEarned,
        lifetimeSpent: w.lifetimeSpent,
        lastRefreshedAt: w.updatedAt,
      });
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Wallet unavailable';
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated]);

  const refreshUsageSummary = useCallback(async () => {
    if (!isAuthenticated) {
      setUsageSummary(null);
      return;
    }
    try {
      const s = await fetchUsageSummary();
      setUsageSummary(s);
    } catch {
      setUsageSummary(null);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    void refreshBalance();
    void refreshUsageSummary();
  }, [refreshBalance, refreshUsageSummary]);

  useEffect(() => {
    const onAuthChanged = () => {
      void refreshBalance();
      void refreshUsageSummary();
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('grizon:auth-changed', onAuthChanged);
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('grizon:auth-changed', onAuthChanged);
      }
    };
  }, [refreshBalance, refreshUsageSummary]);

  const value = useMemo(
    () => ({
      balance,
      usageSummary,
      isLoading,
      error,
      refreshBalance,
      refreshUsageSummary,
    }),
    [balance, usageSummary, isLoading, error, refreshBalance, refreshUsageSummary],
  );

  return <CreditContext.Provider value={value}>{children}</CreditContext.Provider>;
};

export const useCredits = () => {
  const context = useContext(CreditContext);
  if (context === undefined) {
    throw new Error('useCredits must be used within a CreditProvider');
  }
  return context;
};
