import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  // NOTE: Color tokens are defined in app/globals.css via `@theme inline`
  // (Tailwind v4 CSS-first config), driven by `data-theme` palettes. Do not
  // re-declare colors here — see lib/themes.ts and the THEME PALETTES section.
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-sans)', 'sans-serif'],
        mono: ['var(--font-mono)', 'monospace'],
      },
    },
  },
  plugins: [],
};

export default config;
