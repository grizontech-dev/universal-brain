'use client';

import { useState, useCallback } from 'react';
import { ChevronDown, ChevronRight, Download, Check, X } from 'lucide-react';
import type { CustomTheme } from '@/lib/custom-themes';
import { BASE_THEME_VARS, applyCustomThemeToDOM, clearCustomThemeFromDOM, persistAppliedCustomTheme } from '@/lib/custom-themes';
import { FONTS } from '@/lib/fonts';
import { COLOR_GROUPS, varLabel, nameToId } from './utils';
import ThemeMockPreview from './ThemeMockPreview';
import ColorInput from './ColorInput';

const BASE_THEME_IDS = ['midnight', 'daylight', 'twilight', 'parchment'] as const;
const BASE_LABELS: Record<string, string> = {
  midnight: 'Midnight',
  daylight: 'Daylight',
  twilight: 'Twilight',
  parchment: 'Parchment',
};

interface Props {
  initial: CustomTheme;
  onSave: (theme: CustomTheme) => void;
  onDiscard: () => void;
}

export default function ThemeEditor({ initial, onSave, onDiscard }: Props) {
  const [theme, setTheme] = useState<CustomTheme>(initial);
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set(['Surfaces']));
  const [applied, setApplied] = useState(false);
  const [saved, setSaved] = useState(false);

  const updateVar = useCallback((varName: string, value: string) => {
    setTheme((prev) => ({ ...prev, vars: { ...prev.vars, [varName]: value } }));
    setSaved(false);
  }, []);

  const setBase = useCallback((baseId: string) => {
    setTheme((prev) => ({
      ...prev,
      group: baseId === 'daylight' || baseId === 'parchment' ? 'light' : 'dark',
      vars: { ...BASE_THEME_VARS[baseId] },
    }));
    setSaved(false);
  }, []);

  const toggleGroup = useCallback((label: string) => {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }, []);

  const handleApply = useCallback(() => {
    applyCustomThemeToDOM(theme);
    persistAppliedCustomTheme(theme);
    const fontMeta = FONTS.find((f) => f.id === theme.fontId);
    if (fontMeta) {
      document.documentElement.style.setProperty('--c-font-body', `var(${fontMeta.variable})`);
    }
    setApplied(true);
  }, [theme]);

  const handleSave = useCallback(() => {
    onSave(theme);
    setSaved(true);
  }, [theme, onSave]);

  const handleDiscard = useCallback(() => {
    clearCustomThemeFromDOM();
    onDiscard();
  }, [onDiscard]);

  const handleExport = useCallback(() => {
    const id = nameToId(theme.name);
    const fontMeta = FONTS.find((f) => f.id === theme.fontId);
    const previewVars = theme.vars;

    const cssBlock = `:root[data-theme="${id}"] {\n${Object.entries(theme.vars)
      .map(([k, v]) => `  ${k}: ${v};`)
      .join('\n')}\n}`;

    const tsEntry = `{ id: '${id}', name: '${theme.name}', description: '', group: '${theme.group}', preview: { app: '${previewVars['--c-app']}', sidebar: '${previewVars['--c-sidebar']}', chat: '${previewVars['--c-chat']}', accent: '${previewVars['--c-accent']}', text: '${previewVars['--c-text-primary']}' } }`;

    const md = `# ${theme.name}\n\ngroup: ${theme.group}\nfont_id: ${theme.fontId}\nfont_name: ${fontMeta?.name ?? 'Inter'}\nfont_variable: ${fontMeta?.variable ?? '--font-inter'}\n\n## globals.css\n\n\`\`\`css\n${cssBlock}\n\`\`\`\n\n## themes.ts\n\n\`\`\`ts\n${tsEntry}\n\`\`\`\n`;

    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${id}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }, [theme]);

  return (
    <div className='flex flex-col h-full min-h-0'>
      {/* Top bar */}
      <div className='flex items-center justify-between px-6 py-4 border-b border-border-subtle shrink-0'>
        <div className='flex items-center gap-3'>
          <button
            onClick={handleDiscard}
            className='flex items-center gap-1.5 text-[11px] font-bold text-text-faint hover:text-text-primary transition-colors uppercase tracking-wider'
          >
            <X size={13} strokeWidth={3} />
            Discard
          </button>
          <span className='text-border-default'>·</span>
          <span className='text-[13px] font-semibold text-text-primary'>
            {theme.name || 'Untitled Theme'}
          </span>
        </div>
        <div className='flex items-center gap-2'>
          <button
            onClick={handleExport}
            className='flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border-default text-[12px] font-semibold text-text-secondary hover:text-text-primary hover:border-border-strong transition-all'
          >
            <Download size={13} />
            Export .md
          </button>
          <button
            onClick={handleSave}
            className='flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border-default text-[12px] font-semibold text-text-secondary hover:text-text-primary hover:border-border-strong transition-all'
          >
            {saved ? <Check size={13} className='text-green-400' /> : null}
            Save
          </button>
          <button
            onClick={handleApply}
            className='flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-[12px] font-bold transition-all'
            style={{
              background: applied ? '#34d399' : theme.vars['--c-accent'] ?? '#976df8',
              color: '#fff',
            }}
          >
            {applied ? <Check size={13} /> : null}
            {applied ? 'Applied' : 'Apply to App'}
          </button>
        </div>
      </div>

      {/* Split body */}
      <div className='flex flex-1 min-h-0 overflow-hidden'>
        {/* Left: mock preview */}
        <div className='flex-1 min-w-0 flex flex-col items-center justify-center p-6 bg-surface-1 border-r border-border-subtle overflow-hidden'>
          <div className='w-full max-w-[560px]'>
            <ThemeMockPreview vars={theme.vars} fontId={theme.fontId} name={theme.name} />
          </div>
          <p className='text-[10px] text-text-faint mt-4 text-center'>
            Preview only — click <span className='font-semibold'>Apply to App</span> to see it live
          </p>
        </div>

        {/* Right: parameter panel */}
        <div className='w-[360px] shrink-0 flex flex-col overflow-y-auto custom-scrollbar'>
          <div className='p-5 space-y-5'>
            {/* Identity */}
            <div className='space-y-3'>
              <p className='text-[10px] font-bold text-text-faint uppercase tracking-wider'>Identity</p>
              <div className='space-y-1'>
                <label className='text-[11px] font-medium text-text-secondary'>Theme Name</label>
                <input
                  type='text'
                  value={theme.name}
                  onChange={(e) => { setTheme((p) => ({ ...p, name: e.target.value })); setSaved(false); }}
                  placeholder='My Theme'
                  className='w-full bg-input border border-border-default rounded-lg px-3 py-2 text-[13px] text-text-primary focus:outline-none focus:border-accent'
                />
                <p className='text-[10px] text-text-faint'>ID: {nameToId(theme.name) || 'my-theme'}</p>
              </div>
              <div className='flex gap-2'>
                {(['dark', 'light'] as const).map((g) => (
                  <button
                    key={g}
                    onClick={() => { setTheme((p) => ({ ...p, group: g })); setSaved(false); }}
                    className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold border transition-all capitalize ${theme.group === g ? '' : 'border-border-default text-text-muted hover:text-text-primary'}`}
                    style={
                      theme.group === g
                        ? { background: theme.vars['--c-accent'] + '20', borderColor: theme.vars['--c-accent'], color: theme.vars['--c-accent'] }
                        : undefined
                    }
                  >
                    {g}
                  </button>
                ))}
              </div>
            </div>

            {/* Font */}
            <div className='space-y-2'>
              <p className='text-[10px] font-bold text-text-faint uppercase tracking-wider'>Font</p>
              <select
                value={theme.fontId}
                onChange={(e) => { setTheme((p) => ({ ...p, fontId: e.target.value })); setSaved(false); }}
                className='w-full bg-input border border-border-default rounded-lg px-3 py-2 text-[13px] text-text-primary focus:outline-none focus:border-accent'
              >
                {FONTS.map((f) => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </select>
            </div>

            {/* Start from */}
            <div className='space-y-2'>
              <p className='text-[10px] font-bold text-text-faint uppercase tracking-wider'>Start From</p>
              <div className='grid grid-cols-4 gap-1.5'>
                {BASE_THEME_IDS.map((id) => (
                  <button
                    key={id}
                    onClick={() => setBase(id)}
                    className='px-2 py-1.5 rounded-lg border border-border-default text-[10px] font-semibold text-text-muted hover:text-text-primary hover:border-border-strong transition-all text-center'
                  >
                    {BASE_LABELS[id]}
                  </button>
                ))}
              </div>
            </div>

            {/* Divider */}
            <div className='h-px bg-border-subtle' />

            {/* Color groups */}
            {COLOR_GROUPS.map((group) => (
              <div key={group.label} className='space-y-2'>
                <button
                  onClick={() => toggleGroup(group.label)}
                  className='flex items-center gap-1.5 w-full text-left'
                >
                  {openGroups.has(group.label)
                    ? <ChevronDown size={13} className='text-text-muted' />
                    : <ChevronRight size={13} className='text-text-muted' />
                  }
                  <span className='text-[10px] font-bold text-text-faint uppercase tracking-wider'>
                    {group.label}
                  </span>
                </button>

                {openGroups.has(group.label) && (
                  <div className='space-y-2 pl-4'>
                    {group.vars.map((varName) => (
                      <div key={varName} className='flex items-center justify-between gap-3'>
                        <span className='text-[11px] text-text-secondary shrink-0 w-28'>
                          {varLabel(varName)}
                        </span>
                        <ColorInput
                          varName={varName}
                          value={theme.vars[varName] ?? '#000000'}
                          onChange={updateVar}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
