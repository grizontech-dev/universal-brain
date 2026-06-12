/** Parse a CSS color value (hex or rgba) into { hex, alpha }. */
export function parseColor(value: string): { hex: string; alpha: number } {
  const rgba = value.match(/rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\s*\)/);
  if (rgba) {
    const r = parseInt(rgba[1]).toString(16).padStart(2, '0');
    const g = parseInt(rgba[2]).toString(16).padStart(2, '0');
    const b = parseInt(rgba[3]).toString(16).padStart(2, '0');
    const alpha = rgba[4] !== undefined ? parseFloat(rgba[4]) : 1;
    return { hex: `#${r}${g}${b}`, alpha };
  }
  if (value.startsWith('#')) {
    return { hex: value.slice(0, 7), alpha: 1 };
  }
  return { hex: '#000000', alpha: 1 };
}

/** Reconstruct a CSS value from hex + alpha. Returns hex if alpha === 1. */
export function toColorValue(hex: string, alpha: number, forceRgba = false): string {
  if (alpha >= 1 && !forceRgba) return hex;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const a = Math.round(alpha * 100) / 100;
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** True if the var is stored as rgba (needs opacity slider). */
export const RGBA_VARS = new Set([
  '--c-border-subtle',
  '--c-border-default',
  '--c-border-strong',
  '--c-text-secondary',
  '--c-text-muted',
  '--c-text-faint',
  '--c-accent-soft',
  '--c-bubble-user',
  '--c-bubble-user-border',
  '--c-bubble-ai',
  '--c-bubble-ai-border',
]);

export const COLOR_GROUPS: { label: string; vars: string[] }[] = [
  {
    label: 'Surfaces',
    vars: ['--c-app', '--c-sidebar', '--c-chat', '--c-card', '--c-elevated', '--c-input'],
  },
  {
    label: 'Raised Layers',
    vars: ['--c-surface-0', '--c-surface-1', '--c-surface-2', '--c-surface-3', '--c-surface-4', '--c-surface-5'],
  },
  {
    label: 'Borders',
    vars: ['--c-border-subtle', '--c-border-default', '--c-border-strong'],
  },
  {
    label: 'Text',
    vars: ['--c-text-primary', '--c-text-secondary', '--c-text-muted', '--c-text-faint'],
  },
  {
    label: 'Accent',
    vars: ['--c-accent', '--c-accent-hover', '--c-accent-soft'],
  },
  {
    label: 'Status',
    vars: ['--c-success', '--c-warning', '--c-danger'],
  },
  {
    label: 'Chat Bubbles',
    vars: ['--c-bubble-user', '--c-bubble-user-border', '--c-bubble-ai', '--c-bubble-ai-border'],
  },
];

/** Friendly label for a CSS var name. */
export function varLabel(name: string): string {
  return name
    .replace('--c-', '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Generate a slug-safe id from a theme name. */
export function nameToId(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'custom';
}
