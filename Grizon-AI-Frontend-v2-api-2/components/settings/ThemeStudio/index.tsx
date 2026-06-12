'use client';

import { useState, useEffect, useCallback } from 'react';
import type { CustomTheme } from '@/lib/custom-themes';
import {
  loadCustomThemes,
  saveCustomThemes,
  createNewCustomTheme,
  clearCustomThemeFromDOM,
} from '@/lib/custom-themes';
import ThemeLibrary from './ThemeLibrary';
import ThemeEditor from './ThemeEditor';

type Screen = { view: 'library' } | { view: 'editor'; theme: CustomTheme };

export default function ThemeStudio() {
  const [customThemes, setCustomThemes] = useState<CustomTheme[]>([]);
  const [screen, setScreen] = useState<Screen>({ view: 'library' });

  // Load from localStorage on mount only
  useEffect(() => {
    setCustomThemes(loadCustomThemes());
  }, []);

  const handleNew = useCallback(() => {
    const fresh = createNewCustomTheme('midnight');
    setScreen({ view: 'editor', theme: fresh });
  }, []);

  const handleEdit = useCallback((theme: CustomTheme) => {
    setScreen({ view: 'editor', theme });
  }, []);

  const handleSave = useCallback((theme: CustomTheme) => {
    setCustomThemes((prev) => {
      const idx = prev.findIndex((t) => t.id === theme.id);
      let next: CustomTheme[];
      if (idx >= 0) {
        next = [...prev];
        next[idx] = theme;
      } else {
        next = [...prev, theme];
      }
      saveCustomThemes(next);
      return next;
    });
  }, []);

  const handleDiscard = useCallback(() => {
    clearCustomThemeFromDOM();
    setScreen({ view: 'library' });
  }, []);

  const handleDelete = useCallback((id: string) => {
    setCustomThemes((prev) => {
      const next = prev.filter((t) => t.id !== id);
      saveCustomThemes(next);
      return next;
    });
  }, []);

  if (screen.view === 'editor') {
    return (
      <ThemeEditor
        initial={screen.theme}
        onSave={handleSave}
        onDiscard={handleDiscard}
      />
    );
  }

  return (
    <ThemeLibrary
      customThemes={customThemes}
      onNew={handleNew}
      onEdit={handleEdit}
      onDelete={handleDelete}
    />
  );
}
