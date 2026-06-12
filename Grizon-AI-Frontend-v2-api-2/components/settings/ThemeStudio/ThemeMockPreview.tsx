'use client';

import { useMemo } from 'react';
import type { ThemeVars } from '@/lib/custom-themes';
import { getFontMeta } from '@/lib/fonts';

interface Props {
  vars: ThemeVars;
  fontId: string;
  name: string;
}

export default function ThemeMockPreview({ vars, fontId, name }: Props) {
  const v = (key: string, fallback = 'transparent') => vars[key] ?? fallback;
  const fontMeta = useMemo(() => getFontMeta(fontId), [fontId]);
  const fontFamily = `var(${fontMeta.variable}), ${fontMeta.stack}`;

  const sidebarItems = ['Home', 'Explore', 'History', 'Settings'];
  const chatItems = ['Project Brief', 'Code Review', 'Marketing Plan'];

  return (
    <div
      className='w-full rounded-xl overflow-hidden border shadow-2xl select-none'
      style={{
        borderColor: v('--c-border-default'),
        fontFamily,
        aspectRatio: '16 / 10',
        minHeight: 0,
      }}
    >
      <div className='flex h-full'>
        {/* Sidebar */}
        <div
          className='flex flex-col shrink-0'
          style={{ width: '28%', background: v('--c-sidebar'), borderRight: `1px solid ${v('--c-border-subtle')}` }}
        >
          {/* Logo row */}
          <div
            className='flex items-center gap-2 px-3 py-3'
            style={{ borderBottom: `1px solid ${v('--c-border-subtle')}` }}
          >
            <div
              className='w-5 h-5 rounded-md flex items-center justify-center text-[9px] font-black'
              style={{ background: v('--c-accent'), color: '#fff' }}
            >
              G
            </div>
            <span className='text-[11px] font-bold' style={{ color: v('--c-text-primary') }}>
              Grizon
            </span>
          </div>

          {/* Nav items */}
          <div className='flex flex-col gap-0.5 px-2 py-2'>
            {sidebarItems.map((item, i) => (
              <div
                key={item}
                className='flex items-center gap-2 px-2 py-1 rounded-md'
                style={{
                  background: i === 0 ? v('--c-accent-soft') : 'transparent',
                  color: i === 0 ? v('--c-accent') : v('--c-text-muted'),
                  fontSize: 10,
                  fontWeight: i === 0 ? 600 : 400,
                }}
              >
                <div
                  className='w-2 h-2 rounded-sm'
                  style={{ background: i === 0 ? v('--c-accent') : v('--c-border-default') }}
                />
                {item}
              </div>
            ))}
          </div>

          {/* Divider */}
          <div style={{ height: 1, background: v('--c-border-subtle'), margin: '4px 8px' }} />

          {/* Chat list */}
          <div className='flex flex-col gap-0.5 px-2 py-1 flex-1 overflow-hidden'>
            <div className='text-[8px] font-bold px-2 mb-1' style={{ color: v('--c-text-faint') }}>
              RECENT
            </div>
            {chatItems.map((item, i) => (
              <div
                key={item}
                className='px-2 py-1 rounded-md truncate'
                style={{
                  background: i === 1 ? v('--c-surface-2') : 'transparent',
                  color: i === 1 ? v('--c-text-primary') : v('--c-text-muted'),
                  fontSize: 9,
                }}
              >
                {item}
              </div>
            ))}
          </div>
        </div>

        {/* Main chat area */}
        <div className='flex flex-col flex-1 min-w-0' style={{ background: v('--c-chat') }}>
          {/* Chat header */}
          <div
            className='flex items-center justify-between px-4 py-2.5 shrink-0'
            style={{ borderBottom: `1px solid ${v('--c-border-subtle')}`, background: v('--c-card') }}
          >
            <div>
              <div className='text-[11px] font-semibold' style={{ color: v('--c-text-primary') }}>
                {name || 'My Theme'}
              </div>
              <div className='text-[8px]' style={{ color: v('--c-text-faint') }}>
                Theme preview
              </div>
            </div>
            <div className='flex items-center gap-1'>
              {['--c-success', '--c-warning', '--c-danger'].map((k) => (
                <div key={k} className='w-2 h-2 rounded-full' style={{ background: v(k) }} />
              ))}
            </div>
          </div>

          {/* Messages */}
          <div className='flex flex-col gap-2 flex-1 overflow-hidden px-3 py-3'>
            {/* AI bubble */}
            <div className='flex items-start gap-2 max-w-[85%]'>
              <div
                className='w-5 h-5 rounded-full shrink-0 flex items-center justify-center text-[8px] font-bold mt-0.5'
                style={{ background: v('--c-accent'), color: '#fff' }}
              >
                AI
              </div>
              <div
                className='rounded-xl rounded-tl-sm px-3 py-2'
                style={{
                  background: v('--c-bubble-ai'),
                  border: `1px solid ${v('--c-bubble-ai-border')}`,
                  color: v('--c-text-primary'),
                  fontSize: 9,
                  lineHeight: 1.5,
                }}
              >
                Hello! I'm Grizon AI. How can I help you today? I can assist with coding, writing, analysis, and more.
              </div>
            </div>

            {/* User bubble */}
            <div className='flex items-start gap-2 max-w-[75%] self-end flex-row-reverse'>
              <div
                className='w-5 h-5 rounded-full shrink-0 flex items-center justify-center text-[8px] font-bold mt-0.5'
                style={{ background: v('--c-surface-4'), color: v('--c-text-secondary') }}
              >
                U
              </div>
              <div
                className='rounded-xl rounded-tr-sm px-3 py-2'
                style={{
                  background: v('--c-bubble-user'),
                  border: `1px solid ${v('--c-bubble-user-border')}`,
                  color: v('--c-text-primary'),
                  fontSize: 9,
                  lineHeight: 1.5,
                }}
              >
                Can you help me design a new theme for my app?
              </div>
            </div>

            {/* Second AI reply */}
            <div className='flex items-start gap-2 max-w-[85%]'>
              <div
                className='w-5 h-5 rounded-full shrink-0 flex items-center justify-center text-[8px] font-bold mt-0.5'
                style={{ background: v('--c-accent'), color: '#fff' }}
              >
                AI
              </div>
              <div
                className='rounded-xl rounded-tl-sm px-3 py-2'
                style={{
                  background: v('--c-bubble-ai'),
                  border: `1px solid ${v('--c-bubble-ai-border')}`,
                  color: v('--c-text-primary'),
                  fontSize: 9,
                  lineHeight: 1.5,
                }}
              >
                Of course! You're looking at your theme live right now. Adjust the colors on the right.
              </div>
            </div>
          </div>

          {/* Input bar */}
          <div
            className='shrink-0 px-3 py-2.5'
            style={{ borderTop: `1px solid ${v('--c-border-subtle')}` }}
          >
            <div
              className='flex items-center gap-2 px-3 py-2 rounded-xl'
              style={{
                background: v('--c-input'),
                border: `1px solid ${v('--c-border-default')}`,
              }}
            >
              <span className='flex-1 text-[9px]' style={{ color: v('--c-text-faint') }}>
                Message Grizon…
              </span>
              <div
                className='w-5 h-5 rounded-lg flex items-center justify-center text-[8px]'
                style={{ background: v('--c-accent'), color: '#fff' }}
              >
                ↑
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
