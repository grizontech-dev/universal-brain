'use client';

import React, { createContext, useContext, useState, useCallback, useEffect, useMemo } from 'react';
import {
  THEMES,
  DEFAULT_THEME_ID,
  THEME_STORAGE_KEY,
  isValidThemeId,
  type ThemeMeta,
} from '@/lib/themes';
import {
  loadAppliedCustomTheme,
  applyCustomThemeToDOM,
  clearCustomThemeFromDOM,
  clearAppliedCustomTheme,
} from '@/lib/custom-themes';
import { getFontMeta } from '@/lib/fonts';

interface ThemeContextType {
  /** Currently active theme id (matches `data-theme` on <html>). */
  themeId: string;
  /** All selectable themes (for dropdown / preview UI). */
  themes: ThemeMeta[];
  /** Switch theme: applies to <html> instantly + persists to localStorage. */
  setTheme: (id: string) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

function applyTheme(id: string) {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', id);
}

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // SSR + first client render use the default so markup matches the no-flash
  // script in layout.tsx; the effect below reconciles with the stored value.
  const [themeId, setThemeId] = useState<string>(DEFAULT_THEME_ID);

  // Hydrate from localStorage on mount.
  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Re-apply a custom theme if one was active before refresh.
    const appliedCustom = loadAppliedCustomTheme();
    if (appliedCustom) {
      applyCustomThemeToDOM(appliedCustom);
      const fontMeta = getFontMeta(appliedCustom.fontId);
      document.documentElement.style.setProperty('--c-font-body', `var(${fontMeta.variable})`);
      // Keep the underlying built-in theme synced too (used as fallback for
      // any vars the custom theme might not define).
      const saved = localStorage.getItem(THEME_STORAGE_KEY);
      const next = isValidThemeId(saved) ? saved : DEFAULT_THEME_ID;
      setThemeId(next);
      applyTheme(next);
      return;
    }

    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    const next = isValidThemeId(saved) ? saved : DEFAULT_THEME_ID;
    setThemeId(next);
    applyTheme(next);
    // FUTURE (account sync): when user profile carries a `theme`, reconcile it
    // here — prefer the server value when present, else fall back to `saved`.
  }, []);

  const setTheme = useCallback((id: string) => {
    const next = isValidThemeId(id) ? id : DEFAULT_THEME_ID;
    // Clear any applied custom theme so the built-in takes full control.
    clearCustomThemeFromDOM();
    clearAppliedCustomTheme();
    document.documentElement.style.removeProperty('--c-font-body');
    setThemeId(next);
    applyTheme(next);
    if (typeof window !== 'undefined') {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    }
    // FUTURE (account sync): also PATCH /api/v1/auth/me { theme: next } here.
  }, []);

  const value = useMemo(
    () => ({ themeId, themes: THEMES, setTheme }),
    [themeId, setTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};
