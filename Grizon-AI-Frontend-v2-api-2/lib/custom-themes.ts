'use client';

export type ThemeVars = Record<string, string>;

export interface CustomTheme {
  id: string;
  name: string;
  group: 'dark' | 'light';
  fontId: string;
  vars: ThemeVars;
  createdAt: number;
}

const STORAGE_KEY = 'grizon_custom_themes';
const APPLIED_KEY = 'grizon_applied_custom_theme';

export const BASE_THEME_VARS: Record<string, ThemeVars> = {
  midnight: {
    '--c-app': '#09090b',
    '--c-sidebar': '#09090b',
    '--c-chat': '#0d0c14',
    '--c-card': '#0c0c0e',
    '--c-elevated': '#18181b',
    '--c-input': '#18181b',
    '--c-surface-0': '#09090b',
    '--c-surface-1': '#0f0f12',
    '--c-surface-2': '#16161a',
    '--c-surface-3': '#1c1c22',
    '--c-surface-4': '#24242c',
    '--c-surface-5': '#2e2e38',
    '--c-border-subtle': 'rgba(255, 255, 255, 0.05)',
    '--c-border-default': 'rgba(255, 255, 255, 0.10)',
    '--c-border-strong': 'rgba(255, 255, 255, 0.18)',
    '--c-text-primary': '#ffffff',
    '--c-text-secondary': 'rgba(255, 255, 255, 0.60)',
    '--c-text-muted': 'rgba(255, 255, 255, 0.40)',
    '--c-text-faint': 'rgba(255, 255, 255, 0.20)',
    '--c-accent': '#976df8',
    '--c-accent-hover': '#8559e8',
    '--c-accent-soft': 'rgba(151, 109, 248, 0.10)',
    '--c-success': '#34d399',
    '--c-warning': '#fbbf24',
    '--c-danger': '#f87171',
    '--c-bubble-user': 'rgba(151, 109, 248, 0.10)',
    '--c-bubble-user-border': 'rgba(151, 109, 248, 0.15)',
    '--c-bubble-ai': 'rgba(255, 255, 255, 0.04)',
    '--c-bubble-ai-border': 'rgba(255, 255, 255, 0.06)',
  },
  daylight: {
    '--c-app': '#f7f7f8',
    '--c-sidebar': '#ffffff',
    '--c-chat': '#f4f4f6',
    '--c-card': '#ffffff',
    '--c-elevated': '#f0f0f3',
    '--c-input': '#ffffff',
    '--c-surface-0': '#ffffff',
    '--c-surface-1': '#f7f7f8',
    '--c-surface-2': '#f0f0f3',
    '--c-surface-3': '#e7e7ec',
    '--c-surface-4': '#dddde4',
    '--c-surface-5': '#d2d2db',
    '--c-border-subtle': 'rgba(0, 0, 0, 0.06)',
    '--c-border-default': 'rgba(0, 0, 0, 0.12)',
    '--c-border-strong': 'rgba(0, 0, 0, 0.20)',
    '--c-text-primary': '#18181b',
    '--c-text-secondary': 'rgba(0, 0, 0, 0.62)',
    '--c-text-muted': 'rgba(0, 0, 0, 0.45)',
    '--c-text-faint': 'rgba(0, 0, 0, 0.30)',
    '--c-accent': '#7c54e8',
    '--c-accent-hover': '#6a44d6',
    '--c-accent-soft': 'rgba(124, 84, 232, 0.10)',
    '--c-success': '#15a06b',
    '--c-warning': '#c98a07',
    '--c-danger': '#dc4c4c',
    '--c-bubble-user': 'rgba(124, 84, 232, 0.10)',
    '--c-bubble-user-border': 'rgba(124, 84, 232, 0.22)',
    '--c-bubble-ai': '#ffffff',
    '--c-bubble-ai-border': 'rgba(0, 0, 0, 0.08)',
  },
  twilight: {
    '--c-app': '#1b1f2a',
    '--c-sidebar': '#11141c',
    '--c-chat': '#232838',
    '--c-card': '#272d40',
    '--c-elevated': '#2f3650',
    '--c-input': '#2f3650',
    '--c-surface-0': '#11141c',
    '--c-surface-1': '#1b1f2a',
    '--c-surface-2': '#232838',
    '--c-surface-3': '#272d40',
    '--c-surface-4': '#2f3650',
    '--c-surface-5': '#3a4360',
    '--c-border-subtle': 'rgba(255, 255, 255, 0.07)',
    '--c-border-default': 'rgba(255, 255, 255, 0.12)',
    '--c-border-strong': 'rgba(255, 255, 255, 0.20)',
    '--c-text-primary': '#eef1f8',
    '--c-text-secondary': 'rgba(238, 241, 248, 0.66)',
    '--c-text-muted': 'rgba(238, 241, 248, 0.45)',
    '--c-text-faint': 'rgba(238, 241, 248, 0.28)',
    '--c-accent': '#5ea9ff',
    '--c-accent-hover': '#4a97f0',
    '--c-accent-soft': 'rgba(94, 169, 255, 0.12)',
    '--c-success': '#34d399',
    '--c-warning': '#fbbf24',
    '--c-danger': '#f87171',
    '--c-bubble-user': 'rgba(94, 169, 255, 0.12)',
    '--c-bubble-user-border': 'rgba(94, 169, 255, 0.22)',
    '--c-bubble-ai': 'rgba(255, 255, 255, 0.05)',
    '--c-bubble-ai-border': 'rgba(255, 255, 255, 0.08)',
  },
  parchment: {
    '--c-app': '#f3ecde',
    '--c-sidebar': '#ece2cf',
    '--c-chat': '#f6efe2',
    '--c-card': '#fbf6ec',
    '--c-elevated': '#efe6d4',
    '--c-input': '#fbf6ec',
    '--c-surface-0': '#fbf6ec',
    '--c-surface-1': '#f6efe2',
    '--c-surface-2': '#efe6d4',
    '--c-surface-3': '#e7dbc4',
    '--c-surface-4': '#ddceb2',
    '--c-surface-5': '#d0bd9b',
    '--c-border-subtle': 'rgba(70, 55, 30, 0.10)',
    '--c-border-default': 'rgba(70, 55, 30, 0.18)',
    '--c-border-strong': 'rgba(70, 55, 30, 0.28)',
    '--c-text-primary': '#3a3326',
    '--c-text-secondary': 'rgba(58, 51, 38, 0.72)',
    '--c-text-muted': 'rgba(58, 51, 38, 0.52)',
    '--c-text-faint': 'rgba(58, 51, 38, 0.36)',
    '--c-accent': '#b07b3e',
    '--c-accent-hover': '#9c6a31',
    '--c-accent-soft': 'rgba(176, 123, 62, 0.12)',
    '--c-success': '#5b8c3e',
    '--c-warning': '#c08a2e',
    '--c-danger': '#c0563e',
    '--c-bubble-user': 'rgba(176, 123, 62, 0.12)',
    '--c-bubble-user-border': 'rgba(176, 123, 62, 0.24)',
    '--c-bubble-ai': 'rgba(120, 95, 55, 0.06)',
    '--c-bubble-ai-border': 'rgba(120, 95, 55, 0.12)',
  },
};

export const VAR_NAMES = Object.keys(BASE_THEME_VARS.midnight);

export function loadCustomThemes(): CustomTheme[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as CustomTheme[]) : [];
  } catch {
    return [];
  }
}

export function saveCustomThemes(themes: CustomTheme[]): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(themes));
}

export function createNewCustomTheme(baseId: string = 'midnight'): CustomTheme {
  return {
    id: `custom-${Date.now()}`,
    name: 'My Theme',
    group: 'dark',
    fontId: 'inter',
    vars: { ...(BASE_THEME_VARS[baseId] ?? BASE_THEME_VARS.midnight) },
    createdAt: Date.now(),
  };
}

export function persistAppliedCustomTheme(theme: CustomTheme): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(APPLIED_KEY, JSON.stringify(theme));
}

export function loadAppliedCustomTheme(): CustomTheme | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(APPLIED_KEY);
    return raw ? (JSON.parse(raw) as CustomTheme) : null;
  } catch {
    return null;
  }
}

export function clearAppliedCustomTheme(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(APPLIED_KEY);
}

export function applyCustomThemeToDOM(theme: CustomTheme): void {
  if (typeof document === 'undefined') return;
  const el = document.documentElement;
  for (const [key, value] of Object.entries(theme.vars)) {
    el.style.setProperty(key, value);
  }
}

export function clearCustomThemeFromDOM(): void {
  if (typeof document === 'undefined') return;
  const el = document.documentElement;
  for (const key of VAR_NAMES) {
    el.style.removeProperty(key);
  }
  el.style.removeProperty('--c-font-body');
}
