# Theming — How to Add a Theme

A theme = a palette of `--c-*` CSS vars applied via `data-theme="<id>"` on `<html>`.
Tailwind utilities resolve to those vars through `@theme inline`, so switching the
attribute repaints everything with zero re-render. **Adding a theme touches only 2 files.**

## Add a new theme (2 steps)

### 1. `app/globals.css` — add a palette block
Copy the `:root[data-theme="midnight"]` block and recolor every `--c-*`. **Define all of
them** (missing vars fall back to `:root`/midnight and look wrong on light themes).

```css
:root[data-theme="<id>"] {
  /* surfaces */     --c-app --c-sidebar --c-chat --c-card --c-elevated --c-input
  /* surface scale */ --c-surface-0 … --c-surface-5   /* 0 = base, 5 = most raised */
  /* borders */      --c-border-subtle --c-border-default --c-border-strong
  /* text */         --c-text-primary --c-text-secondary --c-text-muted --c-text-faint
  /* accent+state */ --c-accent --c-accent-hover --c-accent-soft --c-success --c-warning --c-danger
  /* bubbles */      --c-bubble-user --c-bubble-user-border --c-bubble-ai --c-bubble-ai-border
}
```

### 2. `lib/themes.ts` — add a registry entry
Drives the dropdown + preview card. `preview` = static hexes (no vars).

```ts
{ id: '<id>', name: '<Name>', description: '...', group: 'dark' | 'light',
  preview: { app, sidebar, chat, accent, text } }
```

Also add `<id>` to the `valid` map in the no-flash script in `app/layout.tsx`
(`THEME_INIT_SCRIPT`). That's it — no component edits.

## Palette rules
- **Dark theme:** borders/overlays use white-alpha (`rgba(255,255,255,…)`); text = white → faint white.
- **Light/warm theme:** flip overlays to black/brown-alpha (`rgba(0,0,0,…)`); text = dark → faint dark. (This is *why* migration off `text-white/40` matters — literal whites vanish on light.)
- `--c-surface-0..5` go base→raised. On dark, lighter as number rises; on light, darker as number rises.
- `--c-accent-soft` = low-alpha accent fill for chips/badges.

## Token → utility cheat sheet (use these, never raw hex)
| Use | Utility |
|---|---|
| app / sidebar / chat / card / input bg | `bg-app` `bg-sidebar` `bg-chat` `bg-card` `bg-input` |
| raised surfaces | `bg-surface-1…5` |
| borders | `border-border-subtle` `-default` `-strong` |
| text | `text-text-primary` `-secondary` `-muted` `-faint` |
| accent | `bg-accent` `hover:bg-accent-hover` `text-accent` `bg-accent/10` `border-accent/20` |
| bubbles | `bg-bubble-user` `border-bubble-user-border` `bg-bubble-ai` `border-bubble-ai-border` |
| alpha | append `/NN` (e.g. `bg-accent/15`, `text-text-muted`) |

## Do NOT tokenize (fixed islands — keep dark)
Monaco/code-block surfaces, `.hljs` syntax colors, Mermaid config, Siri/voice orb gradients,
decorative file-type icon gradients, white-branded buttons (Google / primary CTA `bg-white text-gray-950`).

## Plumbing (already built — reference only)
- Palettes + `@theme inline` map: `app/globals.css`
- Registry: `lib/themes.ts` (`THEMES`, `DEFAULT_THEME_ID`, `THEME_STORAGE_KEY`, `isValidThemeId`)
- State: `context/ThemeContext.tsx` → `useTheme()` = `{ themeId, themes, setTheme }`; persists to `localStorage['grizon_theme']`. Account-sync hooks marked `FUTURE`.
- No-flash script + `<ThemeProvider>`: `app/layout.tsx`
- Picker UI (dropdown + preview grid): `components/chat/SettingsView.tsx` (Appearance card)

## Verify
`npm run build`, then in-browser:
```js
document.documentElement.setAttribute('data-theme','<id>')
```
Body bg/text and all regions should repaint. Check a light theme for legibility across
chat, settings, auth, landing.
