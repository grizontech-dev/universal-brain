"use client";

import React, { useState } from 'react';
import {
  Sparkles,
  Search,
  Coins,
  Copy,
  Check,
  Loader2,
  Wrench,
  ChevronDown,
  Clock,
} from 'lucide-react';

import { MarkdownRenderer } from './MarkdownRenderer';
import MessageArtifactRows from './MessageArtifactRows';
import type { ApiCitation, ApiMessageArtifact, MessageStatus, PromptBreakdown } from '@/lib/chat-contracts';

export interface AgentMessageTool {
  name: string;
  icon?: React.ComponentType<{ size?: number; className?: string }>;
  color?: string;
  bgColor?: string;
  borderColor?: string;
  /** When set, shows a spinner (running) or check (done) beside the tool name. */
  status?: 'running' | 'done';
  /** One line of context (e.g. search query or result summary). */
  subtitle?: string;
}

export interface AgentMessageProps {
  content: string | React.ReactNode;
  dateTime: string;
  agentName?: string;
  avatarSrc?: string;
  model?: string;
  creditsDeducted?: number;
  webSearch?: boolean;
  tools?: AgentMessageTool[];
  isLoading?: boolean;
  messageStatus?: MessageStatus;
  generationStats?: AgentMessageGenerationStats | null;
  promptBreakdown?: PromptBreakdown | null;
  /** Live stream: output token estimate or exact count (header, beside timer). */
  streamOutputTokens?: StreamOutputTokenDisplay | null;
  /** Live stream: elapsed ms since job start (shown in header while streaming). */
  streamElapsedMs?: number | null;
  /** System-generated files for this assistant message. */
  artifacts?: ApiMessageArtifact[];
  citations?: ApiCitation[];
  onArtifactError?: (message: string) => void;
  onViewArtifact?: (artifact: ApiMessageArtifact) => void;
}

export interface AgentMessageGenerationStats {
  durationMs: number;
  llmFirstTokenMs: number | null;
  llmTotalMs: number | null;
  tokensUsed: {
    input: number;
    inputCached: number;
    output: number;
    cacheWrite: number;
  };
}

/** Live stream output-token counter (estimate or exact). */
export interface StreamOutputTokenDisplay {
  label: string;
  isEstimated: boolean;
  tooltip: StreamTokenTooltip | null;
}

export interface StreamTokenTooltip {
  output: number;
  inputFresh: number;
  inputCached: number;
  creditsUsed: number;
}

export function formatDurationMs(value: number): string {
  const ms = Math.max(0, Math.round(value));
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

const footerChipClass =
  'inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white/[0.03] border border-white/[0.04] text-[10px] font-medium text-white/35 tracking-tight whitespace-nowrap';

function formatTokenCount(n: number): string {
  return Math.max(0, Math.round(n)).toLocaleString();
}

const PROMPT_BREAKDOWN_PARTS: Array<{
  key: keyof PromptBreakdown;
  legend: string;
  colorClass: string;
}> = [
  { key: 'system_tokens', legend: 'Sys', colorClass: 'bg-violet-300/80' },
  { key: 'context_tokens', legend: 'Ctx', colorClass: 'bg-sky-300/80' },
  { key: 'message_tokens', legend: 'Msg', colorClass: 'bg-emerald-300/80' },
  { key: 'tool_result_tokens', legend: 'Tool', colorClass: 'bg-amber-300/85' },
  { key: 'response_tokens', legend: 'Resp', colorClass: 'bg-pink-300/80' },
];

function hasPromptBreakdownData(promptBreakdown?: PromptBreakdown | null): boolean {
  if (!promptBreakdown) return false;
  return PROMPT_BREAKDOWN_PARTS.some(({ key }) => typeof promptBreakdown[key] === 'number');
}

function formatCompactK(value: number): string {
  if (!Number.isFinite(value)) return '0';
  if (value < 1000) return `${Math.round(value)}`;
  if (value < 10_000) return `${(value / 1000).toFixed(1)}K`;
  return `${Math.round(value / 1000)}K`;
}

function PromptBreakdownTooltip({ promptBreakdown }: { promptBreakdown: PromptBreakdown }) {
  const total =
    typeof promptBreakdown.total_input_actual === 'number' && promptBreakdown.total_input_actual > 0
      ? promptBreakdown.total_input_actual
      : PROMPT_BREAKDOWN_PARTS.reduce((sum, { key }) => {
          const value = promptBreakdown[key];
          return sum + (typeof value === 'number' ? value : 0);
        }, 0);
  const segments = PROMPT_BREAKDOWN_PARTS.map(({ key, legend, colorClass }) => {
    const value = promptBreakdown[key];
    if (typeof value !== 'number' || value <= 0) return null;
    return {
      key,
      legend,
      colorClass,
      value,
      pct: total > 0 ? (value / total) * 100 : 0,
    };
  }).filter((segment): segment is NonNullable<typeof segment> => Boolean(segment));

  return (
    <div
      role="tooltip"
      className="absolute left-0 bottom-full z-[90] mb-2 w-[min(100vw-2rem,280px)] rounded-xl border border-border-default bg-elevated p-3 shadow-xl animate-in fade-in zoom-in-95 duration-150"
    >
      <div className="mb-2 flex items-center justify-between gap-2 px-1">
        <p className="text-[11px] font-bold text-text-muted uppercase tracking-wider">Brakedown</p>
        <p className="text-[10px] font-semibold text-text-secondary tabular-nums">
          {formatCompactK(total)} total
        </p>
      </div>
      {segments.length > 0 ? (
        <>
          <div className="h-2 w-full rounded-full bg-surface-3 overflow-hidden flex">
            {segments.map((segment) => (
              <div
                key={segment.key}
                className={`h-full ${segment.colorClass}`}
                style={{ flexGrow: segment.value, flexBasis: 0 }}
              />
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-2.5 gap-y-1 px-1">
            {segments.map((segment) => (
              <div key={`legend-${segment.key}`} className="inline-flex items-center gap-1">
                <span className={`h-1.5 w-1.5 rounded-full ${segment.colorClass}`} />
                <span className="text-[10px] text-text-secondary tabular-nums">
                  {segment.legend} {segment.pct.toFixed(0)}%
                </span>
              </div>
            ))}
          </div>
        </>
      ) : (
        <p className="px-1 text-[10px] text-text-muted">No prompt token details.</p>
      )}
    </div>
  );
}

export function StreamOutputTokenChip({ display }: { display: StreamOutputTokenDisplay }) {
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const hasTooltip = !display.isEstimated && display.tooltip != null;

  return (
    <div
      className="relative"
      onMouseEnter={() => hasTooltip && setTooltipOpen(true)}
      onMouseLeave={() => setTooltipOpen(false)}
      onFocus={() => hasTooltip && setTooltipOpen(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setTooltipOpen(false);
      }}
    >
      <span
        tabIndex={hasTooltip ? 0 : -1}
        className={`${footerChipClass} outline-none focus-visible:ring-2 focus-visible:ring-white/20`}
      >
        <span className="tabular-nums">{display.label}</span>
      </span>
      {tooltipOpen && display.tooltip ? (
        <div
          role="tooltip"
          className="absolute left-0 bottom-full z-[90] mb-2 min-w-[200px] rounded-xl border border-white/10 bg-[#1a1a1e] p-2.5 shadow-xl"
        >
          <div className="space-y-1 text-[10px] text-white/65 tabular-nums">
            <p>Output: {formatTokenCount(display.tooltip.output)} tokens</p>
            <p>Input fresh: {formatTokenCount(display.tooltip.inputFresh)} tokens</p>
            <p>Input cached: {formatTokenCount(display.tooltip.inputCached)} tokens</p>
            <p>Credits used: {formatTokenCount(display.tooltip.creditsUsed)}</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Live activity panel — shown while the agent is streaming.
 * A status bar (current action + timer + tokens + indeterminate progress)
 * sits atop a vertical timeline of tool steps.
 */
function LiveActivityPanel({
  tools,
  elapsedMs,
  tokens,
}: {
  tools: AgentMessageTool[];
  elapsedMs: number | null;
  tokens: StreamOutputTokenDisplay | null;
}) {
  const doneCount = tools.filter((t) => t.status === 'done').length;
  const runningTool = tools.find((t) => t.status === 'running');
  const currentLabel = runningTool?.name ?? 'Thinking';

  return (
    <div className="mb-3 rounded-2xl border border-[#976df8]/20 bg-gradient-to-b from-[#976df8]/[0.07] to-transparent overflow-hidden">
      {/* Status bar */}
      <div className="relative flex items-center gap-2.5 px-3 py-2.5 stream-sweep overflow-hidden">
        <span className="relative flex h-2.5 w-2.5 shrink-0 items-center justify-center">
          <span className="absolute h-2.5 w-2.5 rounded-full bg-[#976df8]/60 stream-orb" />
          <span className="h-1.5 w-1.5 rounded-full bg-[#976df8]" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-bold text-white/90 tracking-tight leading-none truncate">
            {currentLabel}
            <span className="stream-caret ml-0.5 text-[#b59cff]">…</span>
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {elapsedMs != null ? (
            <span className={footerChipClass}>
              <Clock size={10} className="text-white/30" />
              <span className="tabular-nums">{formatDurationMs(elapsedMs)}</span>
            </span>
          ) : null}
          {tokens ? <StreamOutputTokenChip display={tokens} /> : null}
        </div>
      </div>

      {/* Indeterminate progress line */}
      <div className="relative h-[2px] w-full overflow-hidden bg-white/[0.04]">
        <div className="stream-progress-bar absolute inset-y-0 w-1/3 rounded-full bg-gradient-to-r from-transparent via-[#976df8] to-transparent" />
      </div>

      {/* Timeline */}
      {tools.length > 0 ? (
        <div className="px-3 py-3">
          <div className="mb-2 flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-widest text-white/35">
              Steps
            </span>
            <span className="text-[10px] tabular-nums text-white/30">
              {doneCount}/{tools.length}
            </span>
          </div>
          <ol className="relative space-y-0">
            {tools.map((t, idx) => {
              const Icon = t.icon ?? Wrench;
              const isRunning = t.status === 'running';
              const isDone = t.status === 'done';
              const isLast = idx === tools.length - 1;
              return (
                <li
                  key={`${t.name}-${idx}`}
                  className="relative flex gap-3 pb-3 last:pb-0 animate-in fade-in slide-in-from-left-1 duration-200"
                >
                  {/* connector line */}
                  {!isLast ? (
                    <span
                      className={`absolute left-[11px] top-6 bottom-0 w-px ${
                        isDone ? 'bg-emerald-400/25' : 'bg-white/[0.08]'
                      }`}
                      aria-hidden
                    />
                  ) : null}
                  {/* node */}
                  <span
                    className={`relative z-10 mt-0.5 flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border ${
                      isRunning
                        ? 'border-[#976df8]/60 bg-[#976df8]/15 stream-glow'
                        : isDone
                          ? 'border-emerald-400/40 bg-emerald-400/15'
                          : 'border-white/10 bg-white/[0.03]'
                    }`}
                  >
                    {isRunning ? (
                      <Loader2 className="h-3 w-3 animate-spin text-[#b59cff]" aria-hidden />
                    ) : isDone ? (
                      <Check className="h-3 w-3 text-emerald-400" aria-hidden />
                    ) : (
                      <Icon size={12} className="text-white/40" aria-hidden />
                    )}
                  </span>
                  {/* content */}
                  <div className="min-w-0 flex-1 pt-0.5">
                    <div className="flex items-center gap-1.5">
                      <Icon
                        size={12}
                        className={`shrink-0 ${isRunning ? 'text-[#b59cff]' : 'text-white/45'}`}
                        aria-hidden
                      />
                      <span
                        className={`text-[12.5px] font-semibold tracking-tight truncate ${
                          isRunning ? 'text-white' : isDone ? 'text-white/80' : 'text-white/55'
                        }`}
                      >
                        {t.name}
                      </span>
                    </div>
                    {t.subtitle ? (
                      <p className="mt-0.5 text-[11px] leading-snug text-white/40 line-clamp-2 [overflow-wrap:anywhere]">
                        {t.subtitle}
                      </p>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      ) : null}
    </div>
  );
}

/** Completed tool summary — collapsible, shown after streaming finishes. */
function ToolStepsSummary({ tools }: { tools: AgentMessageTool[] }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="mb-3 rounded-xl border border-border-subtle bg-surface-2 overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-surface-3 cursor-pointer"
      >
        <Wrench className="w-3.5 h-3.5 text-text-muted shrink-0" />
        <span className="text-[12px] font-bold text-text-secondary tracking-tight">
          Used {tools.length} tool{tools.length === 1 ? '' : 's'}
        </span>
        <ChevronDown
          className={`w-3.5 h-3.5 text-text-muted shrink-0 ml-auto transition-transform ${
            expanded ? 'rotate-180' : ''
          }`}
        />
      </button>
      {expanded && (
        <div className="px-3 pb-2.5 pt-1 space-y-1.5 border-t border-border-subtle animate-in fade-in duration-150">
          {tools.map((t, idx) => {
            const Icon = t.icon ?? Wrench;
            return (
              <div key={`${t.name}-${idx}`} className="flex items-start gap-2.5 text-left">
                <div className="mt-0.5 shrink-0 text-text-muted">
                  <Icon size={13} className="shrink-0" />
                </div>
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[12px] font-semibold text-text-secondary tracking-tight">
                      {t.name}
                    </span>
                    {t.status === 'running' ? (
                      <Loader2 className="w-3 h-3 animate-spin text-accent shrink-0" aria-hidden />
                    ) : t.status === 'done' ? (
                      <Check className="w-3 h-3 text-emerald-400/90 shrink-0" aria-hidden />
                    ) : null}
                  </div>
                  {t.subtitle ? (
                    <p className="text-[11px] text-text-muted leading-snug line-clamp-3 [overflow-wrap:anywhere]">
                      {t.subtitle}
                    </p>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function AgentMessage({
  content,
  dateTime,
  agentName = 'Grizon AI',
  avatarSrc = '/Logo.svg',
  model = 'AI Model',
  creditsDeducted = 0,
  webSearch = false,
  tools = [],
  isLoading = false,
  messageStatus,
  generationStats,
  promptBreakdown,
  streamOutputTokens = null,
  streamElapsedMs = null,
  artifacts = [],
  citations = [],
  onArtifactError,
  onViewArtifact,
}: AgentMessageProps) {
  const [isCopied, setIsCopied] = useState(false);
  const [costTooltipOpen, setCostTooltipOpen] = useState(false);
  const isComplete = messageStatus === 'complete';
  const showDurationChip = isComplete && generationStats != null;
  const hasPromptBreakdown = isComplete && hasPromptBreakdownData(promptBreakdown);

  const handleCopy = async () => {
    try {
      let textToCopy = '';
      if (typeof content === 'string') {
        textToCopy = content;
      } else {
        textToCopy = 'Unable to parse rich content for copying.';
      }
      if (textToCopy) {
        await navigator.clipboard.writeText(textToCopy);
        setIsCopied(true);
        setTimeout(() => setIsCopied(false), 2000);
      }
    } catch (err) {
      console.error('Failed to copy', err);
    }
  };

  const showFooterChips =
    !isLoading || creditsDeducted > 0 || showDurationChip;

  return (
    <div className="w-full max-w-full min-w-0 overflow-hidden flex flex-col items-start gap-1 animate-in fade-in slide-in-from-bottom-1 duration-200 text-left">
      {/* Header */}
      <div className="flex items-center gap-2 mb-0.5 pl-0.5 w-full overflow-hidden">
        <div className="w-5 h-5 rounded-md overflow-hidden shrink-0">
          <img
            src={avatarSrc}
            alt={agentName}
            className="w-full h-full object-cover brightness-110"
          />
        </div>
        <span className="text-[11px] font-semibold text-text-muted tracking-tight">
          {agentName}
        </span>
        {isLoading ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#976df8]/10 border border-[#976df8]/20 px-2 py-0.5">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full rounded-full bg-[#976df8]/70 stream-orb" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#976df8]" />
            </span>
            <span className="text-[10px] font-bold uppercase tracking-widest text-[#b59cff]">
              Live
            </span>
          </span>
        ) : (
          <span className="text-[11px] text-text-faint tabular-nums">{dateTime}</span>
        )}
      </div>

      {/* Bubble */}
      <div className="w-full max-w-full min-w-0 overflow-hidden">
        <div className="bg-bubble-ai border border-bubble-ai-border px-4 py-3 rounded-2xl text-text-primary leading-relaxed text-[14px] sm:text-[15px] font-normal markdown-content w-fit max-w-[min(95%,760px)] min-w-0 overflow-hidden custom-scrollbar whitespace-pre-wrap break-words [overflow-wrap:anywhere] [word-break:break-word]">
          {isLoading ? (
            <LiveActivityPanel
              tools={tools}
              elapsedMs={streamElapsedMs}
              tokens={streamOutputTokens}
            />
          ) : tools.length > 0 ? (
            <ToolStepsSummary tools={tools} />
          ) : null}
          {typeof content === 'string' ? (
            <MarkdownRenderer content={content} citations={citations} />
          ) : (
            content
          )}
          {isLoading ? (
            <span
              className="stream-caret ml-0.5 inline-block h-[15px] w-[3px] translate-y-[2px] rounded-full bg-[#976df8] align-middle"
              aria-hidden
            />
          ) : null}
        </div>
      </div>

      {artifacts.length > 0 ? (
        <MessageArtifactRows
          artifacts={artifacts}
          onError={onArtifactError}
          onView={onViewArtifact}
        />
      ) : null}

      {/* Meta tags + actions row (under bubble) */}
      {showFooterChips && (
        <div className="flex items-center gap-1.5 mt-1 ml-1 flex-wrap w-full max-w-full">
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-surface-2 border border-border-subtle text-[10px] font-medium text-text-muted tracking-tight whitespace-nowrap">
            <Sparkles size={10} className="text-text-faint" />
            <span>{model}</span>
          </span>

          {webSearch && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[rgba(96,165,250,0.06)] border border-[rgba(96,165,250,0.12)] text-[10px] font-medium text-[rgba(96,165,250,0.7)] tracking-tight whitespace-nowrap">
              <Search size={10} />
              <span>Web Search</span>
            </span>
          )}

          {showDurationChip && generationStats ? (
            <span className={footerChipClass}>
              <Clock size={10} className="text-white/25" />
              <span className="tabular-nums">{formatDurationMs(generationStats.durationMs)}</span>
            </span>
          ) : null}

          {creditsDeducted > 0 && (
            <div
              className="relative"
              onMouseEnter={() => setCostTooltipOpen(true)}
              onMouseLeave={() => setCostTooltipOpen(false)}
              onFocus={() => setCostTooltipOpen(true)}
              onBlur={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) setCostTooltipOpen(false);
              }}
            >
              <span
                tabIndex={hasPromptBreakdown ? 0 : -1}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-surface-2 border border-border-subtle text-[10px] font-medium text-text-muted tracking-tight whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
              >
                <Coins size={10} className="text-amber-400/60" />
                <span>{creditsDeducted} credits used</span>
              </span>
              {costTooltipOpen && hasPromptBreakdown && promptBreakdown ? (
                <PromptBreakdownTooltip promptBreakdown={promptBreakdown} />
              ) : null}
            </div>
          )}

          {!isLoading && (
            <div className="flex items-center gap-0.5 ml-auto shrink-0">
              <div className="relative">
                <button
                  onClick={handleCopy}
                  disabled={isCopied}
                  className="p-1 transition-colors rounded-md text-text-faint hover:text-text-secondary hover:bg-surface-2"
                  title="Copy response"
                >
                  {isCopied ? <Check size={12} className="text-accent" /> : <Copy size={12} />}
                </button>

                <div
                  className={`absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 rounded-md bg-accent/10 border border-accent/20 backdrop-blur-md text-[9px] font-black text-accent uppercase tracking-widest shadow-[0_0_15px_rgba(151,109,248,0.15)] pointer-events-none transition-all duration-200 flex items-center justify-center whitespace-nowrap z-10
                    ${isCopied ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 translate-y-1 scale-95'}`}
                >
                  COPIED
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
