export interface FontMeta {
  id: string;
  name: string;
  variable: string;
  stack: string;
}

export const FONTS: FontMeta[] = [
  { id: 'inter',         name: 'Inter',             variable: '--font-inter',         stack: 'Inter, sans-serif' },
  { id: 'dm-sans',       name: 'DM Sans',           variable: '--font-dm-sans',       stack: 'DM Sans, sans-serif' },
  { id: 'space-grotesk', name: 'Space Grotesk',     variable: '--font-space-grotesk', stack: 'Space Grotesk, sans-serif' },
  { id: 'sora',          name: 'Sora',              variable: '--font-sora',          stack: 'Sora, sans-serif' },
  { id: 'plus-jakarta',  name: 'Plus Jakarta Sans', variable: '--font-plus-jakarta',  stack: 'Plus Jakarta Sans, sans-serif' },
  { id: 'ibm-plex',      name: 'IBM Plex Sans',     variable: '--font-ibm-plex',      stack: 'IBM Plex Sans, sans-serif' },
  { id: 'nunito',        name: 'Nunito',            variable: '--font-nunito',        stack: 'Nunito, sans-serif' },
  { id: 'outfit',        name: 'Outfit',            variable: '--font-outfit',        stack: 'Outfit, sans-serif' },
];

export const DEFAULT_FONT_ID = 'inter';

export function getFontMeta(id: string): FontMeta {
  return FONTS.find((f) => f.id === id) ?? FONTS[0];
}
