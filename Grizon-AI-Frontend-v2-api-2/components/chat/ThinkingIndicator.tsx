'use client';

import React from 'react';
import { Clock } from 'lucide-react';
import {
  formatDurationMs,
  StreamOutputTokenChip,
  type StreamOutputTokenDisplay,
} from './AgentMessage';

interface ThinkingIndicatorProps {
  agentName?: string;
  avatarSrc?: string;
  statusLine?: string | null;
  streamOutputTokens?: StreamOutputTokenDisplay | null;
  streamElapsedMs?: number | null;
}

const headerChipClass =
  'inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white/[0.03] border border-white/[0.04] text-[10px] font-medium text-white/35 tracking-tight whitespace-nowrap tabular-nums';

export default function ThinkingIndicator({
  agentName = 'Grizon AI',
  avatarSrc = '/Logo.svg',
  statusLine,
  streamOutputTokens = null,
  streamElapsedMs = null,
}: ThinkingIndicatorProps) {
  const showStreamMeta = streamElapsedMs != null;

  return (
    <div className="flex flex-col items-start gap-1.5 pb-2 pt-1 animate-in fade-in duration-200">
      <div className="flex items-center gap-2 min-w-0 flex-wrap">
        <div className="w-6 h-6 shrink-0">
          <img
            src={avatarSrc}
            alt={agentName}
            className="w-full h-full object-contain brightness-110"
          />
        </div>
        <span className="text-[13px] font-black text-text-primary tracking-tight uppercase">
          {agentName}
        </span>
        {showStreamMeta ? (
          <>
            {streamElapsedMs != null ? (
              <span className={headerChipClass}>
                <Clock size={10} className="text-white/25" />
                {formatDurationMs(streamElapsedMs)}
              </span>
            ) : null}
            {streamOutputTokens ? <StreamOutputTokenChip display={streamOutputTokens} /> : null}
          </>
        ) : null}
        <span className="text-[11px] text-white/25 tabular-nums">Streaming</span>
        <span className="flex items-center gap-1 ml-0.5" aria-label="Thinking">
          <span
            className="w-1.5 h-1.5 rounded-full bg-accent/80 animate-pulse"
            style={{ animationDelay: '0ms' }}
          />
          <span
            className="w-1.5 h-1.5 rounded-full bg-accent/70 animate-pulse"
            style={{ animationDelay: '160ms' }}
          />
          <span
            className="w-1.5 h-1.5 rounded-full bg-accent/60 animate-pulse"
            style={{ animationDelay: '320ms' }}
          />
        </span>
      </div>
      {statusLine ? (
        <p className="text-[11px] text-text-muted pl-8 leading-snug line-clamp-1">
          {statusLine}
        </p>
      ) : null}
    </div>
  );
}
