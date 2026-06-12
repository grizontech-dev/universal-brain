/**
 * Theme registry — single source of truth for the theme framework.
 *
 * A theme is a named palette defined in two places that must stay in sync:
 *   1. A `:root[data-theme="<id>"] { ... }` block in app/globals.css (the actual colors).
 *   2. An entry in THEMES below (metadata + preview swatches for the picker UI).
 *
 * To add a theme: add the CSS block + an entry here. No component edits needed.
 */

export interface ThemeMeta {
  /** Matches the `data-theme` attribute value and the globals.css palette block. */
  id: string;
  /** Display name shown in the dropdown and preview cards. */
  name: string;
  /** Short description shown under the name. */
  description: string;
  /** Coarse grouping, useful for ordering / future "system" auto-detect. */
  group: 'dark' | 'light';
  /** Representative swatch colors for the preview card (must be static hex, not vars). */
  preview: {
    app: string;
    sidebar: string;
    chat: string;
    accent: string;
    text: string;
  };
}

export const THEMES: ThemeMeta[] = [
  {
    id: 'midnight',
    name: 'Midnight',
    description: 'The classic deep-dark theme.',
    group: 'dark',
    preview: { app: '#09090b', sidebar: '#09090b', chat: '#0d0c14', accent: '#976df8', text: '#ffffff' },
  },
  {
    id: 'daylight',
    name: 'Daylight',
    description: 'Bright and clean — light background, dark text.',
    group: 'light',
    preview: { app: '#f7f7f8', sidebar: '#ffffff', chat: '#f4f4f6', accent: '#7c54e8', text: '#18181b' },
  },
  {
    id: 'twilight',
    name: 'Twilight',
    description: 'Best of both — dark sidebar with a lighter slate workspace.',
    group: 'dark',
    preview: { app: '#1b1f2a', sidebar: '#11141c', chat: '#232838', accent: '#5ea9ff', text: '#eef1f8' },
  },
  {
    id: 'parchment',
    name: 'Parchment',
    description: 'Warm, low-contrast sepia — easy on the eyes for long sessions.',
    group: 'light',
    preview: { app: '#f3ecde', sidebar: '#ece2cf', chat: '#f6efe2', accent: '#b07b3e', text: '#3a3326' },
  },
];

export const DEFAULT_THEME_ID = 'midnight';

/** localStorage key for the persisted theme id. */
export const THEME_STORAGE_KEY = 'grizon_theme';

const THEME_IDS = new Set(THEMES.map((t) => t.id));

export function isValidThemeId(id: string | null | undefined): id is string {
  return typeof id === 'string' && THEME_IDS.has(id);
}

export function getThemeMeta(id: string): ThemeMeta {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}
