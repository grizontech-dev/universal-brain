'use client';

import { useState } from 'react';
import { Plus, Play, Pencil, Download, Trash2, Check } from 'lucide-react';
import { THEMES } from '@/lib/themes';
import { FONTS, getFontMeta } from '@/lib/fonts';
import { BASE_THEME_VARS } from '@/lib/custom-themes';
import { nameToId } from './utils';
import type { CustomTheme } from '@/lib/custom-themes';
import { applyCustomThemeToDOM, persistAppliedCustomTheme } from '@/lib/custom-themes';
import { useTheme } from '@/context/ThemeContext';

interface Props {
  customThemes: CustomTheme[];
  onNew: () => void;
  onEdit: (theme: CustomTheme) => void;
  onDelete: (id: string) => void;
}

function SwatchStrip({ vars }: { vars: Record<string, string> }) {
  const keys = ['--c-sidebar', '--c-chat', '--c-accent', '--c-success', '--c-danger'];
  return (
    <div className='flex h-3 rounded-full overflow-hidden border border-border-subtle'>
      {keys.map((k) => (
        <div key={k} className='flex-1' style={{ background: vars[k] ?? '#888' }} />
      ))}
    </div>
  );
}

function BuiltInCard({ id, name, description }: { id: string; name: string; description: string }) {
  const { themeId, setTheme } = useTheme();
  const active = themeId === id;
  const vars = BASE_THEME_VARS[id] ?? BASE_THEME_VARS.midnight;

  return (
    <div className={`rounded-xl border p-4 flex flex-col gap-3 transition-all ${active ? 'border-accent/50 bg-accent/5' : 'border-border-subtle bg-card hover:border-border-default'}`}>
      <SwatchStrip vars={vars} />
      <div className='flex-1'>
        <div className='flex items-center gap-2'>
          <p className='text-[13px] font-semibold text-text-primary'>{name}</p>
          {active && (
            <span className='text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-accent/15 text-accent'>
              Active
            </span>
          )}
        </div>
        <p className='text-[11px] text-text-muted mt-0.5'>{description}</p>
      </div>
      <button
        onClick={() => setTheme(id)}
        disabled={active}
        className='flex items-center justify-center gap-1.5 w-full px-3 py-1.5 rounded-lg border text-[11px] font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed border-border-default text-text-secondary hover:border-accent/50 hover:text-accent'
      >
        {active ? <Check size={12} /> : <Play size={12} />}
        {active ? 'Applied' : 'Apply'}
      </button>
    </div>
  );
}

function CustomCard({
  theme,
  onEdit,
  onDelete,
}: {
  theme: CustomTheme;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [applied, setApplied] = useState(false);
  const fontName = getFontMeta(theme.fontId).name;

  const handleApply = () => {
    applyCustomThemeToDOM(theme);
    persistAppliedCustomTheme(theme);
    const fontMeta = FONTS.find((f) => f.id === theme.fontId);
    if (fontMeta) {
      document.documentElement.style.setProperty('--c-font-body', `var(${fontMeta.variable})`);
    }
    setApplied(true);
    setTimeout(() => setApplied(false), 2000);
  };

  const handleExport = () => {
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
  };

  return (
    <div className='rounded-xl border border-border-subtle bg-card p-4 flex flex-col gap-3 hover:border-border-default transition-all'>
      <SwatchStrip vars={theme.vars} />
      <div className='flex-1'>
        <p className='text-[13px] font-semibold text-text-primary'>{theme.name}</p>
        <p className='text-[11px] text-text-muted mt-0.5 capitalize'>
          {theme.group} · {fontName}
        </p>
      </div>
      <div className='grid grid-cols-2 gap-1.5'>
        <button
          onClick={handleApply}
          className='flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg border border-border-default text-[11px] font-semibold text-text-secondary hover:border-accent/50 hover:text-accent transition-all'
        >
          {applied ? <Check size={11} className='text-green-400' /> : <Play size={11} />}
          {applied ? 'Applied' : 'Apply'}
        </button>
        <button
          onClick={onEdit}
          className='flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg border border-border-default text-[11px] font-semibold text-text-secondary hover:border-border-strong hover:text-text-primary transition-all'
        >
          <Pencil size={11} />
          Edit
        </button>
        <button
          onClick={handleExport}
          className='flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg border border-border-default text-[11px] font-semibold text-text-secondary hover:border-border-strong hover:text-text-primary transition-all'
        >
          <Download size={11} />
          Export
        </button>
        {confirmDelete ? (
          <button
            onClick={onDelete}
            className='flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg border border-red-500/50 text-[11px] font-semibold text-red-400 hover:bg-red-500/10 transition-all'
          >
            Confirm
          </button>
        ) : (
          <button
            onClick={() => setConfirmDelete(true)}
            className='flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg border border-border-default text-[11px] font-semibold text-text-secondary hover:border-red-500/50 hover:text-red-400 transition-all'
          >
            <Trash2 size={11} />
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

export default function ThemeLibrary({ customThemes, onNew, onEdit, onDelete }: Props) {
  return (
    <div className='p-6 space-y-8'>
      {/* Built-in themes */}
      <div>
        <div className='flex items-center justify-between mb-4'>
          <div>
            <p className='text-[10px] font-bold text-text-faint uppercase tracking-wider'>Built-in Themes</p>
            <p className='text-[12px] text-text-muted mt-0.5'>Read-only. Apply only.</p>
          </div>
        </div>
        <div className='grid grid-cols-2 md:grid-cols-4 gap-3'>
          {THEMES.map((t) => (
            <BuiltInCard key={t.id} id={t.id} name={t.name} description={t.description} />
          ))}
        </div>
      </div>

      {/* Custom themes */}
      <div>
        <div className='flex items-center justify-between mb-4'>
          <div>
            <p className='text-[10px] font-bold text-text-faint uppercase tracking-wider'>Custom Themes</p>
            <p className='text-[12px] text-text-muted mt-0.5'>Stored locally. Export to hard-implement.</p>
          </div>
          <button
            onClick={onNew}
            className='flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-white text-[12px] font-bold hover:bg-accent-hover transition-colors'
          >
            <Plus size={13} />
            New Theme
          </button>
        </div>

        {customThemes.length === 0 ? (
          <div className='rounded-xl border border-dashed border-border-default p-10 flex flex-col items-center justify-center gap-3'>
            <p className='text-[13px] text-text-muted'>No custom themes yet.</p>
            <button
              onClick={onNew}
              className='flex items-center gap-1.5 px-4 py-2 rounded-lg bg-accent text-white text-[12px] font-bold hover:bg-accent-hover transition-colors'
            >
              <Plus size={13} />
              Create your first theme
            </button>
          </div>
        ) : (
          <div className='grid grid-cols-2 md:grid-cols-3 gap-3'>
            {customThemes.map((t) => (
              <CustomCard
                key={t.id}
                theme={t}
                onEdit={() => onEdit(t)}
                onDelete={() => onDelete(t.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
