'use client';

import {
  Menu,
  Send,
  Square,
  Paperclip,
  Loader2,
  AlertCircle,
  Zap,
  Search,
  Wrench,
  ArrowDown,
  X,
  UploadCloud,
  ImageIcon,
  FileText,
  FileSpreadsheet,
  Film,
  Music,
  FileCode,
  FileArchive,
  File as FileIcon,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import UserMessage from './UserMessage';
import AgentMessage, { formatDurationMs } from './AgentMessage';
import type {
  AgentMessageGenerationStats,
  StreamOutputTokenDisplay,
  StreamTokenTooltip,
} from './AgentMessage';
import TaskSelectionView from './TaskSelectionView';
import RateLimitComposerIndicator from './RateLimitComposerIndicator';
import ThinkingIndicator from './ThinkingIndicator';
import MessageSkeleton from './MessageSkeleton';
import { useConversations } from '@/context/ConversationContext';
import { useModels } from '@/context/ModelContext';
import { useCredits } from '@/context/CreditContext';
import { useCanvas } from '@/context/CanvasContext';
import { useStreamParser } from '@/hooks/useStreamParser';
import {
  enqueueChat,
  cancelChat,
  getChatJob,
  uploadFileJson,
  getFileStatus,
  deleteFile,
} from '@/lib/chat-rest-api';
import { streamChatJob } from '@/lib/chat-sse';
import type {
  ApiMessage,
  ApiMessageArtifact,
  ApiMessageAttachedFile,
  CatalogueResponse,
} from '@/lib/chat-contracts';
import { catalogueAgentDisplayName, catalogueAgentShortDescription } from '@/lib/chat-contracts';
import { ApiError } from '@/lib/auth-api';
import {
  FILE_INPUT_ACCEPT,
  FILE_UPLOAD_BLOCKED_IMAGE_MIME_TYPES,
  FILE_UPLOAD_ERROR_MESSAGES,
  FILE_UPLOAD_EXT_TO_MIME,
  FILE_UPLOAD_IMAGE_COMING_SOON,
  FILE_UPLOAD_POLL_INTERVAL_MS,
  FILE_UPLOAD_POLL_MAX_ATTEMPTS,
  mapFileUploadCodeToMessage,
  type FileUploadErrorCode,
} from '@/lib/file-upload-contract';

function formatTime(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

function guessMimeType(fileName: string, browserType: string): string {
  if (browserType && browserType !== '') return browserType;
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    pdf: 'application/pdf',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    doc: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    xls: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    csv: 'text/csv',
    txt: 'text/plain',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    mp4: 'video/mp4',
  };
  return map[ext] || 'application/octet-stream';
}

const ALLOWED_UPLOAD_MIME_TYPES = new Set<string>(Object.values(FILE_UPLOAD_EXT_TO_MIME));
const BLOCKED_IMAGE_MIME_TYPES = new Set<string>(FILE_UPLOAD_BLOCKED_IMAGE_MIME_TYPES);

function humanFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

type FileVisual = {
  Icon: typeof FileIcon;
  ring: string;
  iconBg: string;
  iconColor: string;
  label: string;
};

function getFileVisual(type: string, name: string): FileVisual {
  const t = (type || '').toLowerCase();
  const ext = name.split('.').pop()?.toLowerCase() ?? '';

  if (t.startsWith('image/')) {
    return {
      Icon: ImageIcon,
      ring: 'border-pink-400/25 hover:border-pink-400/40',
      iconBg: 'bg-gradient-to-br from-pink-500/25 to-fuchsia-500/15',
      iconColor: 'text-pink-200',
      label: 'Image',
    };
  }
  if (t.startsWith('video/')) {
    return {
      Icon: Film,
      ring: 'border-orange-400/25 hover:border-orange-400/40',
      iconBg: 'bg-gradient-to-br from-orange-500/25 to-amber-500/15',
      iconColor: 'text-orange-200',
      label: 'Video',
    };
  }
  if (t.startsWith('audio/')) {
    return {
      Icon: Music,
      ring: 'border-indigo-400/25 hover:border-indigo-400/40',
      iconBg: 'bg-gradient-to-br from-indigo-500/25 to-violet-500/15',
      iconColor: 'text-indigo-200',
      label: 'Audio',
    };
  }
  if (t === 'application/pdf' || ext === 'pdf') {
    return {
      Icon: FileText,
      ring: 'border-red-400/25 hover:border-red-400/40',
      iconBg: 'bg-gradient-to-br from-red-500/25 to-rose-500/15',
      iconColor: 'text-red-200',
      label: 'PDF',
    };
  }
  if (t === 'text/csv' || t.includes('spreadsheet') || t.includes('excel') || ext === 'csv' || ext === 'xlsx' || ext === 'xls') {
    return {
      Icon: FileSpreadsheet,
      ring: 'border-emerald-400/25 hover:border-emerald-400/40',
      iconBg: 'bg-gradient-to-br from-emerald-500/25 to-green-500/15',
      iconColor: 'text-emerald-200',
      label: 'Spreadsheet',
    };
  }
  if (t.includes('word') || t.includes('document') || ext === 'doc' || ext === 'docx') {
    return {
      Icon: FileText,
      ring: 'border-blue-400/25 hover:border-blue-400/40',
      iconBg: 'bg-gradient-to-br from-blue-500/25 to-cyan-500/15',
      iconColor: 'text-blue-200',
      label: 'Document',
    };
  }
  if (
    t.startsWith('text/') ||
    ['md', 'txt', 'json', 'yml', 'yaml', 'xml', 'log'].includes(ext)
  ) {
    return {
      Icon: FileText,
      ring: 'border-sky-400/25 hover:border-sky-400/40',
      iconBg: 'bg-gradient-to-br from-sky-500/25 to-blue-500/15',
      iconColor: 'text-sky-200',
      label: 'Text',
    };
  }
  if (['js', 'ts', 'tsx', 'jsx', 'py', 'go', 'rs', 'java', 'c', 'cpp', 'rb', 'php', 'sh'].includes(ext)) {
    return {
      Icon: FileCode,
      ring: 'border-accent/25 hover:border-accent/40',
      iconBg: 'bg-gradient-to-br from-purple-500/25 to-violet-500/15',
      iconColor: 'text-accent',
      label: 'Code',
    };
  }
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) {
    return {
      Icon: FileArchive,
      ring: 'border-yellow-400/25 hover:border-yellow-400/40',
      iconBg: 'bg-gradient-to-br from-yellow-500/25 to-amber-500/15',
      iconColor: 'text-yellow-200',
      label: 'Archive',
    };
  }
  return {
    Icon: FileIcon,
    ring: 'border-border-default hover:border-border-strong',
    iconBg: 'bg-gradient-to-br from-white/[0.08] to-white/[0.02]',
    iconColor: 'text-text-secondary',
    label: 'File',
  };
}

interface UiAttachment {
  tempId: string;
  name: string;
  size: number;
  type: string;
  status: 'uploading' | 'ready' | 'error';
  fileId?: string;
  previewUrl?: string;
  errorMsg?: string;
}

/** Ready uploads with server file IDs — single source of truth for chat enqueue payload. */
function getReadyAttachedFileIds(
  items: UiAttachment[],
  serverIdsByTempId?: Map<string, string>,
): string[] {
  const ids: string[] = [];
  for (const a of items) {
    if (a.status !== 'ready') continue;
    const id = a.fileId ?? serverIdsByTempId?.get(a.tempId);
    if (id) ids.push(id);
  }
  return ids;
}

function resolveAttachmentMime(file: File): string {
  const guessed = guessMimeType(file.name, file.type).toLowerCase();
  if (BLOCKED_IMAGE_MIME_TYPES.has(guessed)) return guessed;
  if (ALLOWED_UPLOAD_MIME_TYPES.has(guessed)) return guessed;
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  return FILE_UPLOAD_EXT_TO_MIME[ext] ?? guessed;
}

function validateAttachmentFile(
  file: File,
  normalizedMime: string,
  maxFileSizeBytes: number | null,
): { code: FileUploadErrorCode; message: string } | null {
  if (BLOCKED_IMAGE_MIME_TYPES.has(normalizedMime)) {
    return {
      code: 'FILE_TYPE_NOT_ALLOWED',
      message: FILE_UPLOAD_IMAGE_COMING_SOON,
    };
  }
  if (!ALLOWED_UPLOAD_MIME_TYPES.has(normalizedMime)) {
    return {
      code: 'FILE_TYPE_NOT_ALLOWED',
      message: FILE_UPLOAD_ERROR_MESSAGES.FILE_TYPE_NOT_ALLOWED,
    };
  }
  if (maxFileSizeBytes != null && maxFileSizeBytes > 0 && file.size > maxFileSizeBytes) {
    return {
      code: 'FILE_TOO_LARGE',
      message: FILE_UPLOAD_ERROR_MESSAGES.FILE_TOO_LARGE,
    };
  }
  return null;
}

type StreamPhase =
  | 'idle'
  | 'connecting'
  | 'queued'
  | 'processing'
  | 'tooling'
  | 'streaming'
  | 'completed'
  | 'error'
  | 'cancelled';

interface StreamToolStep {
  callId: string;
  toolId: string;
  argsSummary: string;
  status: 'running' | 'done';
  durationMs?: number;
  resultSummary?: string;
}

interface StreamMetaState {
  model?: string;
  modelProvider?: string | null;
  agentSlug?: string | null;
  webSearch?: boolean;
  outputTokensExact?: number | null;
  tokenTooltip?: StreamTokenTooltip | null;
  creditsDeducted?: number;
  generationStats?: AgentMessageGenerationStats;
}

function parseStreamTokensUsed(raw: unknown): {
  output: number;
  inputFresh: number;
  inputCached: number;
} | null {
  if (!raw || typeof raw !== 'object') return null;
  const t = raw as Record<string, unknown>;
  const output = toFiniteNumber(t.output);
  if (output == null) return null;
  const inputCached = toFiniteNumber(t.inputCached) ?? 0;
  const inputFreshExplicit = toFiniteNumber(t.inputFresh);
  const inputTotal = toFiniteNumber(t.input);
  const inputFresh =
    inputFreshExplicit != null
      ? inputFreshExplicit
      : inputTotal != null
        ? Math.max(0, inputTotal - inputCached)
        : 0;
  return { output, inputFresh, inputCached };
}

function buildStreamTokenTooltip(
  tokens: { output: number; inputFresh: number; inputCached: number },
  creditsUsed: number,
): StreamTokenTooltip {
  return {
    output: tokens.output,
    inputFresh: tokens.inputFresh,
    inputCached: tokens.inputCached,
    creditsUsed: Math.max(0, creditsUsed),
  };
}

function toFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normalizeDoneStats(
  data: unknown,
): AgentMessageGenerationStats | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  const durationMs = toFiniteNumber(d.durationMs);
  if (durationMs == null) return null;
  const llmFirstTokenMs = toFiniteNumber(d.llmFirstTokenMs);
  const llmTotalMs = toFiniteNumber(d.llmTotalMs);
  const rawTokens = d.tokensUsed;
  const tokensObj = rawTokens && typeof rawTokens === 'object' ? (rawTokens as Record<string, unknown>) : null;
  const input = toFiniteNumber(tokensObj?.input) ?? 0;
  const inputCached = toFiniteNumber(tokensObj?.inputCached) ?? 0;
  const output = toFiniteNumber(tokensObj?.output) ?? 0;
  const cacheWrite = toFiniteNumber(tokensObj?.cacheWrite) ?? 0;
  return {
    durationMs,
    llmFirstTokenMs,
    llmTotalMs,
    tokensUsed: { input, inputCached, output, cacheWrite },
  };
}

function messageGenerationStats(m: ApiMessage): AgentMessageGenerationStats | null {
  if (m.role !== 'assistant' || m.status !== 'complete') return null;
  const durationMs = m.llmTotalMs ?? m.latencyMs;
  if (durationMs == null) return null;
  return {
    durationMs,
    llmFirstTokenMs: m.llmFirstTokenMs ?? null,
    llmTotalMs: m.llmTotalMs ?? null,
    tokensUsed: {
      input: Math.max(0, Number(m.inputTokens) || 0),
      inputCached: 0,
      output: Math.max(0, Number(m.outputTokens) || 0),
      cacheWrite: 0,
    },
  };
}

function streamPlaceholderMarkdown(phase: StreamPhase, statusLine: string | null): string {
  const line = statusLine?.trim();
  if (line) return `_${line}_`;
  switch (phase) {
    case 'connecting':
      return '_Connecting to stream…_';
    case 'queued':
      return '_Queued — your message is waiting to process…_';
    case 'processing':
      return '_Starting model — preparing a response…_';
    case 'tooling':
      return '_Running tools (search, lookups, etc.)…_';
    case 'streaming':
      return '_Receiving response…_';
    default:
      return '_Working…_';
  }
}

function extractToolArgsSummary(arguments_: unknown): string {
  if (!arguments_ || typeof arguments_ !== 'object') return '';
  const a = arguments_ as Record<string, unknown>;
  if (typeof a.query === 'string') {
    return a.query.length > 120 ? `${a.query.slice(0, 120)}…` : a.query;
  }
  if (typeof a.reason === 'string') {
    return a.reason.length > 120 ? `${a.reason.slice(0, 120)}…` : a.reason;
  }
  return '';
}

function summarizeToolOutput(output: unknown): string {
  if (!output || typeof output !== 'object') return 'Done';
  const o = output as Record<string, unknown>;
  if (Array.isArray(o.results)) {
    const n = o.results.length;
    return `${n} source${n === 1 ? '' : 's'}`;
  }
  if (Array.isArray(o.summaries) && o.summaries.length > 0) {
    return `${o.summaries.length} summaries`;
  }
  return 'Done';
}

function formatToolDisplayName(toolId: string): string {
  if (toolId === 'web_search') return 'Web search';
  return toolId
    .split('_')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

function formatStreamErrorBanner(d: { code?: string; message?: string; retryable?: boolean }): {
  message: string;
  code: string | null;
} {
  const code = d.code ?? 'error';
  let message = d.message?.trim() || 'Stream error';
  if (code === 'STREAM_TIMEOUT') {
    return {
      code,
      message: 'The model stream exceeded the time limit for your plan.',
    };
  }
  const exhausted =
    code === 'PROVIDER_EXHAUSTED' ||
    /PROVIDER_EXHAUSTED/i.test(code) ||
    /all model providers exhausted/i.test(message) ||
    /providers exhausted/i.test(message);
  const streamTransport = code === 'STREAM_ERROR';

  if (exhausted) {
    message = `${message}\n\nTry again in a moment or pick a different model — all providers may be temporarily unavailable.`;
  } else if (streamTransport) {
    message = `${message}\n\nIf this keeps happening, try another model or check your connection.`;
  }

  if (d.retryable === false && !exhausted) {
    message = `${message}\n\nThis error may not resolve by retrying.`;
  }

  return { message, code };
}

/**
 * Footer “model” / routing badge: catalogue display name for `agentSlug`;
 * slug present but not in catalogue → Auto; no slug → modelId or Assistant.
 */
function routingBadgeFromAgentSlug(
  agentSlug: string | null | undefined,
  catalogue: CatalogueResponse | null,
  modelIdWhenNoSlug: string | null | undefined,
): string {
  const slug = agentSlug?.trim();
  if (slug) {
    for (const c of catalogue?.categories ?? []) {
      const a = (c.agents ?? []).find((x) => x.slug === slug);
      if (a) return catalogueAgentDisplayName(a);
    }
    return 'Auto';
  }
  const mid = modelIdWhenNoSlug?.trim();
  return mid || 'Assistant';
}

function assistantModelBadgeLabel(m: ApiMessage, catalogue: CatalogueResponse | null): string {
  return routingBadgeFromAgentSlug(m.agentSlug, catalogue, m.modelId);
}

/** Composer agent slug from last assistant message; null means Auto Mode. */
function resolveComposerAgentSlugFromMessages(
  messages: ApiMessage[],
  catalogue: CatalogueResponse | null,
): string | null {
  const lastAssistant = [...messages].reverse().find((m) => m.role !== 'user');
  const slug = lastAssistant?.agentSlug?.trim();
  if (!slug) return null;
  if (!catalogue?.categories?.length) return null;
  const exists = (catalogue.categories ?? []).some((c) =>
    (c.agents ?? []).some((a) => a?.slug === slug),
  );
  return exists ? slug : null;
}

export default function MessagesStaticShell({
  conversationId,
  isCanvasOpen,
  onOpenCanvasAction,
  onToggleSidebarAction,
}: {
  conversationId?: string | null;
  isCanvasOpen: boolean;
  onOpenCanvasAction: () => void;
  onToggleSidebarAction: () => void;
}) {
  const {
    activeMessages,
    activeConversation,
    isLoadingMessages,
    error: convError,
    createConversationAndSelect,
    refreshConversation,
    refreshAfterStream,
  } = useConversations();
  const {
    selectedModel,
    modelPickerEnabled,
    fileUploadEnabled,
    planSnapshot,
    catalogue,
    selectedAgentSlug,
    setSelectedAgentSlug,
  } = useModels();
  const { refreshBalance, refreshUsageSummary } = useCredits();
  const { openCanvasWithItem, bumpFilesListVersion } = useCanvas();

  const handleOpenAttachedFile = useCallback(
    (file: ApiMessageAttachedFile) => {
      if (file.processingStatus !== 'ready') return;
      openCanvasWithItem({
        kind: 'file',
        id: file.id,
        label: file.fileName,
        mimeType: file.fileType,
        sizeBytes: file.fileSize,
      });
    },
    [openCanvasWithItem],
  );

  const handleViewArtifact = useCallback(
    (artifact: ApiMessageArtifact) => {
      openCanvasWithItem({
        kind: 'artifact',
        id: artifact.id,
        label: artifact.filename?.trim() || artifact.title?.trim() || 'Generated file',
        mimeType: artifact.mimeType,
        artifactType: artifact.type,
        sizeBytes:
          artifact.fileSize != null && Number.isFinite(artifact.fileSize)
            ? artifact.fileSize
            : undefined,
      });
    },
    [openCanvasWithItem],
  );

  const [input, setInput] = useState('');
  const [banner, setBanner] = useState<string | null>(null);
  const [bannerCode, setBannerCode] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [streamMeta, setStreamMeta] = useState<StreamMetaState>({});
  const [streamLiveness, setStreamLiveness] = useState(false);
  const [streamPhase, setStreamPhase] = useState<StreamPhase>('idle');
  const [statusLine, setStatusLine] = useState<string | null>(null);
  const [toolSteps, setToolSteps] = useState<StreamToolStep[]>([]);
  const [recencyTick, setRecencyTick] = useState(0);
  const [streamStartedAt, setStreamStartedAt] = useState<number | null>(null);
  const [streamOutputChars, setStreamOutputChars] = useState(0);
  const [attachments, setAttachments] = useState<UiAttachment[]>([]);
  const [uploadBusy, setUploadBusy] = useState(false);
  const attachmentsBlockSend = useMemo(
    () =>
      uploadBusy ||
      attachments.some(
        (a) => a.status === 'uploading' || (a.status !== 'error' && a.status !== 'ready'),
      ),
    [attachments, uploadBusy],
  );
  const canSend = Boolean(input.trim()) && !attachmentsBlockSend && !isSending;
  const [isDragOver, setIsDragOver] = useState(false);
  const [agentPickerOpen, setAgentPickerOpen] = useState(false);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const agentPickerRef = useRef<HTMLDivElement>(null);
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const streamingConvIdRef = useRef<string | null>(null);
  const dragCounterRef = useRef(0);
  const composerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  /** tempIds removed while upload still in flight — completion must delete server file */
  const removedTempIdsRef = useRef<Set<string>>(new Set());
  /** Server file id per composer tempId — survives even if attachment state loses fileId */
  const serverFileIdByTempIdRef = useRef<Map<string, string>>(new Map());
  const attachmentsRef = useRef(attachments);
  attachmentsRef.current = attachments;
  const { processChunk, reset: resetStreamParser, getCleanMsg } = useStreamParser();

  const effectiveConvId = conversationId ?? undefined;

  const sortedMessages = useMemo(() => {
    return [...activeMessages]
      .filter((m) => {
        // Hide assistant placeholders that haven't produced content yet; the
        // streaming row + ThinkingIndicator already covers that state.
        if (m.role === 'user') return true;
        if (m.status === 'streaming' && !m.content?.trim()) return false;
        return true;
      })
      .sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      );
  }, [activeMessages]);

  const catalogueAgentCount = useMemo(() => {
    return (catalogue?.categories ?? []).reduce(
      (n, c) => n + (c.agents ?? []).filter((a) => a?.slug).length,
      0,
    );
  }, [catalogue]);

  const agentPickerTriggerLabel = useMemo(() => {
    const slug = selectedAgentSlug?.trim();
    if (!slug) return 'Auto Mode';
    for (const c of catalogue?.categories ?? []) {
      const a = (c.agents ?? []).find((x) => x.slug === slug);
      if (a) return catalogueAgentDisplayName(a);
    }
    return slug;
  }, [catalogue, selectedAgentSlug]);

  const bumpActivity = useCallback(() => {}, []);

  const streamingAgentName = useMemo(() => {
    const slug = streamMeta.agentSlug?.trim();
    if (!slug) return undefined;
    for (const c of catalogue?.categories ?? []) {
      const a = (c.agents ?? []).find((x) => x.slug === slug);
      if (a) return catalogueAgentDisplayName(a);
    }
    return 'Auto';
  }, [catalogue, streamMeta.agentSlug]);

  /** Same routing badge as completed messages; never raw modelId / provider while streaming. */
  const streamingRoutingBadgeLabel = useMemo(
    () => routingBadgeFromAgentSlug(streamMeta.agentSlug, catalogue, null),
    [catalogue, streamMeta.agentSlug],
  );

  const streamingTools = useMemo(() => {
    return toolSteps.map((s) => ({
      name: formatToolDisplayName(s.toolId),
      icon: s.toolId === 'web_search' ? Search : Wrench,
      status: s.status,
      subtitle:
        s.status === 'running'
          ? s.argsSummary || 'Running…'
          : [s.resultSummary, s.durationMs != null ? formatDurationMs(s.durationMs) : null]
            .filter(Boolean)
            .join(' · '),
    }));
  }, [toolSteps]);

  const showStreamingRow = useMemo(
    () =>
      isSending &&
      streamLiveness &&
      (Boolean(streamingText) || streamPhase !== 'idle' || toolSteps.length > 0),
    [isSending, streamLiveness, streamingText, streamPhase, toolSteps.length],
  );

  const scrollMessagesToBottom = useCallback(() => {
    // Double requestAnimationFrame + setTimeout ensures DOM has fully painted and layout is stable
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setTimeout(() => {
          const el = messagesScrollRef.current;
          if (!el) return;
          el.scrollTop = el.scrollHeight;
        }, 50);
      });
    });
  }, []);

  useEffect(() => {
    const el = messagesScrollRef.current;
    if (!el) return;
    const check = () => {
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      setShowScrollToBottom(distanceFromBottom > 240);
    };
    check();
    el.addEventListener('scroll', check, { passive: true });
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', check);
      ro.disconnect();
    };
  }, []);

  /** Keep the thread pinned to the bottom when new messages arrive or when streaming. */
  useEffect(() => {
    scrollMessagesToBottom();
  }, [
    isSending,
    sortedMessages.length,
    streamingText,
    streamPhase,
    toolSteps.length,
    streamLiveness,
    showStreamingRow,
    scrollMessagesToBottom,
  ]);

  const streamElapsedMs = useMemo(() => {
    void recencyTick;
    if (!isSending || streamStartedAt == null) return null;
    return Date.now() - streamStartedAt;
  }, [isSending, streamStartedAt, recencyTick]);

  const streamOutputTokenDisplay = useMemo((): StreamOutputTokenDisplay | null => {
    if (!isSending || streamStartedAt == null) return null;

    const exact = streamMeta.outputTokensExact;
    if (exact != null) {
      return {
        label: `${exact} tokens`,
        isEstimated: false,
        tooltip: streamMeta.tokenTooltip ?? null,
      };
    }

    if (streamOutputChars > 0) {
      const estimate = Math.ceil(streamOutputChars / 4);
      return {
        label: `~${estimate} tokens`,
        isEstimated: true,
        tooltip: null,
      };
    }

    return null;
  }, [
    isSending,
    streamStartedAt,
    streamMeta.outputTokensExact,
    streamMeta.tokenTooltip,
    streamOutputChars,
  ]);

  useEffect(() => {
    if (!isSending) return;
    const id = window.setInterval(() => setRecencyTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [isSending]);

  useEffect(() => {
    if (!agentPickerOpen) return;
    const onDoc = (e: MouseEvent) => {
      const el = agentPickerRef.current;
      if (el && !el.contains(e.target as Node)) setAgentPickerOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [agentPickerOpen]);

  useEffect(() => {
    if (!isSending && !streamingText) {
      resetStreamParser();
    }
  }, [effectiveConvId, isSending, streamingText, resetStreamParser]);

  // Keep composer agent picker in sync: Auto on new chat, last assistant agentSlug in existing chats.
  const prevEffectiveConvIdRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (isSending) return;

    const prevConvId = prevEffectiveConvIdRef.current;
    prevEffectiveConvIdRef.current = effectiveConvId;

    if (!effectiveConvId) {
      if (prevConvId !== effectiveConvId) {
        setSelectedAgentSlug(null);
      }
      return;
    }

    if (isLoadingMessages && sortedMessages.length === 0) return;

    const lastAssistant = [...sortedMessages].reverse().find((m) => m.role !== 'user');
    const rawSlug = lastAssistant?.agentSlug?.trim();
    if (rawSlug && !catalogue?.categories?.length) return;

    const derivedSlug = resolveComposerAgentSlugFromMessages(sortedMessages, catalogue);
    setSelectedAgentSlug(derivedSlug);
  }, [
    effectiveConvId,
    sortedMessages,
    catalogue,
    isSending,
    isLoadingMessages,
    setSelectedAgentSlug,
  ]);

  const showEmptyHero = !effectiveConvId && sortedMessages.length === 0 && !isLoadingMessages;

  const pushApiErrorBanner = (e: unknown) => {
    if (e instanceof ApiError) {
      setBannerCode(e.code ?? null);
      setBanner(mapFileUploadCodeToMessage(e.code) ?? e.message);
    } else {
      setBannerCode(null);
      setBanner(e instanceof Error ? e.message : 'Something went wrong');
    }
  };

  const waitForFileReady = async (fileId: string) => {
    for (let i = 0; i < FILE_UPLOAD_POLL_MAX_ATTEMPTS; i++) {
      const { file } = await getFileStatus(fileId);
      if (file.processingStatus === 'ready') return file;
      if (file.processingStatus === 'failed') {
        const msg =
          file.errorMessage === 'unsupported_mime'
            ? FILE_UPLOAD_IMAGE_COMING_SOON
            : file.errorMessage || 'File processing failed';
        throw new Error(msg);
      }
      await new Promise((r) => setTimeout(r, FILE_UPLOAD_POLL_INTERVAL_MS));
    }
    throw new Error('File processing timed out');
  };

  const makeTempId = () =>
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `att_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

  const deleteUploadedFileSilent = useCallback((fileId: string) => {
    void deleteFile(fileId).catch(() => {
      /* optimistic UI — removal already applied */
    });
  }, []);

  const uploadOneFile = useCallback(
    async (tempId: string, f: File, normalizedMime: string) => {
      try {
        const buf = await f.arrayBuffer();
        const b64 = btoa(
          new Uint8Array(buf).reduce((acc, byte) => acc + String.fromCharCode(byte), ''),
        );
        const { file } = await uploadFileJson({
          conversationId: effectiveConvId ?? null,
          fileName: f.name,
          fileType: normalizedMime,
          fileSize: f.size,
          contentBase64: b64,
        });
        serverFileIdByTempIdRef.current.set(tempId, file.id);
        await waitForFileReady(file.id);

        if (removedTempIdsRef.current.has(tempId)) {
          removedTempIdsRef.current.delete(tempId);
          serverFileIdByTempIdRef.current.delete(tempId);
          deleteUploadedFileSilent(file.id);
          return;
        }

        setAttachments((prev) => {
          const exists = prev.find((a) => a.tempId === tempId);
          if (!exists) return prev;
          return prev.map((a) =>
            a.tempId === tempId ? { ...a, status: 'ready', fileId: file.id } : a,
          );
        });
        bumpFilesListVersion();
      } catch (e) {
        const msg =
          e instanceof ApiError
            ? mapFileUploadCodeToMessage(e.code) ?? e.message
            : e instanceof Error
              ? e.message
              : 'Upload failed';
        setAttachments((prev) =>
          prev.map((a) =>
            a.tempId === tempId ? { ...a, status: 'error', errorMsg: msg } : a,
          ),
        );
        pushApiErrorBanner(e);
      }
    },
    [effectiveConvId, deleteUploadedFileSilent, bumpFilesListVersion],
  );

  const onPickFiles = useCallback(
    async (files: FileList | File[] | null) => {
      if (!files || !fileUploadEnabled) return;
      const list = Array.from(files);
      if (!list.length) return;

      const maxFileSizeBytes =
        typeof planSnapshot?.limits?.maxFileSize === 'number' ? planSnapshot.limits.maxFileSize : null;
      const maxFilesPerChat =
        typeof planSnapshot?.limits?.maxFilesPerChat === 'number'
          ? planSnapshot.limits.maxFilesPerChat
          : null;
      const currentlyCountedFiles = attachments.filter((a) => a.status !== 'error').length;
      const remainingSlots =
        maxFilesPerChat != null && maxFilesPerChat > 0
          ? Math.max(0, maxFilesPerChat - currentlyCountedFiles)
          : null;
      const localErrors: Array<{ code: string; message: string }> = [];
      const uploadQueue: Array<{ tempId: string; file: File; normalizedMime: string }> = [];

      const seeded: UiAttachment[] = list.map((f, index) => {
        const exceedsPerChatLimit = remainingSlots != null && index >= remainingSlots;
        const normalizedMime = resolveAttachmentMime(f);
        const localError = exceedsPerChatLimit
          ? {
            code: 'FILE_LIMIT_PER_CHAT',
            message: FILE_UPLOAD_ERROR_MESSAGES.FILE_LIMIT_PER_CHAT,
          }
          : validateAttachmentFile(f, normalizedMime, maxFileSizeBytes);
        const tempId = makeTempId();
        if (localError) {
          localErrors.push(localError);
        } else {
          uploadQueue.push({ tempId, file: f, normalizedMime });
        }
        return {
          tempId,
          name: f.name || 'untitled',
          size: f.size,
          type: normalizedMime,
          status: localError ? 'error' : 'uploading',
          errorMsg: localError?.message,
        };
      });
      setAttachments((prev) => [...prev, ...seeded]);

      if (localErrors.length > 0) {
        setBannerCode(localErrors[0].code);
        setBanner(localErrors.map((x) => x.message).join('\n'));
      } else {
        setBanner(null);
        setBannerCode(null);
      }

      if (uploadQueue.length === 0) return;

      setUploadBusy(true);
      try {
        await Promise.all(
          uploadQueue.map((item) => uploadOneFile(item.tempId, item.file, item.normalizedMime)),
        );
      } finally {
        setUploadBusy(false);
      }
    },
    [
      attachments,
      fileUploadEnabled,
      planSnapshot?.limits?.maxFileSize,
      planSnapshot?.limits?.maxFilesPerChat,
      uploadOneFile,
    ],
  );

  const removeAttachment = useCallback(
    (tempId: string) => {
      const target = attachmentsRef.current.find((a) => a.tempId === tempId);
      const serverFileId =
        target?.fileId ?? serverFileIdByTempIdRef.current.get(tempId) ?? undefined;

      if (target?.previewUrl) {
        try {
          URL.revokeObjectURL(target.previewUrl);
        } catch {
          /* noop */
        }
      }

      serverFileIdByTempIdRef.current.delete(tempId);

      if (serverFileId) {
        deleteUploadedFileSilent(serverFileId);
      } else if (target?.status === 'uploading') {
        removedTempIdsRef.current.add(tempId);
      }

      setAttachments((prev) => prev.filter((a) => a.tempId !== tempId));
    },
    [deleteUploadedFileSilent],
  );

  const revokeAttachmentPreviews = useCallback((items: UiAttachment[]) => {
    items.forEach((a) => {
      if (!a.previewUrl) return;
      try {
        URL.revokeObjectURL(a.previewUrl);
      } catch {
        /* noop */
      }
    });
  }, []);

  /** Clear composer after send — UI only; files stay linked for the message. */
  const resetComposerAttachments = useCallback(() => {
    const uploadingTempIds: string[] = [];

    setAttachments((prev) => {
      revokeAttachmentPreviews(prev);
      prev.forEach((a) => {
        serverFileIdByTempIdRef.current.delete(a.tempId);
        if (a.status === 'uploading') {
          uploadingTempIds.push(a.tempId);
        }
      });
      return [];
    });

    uploadingTempIds.forEach((id) => removedTempIdsRef.current.add(id));
  }, [revokeAttachmentPreviews]);

  /** User cleared all attachments — remove server files too. */
  const clearAllAttachments = useCallback(() => {
    const fileIdsToDelete = new Set<string>();
    const uploadingTempIds: string[] = [];

    attachmentsRef.current.forEach((a) => {
      if (a.previewUrl) {
        try {
          URL.revokeObjectURL(a.previewUrl);
        } catch {
          /* noop */
        }
      }
      const serverFileId = a.fileId ?? serverFileIdByTempIdRef.current.get(a.tempId);
      if (serverFileId) {
        fileIdsToDelete.add(serverFileId);
      } else if (a.status === 'uploading') {
        uploadingTempIds.push(a.tempId);
      }
      serverFileIdByTempIdRef.current.delete(a.tempId);
    });

    setAttachments([]);
    uploadingTempIds.forEach((id) => removedTempIdsRef.current.add(id));
    fileIdsToDelete.forEach((id) => deleteUploadedFileSilent(id));
  }, [deleteUploadedFileSilent]);

  useEffect(() => {
    return () => {
      attachments.forEach((a) => {
        if (a.previewUrl) {
          try {
            URL.revokeObjectURL(a.previewUrl);
          } catch {
            /* noop */
          }
        }
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDragEnter = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    const types = e.dataTransfer?.types;
    if (!types || !Array.from(types).includes('Files')) return;
    e.preventDefault();
    dragCounterRef.current += 1;
    setIsDragOver(true);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    const types = e.dataTransfer?.types;
    if (types && Array.from(types).includes('Files')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
    if (dragCounterRef.current === 0) setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      dragCounterRef.current = 0;
      setIsDragOver(false);
      const files = e.dataTransfer?.files;
      if (files && files.length > 0) {
        void onPickFiles(files);
      }
    },
    [onPickFiles],
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const items = e.clipboardData?.items;
      if (!items || items.length === 0) return;
      const files: File[] = [];
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (it.kind === 'file') {
          const f = it.getAsFile();
          if (f) files.push(f);
        }
      }
      if (files.length > 0) {
        e.preventDefault();
        void onPickFiles(files);
      }
    },
    [onPickFiles],
  );

  const runStream = useCallback(
    async (jobId: string, convId: string) => {
      abortRef.current?.abort();
      abortRef.current = new AbortController();
      const ac = abortRef.current;
      setStreamingText('');
      setStreamMeta({});
      setStreamLiveness(false);
      setStreamPhase('idle');
      setStatusLine(null);
      setToolSteps([]);
      setStreamStartedAt(null);
      setStreamOutputChars(0);
      let full = '';
      let outputChars = 0;
      let receivedFirstChunk = false;
      const resetStreamUi = () => {
        setStreamingText('');
        setStreamLiveness(false);
        setStreamPhase('idle');
        setStatusLine(null);
        setToolSteps([]);
        setStreamStartedAt(null);
        setStreamOutputChars(0);
      };
      try {
        setStreamLiveness(true);
        setStreamStartedAt(Date.now());
        setStreamPhase('connecting');
        bumpActivity();
        await streamChatJob({
          jobId,
          signal: ac.signal,
          onOpen: () => {
            bumpActivity();
          },
          handlers: {
            onQueued: (d) => {
              bumpActivity();
              setStreamPhase('queued');
              setStatusLine(
                d.position != null ? `Queued (position ${d.position})` : 'Queued — preparing…',
              );
            },
            onProcessing: (d) => {
              bumpActivity();
              setStreamPhase((prev) =>
                prev === 'streaming' || prev === 'tooling' ? prev : 'processing',
              );
              setStreamMeta((m) => ({
                ...m,
                model: d.modelId ?? m.model,
                modelProvider: d.modelProvider ?? m.modelProvider,
                agentSlug: d.agentSlug ?? m.agentSlug,
                webSearch: m.webSearch ?? false,
              }));
            },
            onStatus: (d) => {
              bumpActivity();
              if (receivedFirstChunk) return;

              if (typeof d.content === 'string') {
                // `status.content` may arrive as token fragments; keep spacing verbatim.
                setStatusLine((prev) => `${prev ?? ''}${d.content}`);
                // Reasoning/narration is model output too — count it so the live
                // token estimate ticks up from the first event, not just answer chunks.
                outputChars += d.content.length;
                setStreamOutputChars(outputChars);
                return;
              }

              const fullStatus =
                (typeof d.message === 'string' && d.message.trim()) ||
                (typeof d.phase === 'string' && d.phase.trim()) ||
                '';
              if (fullStatus) setStatusLine(fullStatus);
            },
            onChunk: (d) => {
              bumpActivity();
              if (!receivedFirstChunk) {
                receivedFirstChunk = true;
                setStatusLine(null);
                setToolSteps([]);
              }
              setStreamPhase('streaming');
              const piece = typeof d.content === 'string' ? d.content : '';
              full += piece;
              outputChars += piece.length;
              setStreamOutputChars(outputChars);
              setStreamingText(full);
              processChunk(piece);
            },
            onToolCall: (d) => {
              bumpActivity();
              if (receivedFirstChunk) return;
              setStreamPhase('tooling');
              const callId =
                typeof d.callId === 'string' && d.callId
                  ? d.callId
                  : `call_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
              const toolId = typeof d.toolId === 'string' && d.toolId ? d.toolId : 'tool';
              setToolSteps((prev) => [
                ...prev,
                {
                  callId,
                  toolId,
                  argsSummary: extractToolArgsSummary(d.arguments),
                  status: 'running',
                },
              ]);
              if (toolId === 'web_search') {
                setStreamMeta((m) => ({ ...m, webSearch: true }));
              }
            },
            onToolResult: (d) => {
              bumpActivity();
              if (receivedFirstChunk) return;
              const summary = summarizeToolOutput(d.output);
              setToolSteps((prev) => {
                const idx = prev.findIndex((s) => s.callId === d.callId);
                if (idx === -1) {
                  return [
                    ...prev,
                    {
                      callId: d.callId,
                      toolId: 'tool',
                      argsSummary: '',
                      status: 'done',
                      durationMs: d.durationMs,
                      resultSummary: summary,
                    },
                  ];
                }
                const next = [...prev];
                next[idx] = {
                  ...next[idx],
                  status: 'done',
                  durationMs: d.durationMs,
                  resultSummary: summary,
                };
                return next;
              });
            },
            onArtifact: (a) => {
              bumpActivity();
              bumpFilesListVersion();
              const label =
                (typeof a.title === 'string' && a.title.trim()) || a.artifactId || 'artifact';
              setStatusLine(`Artifact: ${label}`);
            },
            onUsage: (u) => {
              bumpActivity();
              const parsed = parseStreamTokensUsed(u.tokensUsed);
              const credits =
                typeof u.creditsDeducted === 'number' ? u.creditsDeducted : undefined;
              if (parsed) {
                setStreamMeta((m) => ({
                  ...m,
                  outputTokensExact: parsed.output,
                  tokenTooltip: buildStreamTokenTooltip(
                    parsed,
                    credits ?? m.creditsDeducted ?? 0,
                  ),
                  creditsDeducted: credits ?? m.creditsDeducted,
                }));
              } else if (credits != null) {
                setStreamMeta((m) => ({ ...m, creditsDeducted: credits }));
              }
            },
            onDone: async (d) => {
              const stats = normalizeDoneStats(d);
              const parsed = parseStreamTokensUsed(
                (d as { tokensUsed?: unknown }).tokensUsed ?? stats?.tokensUsed,
              );
              const doneCredits = (d as { creditsDeducted?: unknown }).creditsDeducted;
              const credits = typeof doneCredits === 'number' ? doneCredits : undefined;
              setStreamMeta((m) => {
                const next = {
                  ...m,
                  generationStats: stats ?? m.generationStats,
                };
                if (parsed) {
                  next.outputTokensExact = parsed.output;
                  next.tokenTooltip = buildStreamTokenTooltip(
                    parsed,
                    credits ?? m.creditsDeducted ?? 0,
                  );
                } else if (stats) {
                  const inputCached = stats.tokensUsed.inputCached;
                  const inputFresh = Math.max(0, stats.tokensUsed.input - inputCached);
                  next.outputTokensExact = stats.tokensUsed.output;
                  next.tokenTooltip = buildStreamTokenTooltip(
                    {
                      output: stats.tokensUsed.output,
                      inputFresh,
                      inputCached,
                    },
                    credits ?? m.creditsDeducted ?? 0,
                  );
                }
                if (credits != null) next.creditsDeducted = credits;
                return next;
              });
              setStreamPhase('completed');
              setStatusLine(null);
              await refreshAfterStream(convId);
              bumpFilesListVersion();
              await refreshBalance();
              await refreshUsageSummary();
            },
            onError: (d) => {
              bumpActivity();
              const { message, code } = formatStreamErrorBanner(d);
              setBanner(message);
              setBannerCode(code);
              setStreamPhase('error');
            },
            onCancelled: () => {
              bumpActivity();
              setStreamPhase('cancelled');
              setBanner('Generation cancelled.');
              setBannerCode('cancelled');
            },
            onHeartbeat: () => {
              bumpActivity();
            },
            onUnknownEvent: (event: string, _data: Record<string, unknown>) => {
              void _data;
              bumpActivity();
              setStatusLine((prev) =>
                prev ? `${prev} · event: ${event}` : `Received event: ${event}`,
              );
            },
          },
        });
      } catch (e) {
        if ((e as Error)?.name === 'AbortError') return;
        try {
          const st = await getChatJob(jobId);
          if (st.status === 'completed' && st.resultMessageId) {
            await refreshAfterStream(convId);
          }
        } catch {
          pushApiErrorBanner(e);
        }
      } finally {
        resetStreamUi();
        resetStreamParser();
        streamingConvIdRef.current = null;
        setIsSending(false);
      }
    },
    [
      bumpActivity,
      bumpFilesListVersion,
      processChunk,
      refreshBalance,
      refreshAfterStream,
      refreshUsageSummary,
      resetStreamParser,
    ],
  );

  const handleSend = async () => {
    const content = input.trim();
    if (!content || isSending || attachmentsBlockSend) return;
    setBanner(null);
    setBannerCode(null);
    setIsSending(true);
    setInput('');

    let convId = effectiveConvId;
    try {
      if (!convId) {
        const conv = await createConversationAndSelect({
          defaultModelId: selectedModel?.id !== 'auto' ? selectedModel?.id : null,
        });
        convId = conv.id;
      }

      streamingConvIdRef.current = convId;

      const clientMessageId = crypto.randomUUID();
      const slug = selectedAgentSlug?.trim();
      const attachedFileIds = getReadyAttachedFileIds(attachments, serverFileIdByTempIdRef.current);
      const body = {
        conversationId: convId,
        clientMessageId,
        content,
        attachedFileIds,
        ...(slug ? { agentSlug: slug } : {}),
      };

      const { jobId } = await enqueueChat(body);
      resetComposerAttachments();
      await refreshConversation(convId);
      scrollMessagesToBottom();
      await runStream(jobId, convId);
    } catch (e) {
      pushApiErrorBanner(e);
      setIsSending(false);
    }
  };

  const handleCancel = async () => {
    const convId = streamingConvIdRef.current ?? conversationId ?? null;
    if (!convId) return;
    abortRef.current?.abort();
    try {
      await cancelChat(convId);
    } catch (e) {
      pushApiErrorBanner(e);
    }
    setIsSending(false);
    setStreamingText('');
    setStreamLiveness(false);
    setStreamPhase('idle');
    setStatusLine(null);
    setToolSteps([]);
    setStreamStartedAt(null);
    setStreamOutputChars(0);
    setStreamMeta({});
    resetStreamParser();
    streamingConvIdRef.current = null;
    await refreshConversation(convId);
  };

  return (
    <div
      className={`flex flex-col h-full min-h-0 bg-app relative ${showEmptyHero ? 'overflow-visible' : ''}`}
    >
      <header className="flex items-center gap-3 px-4 h-[52px] border-b border-border-subtle shrink-0">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <button
            type="button"
            onClick={onToggleSidebarAction}
            className="lg:hidden p-2 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-3 shrink-0 transition-colors"
            aria-label="Open sidebar"
          >
            <Menu size={20} />
          </button>
          <h1 className="text-sm font-semibold text-text-primary truncate min-w-0">
            {activeConversation?.title?.trim() || 'New chat'}
          </h1>
        </div>
        {!isCanvasOpen ? (
          <button
            type="button"
            onClick={onOpenCanvasAction}
            className="text-[11px] font-medium text-accent hover:text-accent px-3 py-1.5 rounded-lg border border-border-default hover:bg-surface-2 shrink-0 transition-colors"
          >
            Open canvas
          </button>
        ) : null}
      </header>

      {(banner || convError) && (
        <div className="mx-4 mt-3 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-100/95">
          <AlertCircle className="shrink-0 mt-0.5" size={16} />
          <div className="min-w-0">
            {bannerCode && <p className="text-[10px] font-mono text-text-muted mb-0.5">{bannerCode}</p>}
            <p className="whitespace-pre-line">{banner || convError}</p>
          </div>
          <button
            type="button"
            className="ml-auto text-text-muted hover:text-text-primary text-[11px]"
            onClick={() => {
              setBanner(null);
              setBannerCode(null);
            }}
          >
            Dismiss
          </button>
        </div>
      )}

      <div
        ref={messagesScrollRef}
        className={
          showEmptyHero
            ? 'flex-1 relative flex flex-col items-center justify-center overflow-visible'
            : 'flex-1 overflow-y-auto min-h-0 relative'
        }
      >
        {showEmptyHero ? (
          <div className="w-full max-w-[1080px] mx-auto px-4 sm:px-6 py-8 pb-[200px] overflow-visible">
            <TaskSelectionView
              onSelectAction={(text, agentSlug) => {
                setInput(text);
                setSelectedAgentSlug(agentSlug?.trim() ? agentSlug.trim() : null);
              }}
            />
          </div>
        ) : (
          <div className="max-w-[820px] lg:max-w-[1080px] mx-auto px-4 sm:px-6 pt-4 pb-[180px] space-y-4">
            {isLoadingMessages && effectiveConvId && sortedMessages.length === 0 ? (
              <MessageSkeleton count={3} />
            ) : null}

            {sortedMessages.map((m: ApiMessage) =>
              m.role === 'user' ? (
                <UserMessage
                  key={m.id}
                  content={m.content}
                  dateTime={formatTime(m.createdAt)}
                  attachedFiles={m.attachedFiles?.length ? m.attachedFiles : undefined}
                  onOpenAttachedFile={handleOpenAttachedFile}
                />
              ) : (
                <AgentMessage
                  key={m.id}
                  content={getCleanMsg(m.content)}
                  dateTime={formatTime(m.createdAt)}
                  model={assistantModelBadgeLabel(m, catalogue)}
                  creditsDeducted={m.creditsDeducted}
                  promptBreakdown={m.promptBreakdown}
                  citations={m.citations}
                  webSearch={m.webSearchUsed}
                  isLoading={m.status === 'streaming'}
                  messageStatus={m.status}
                  generationStats={messageGenerationStats(m)}
                  artifacts={m.artifacts?.length ? m.artifacts : undefined}
                  onArtifactError={(msg) => {
                    setBanner(msg);
                    setBannerCode(null);
                  }}
                  onViewArtifact={handleViewArtifact}
                />
              ),
            )}

            {showStreamingRow ? (
              streamingText || toolSteps.length > 0 || Boolean(statusLine?.trim()) ? (
                <AgentMessage
                  agentName={streamingAgentName}
                  content={
                    getCleanMsg(streamingText) ||
                    streamPlaceholderMarkdown(streamPhase, statusLine)
                  }
                  dateTime="Streaming"
                  model={streamingRoutingBadgeLabel}
                  creditsDeducted={streamMeta.creditsDeducted || 0}
                  webSearch={Boolean(streamMeta.webSearch)}
                  tools={streamingTools}
                  isLoading={streamPhase !== 'completed'}
                  messageStatus={streamPhase === 'completed' ? 'complete' : 'streaming'}
                  generationStats={streamMeta.generationStats}
                  streamOutputTokens={streamOutputTokenDisplay}
                  streamElapsedMs={streamElapsedMs}
                />
              ) : (
                <ThinkingIndicator
                  agentName={streamingAgentName}
                  statusLine={statusLine || streamPlaceholderMarkdown(streamPhase, null).replace(/^_|_$/g, '')}
                  streamOutputTokens={streamOutputTokenDisplay}
                  streamElapsedMs={streamElapsedMs}
                />
              )
            ) : null}
          </div>
        )}

      </div>

      {showScrollToBottom && (
        <button
          type="button"
          onClick={() => {
            const el = messagesScrollRef.current;
            if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
          }}
          aria-label="Scroll to bottom"
          className="absolute left-1/2 -translate-x-1/2 bottom-[168px] z-30 w-9 h-9 rounded-full bg-surface-2/85 backdrop-blur-md border border-border-default text-text-secondary hover:text-text-primary hover:bg-surface-2 shadow-[0_8px_24px_rgba(0,0,0,0.5)] flex items-center justify-center transition-colors animate-in fade-in zoom-in-95 duration-150"
        >
          <ArrowDown size={16} />
        </button>
      )}

      <footer className="absolute bottom-0 left-0 right-0 px-4 pb-4 pt-2 pointer-events-none z-20">
        <div className="max-w-[820px] lg:max-w-[1080px] mx-auto pointer-events-auto">
          <div
            ref={composerRef}
            onDragEnter={handleDragEnter}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`relative rounded-[18px] border bg-surface-2/70 backdrop-blur-[24px] backdrop-saturate-150 shadow-[0_8px_32px_rgba(0,0,0,0.4),0_0_0_1px_rgba(255,255,255,0.03)] transition-colors ${isDragOver
              ? 'border-accent/60 ring-1 ring-accent/30'
              : 'border-border-default focus-within:border-accent/35'
              }`}
          >
            {isDragOver && (
              <div className="absolute inset-0 z-50 rounded-[18px] overflow-hidden pointer-events-none animate-in fade-in duration-150">
                <div className="absolute inset-0 bg-gradient-to-br from-purple-500/20 via-fuchsia-500/10 to-purple-500/20 backdrop-blur-md" />
                <div
                  className="absolute inset-1 rounded-[14px] border-2 border-dashed border-accent/60"
                  style={{ animation: 'pulse 1.6s ease-in-out infinite' }}
                />
                <div className="relative h-full w-full flex flex-col items-center justify-center gap-2 px-6 text-center">
                  <div className="w-12 h-12 rounded-2xl bg-accent/25 border border-purple-300/40 flex items-center justify-center shadow-[0_0_24px_rgba(168,85,247,0.5)]">
                    <UploadCloud size={22} className="text-accent" />
                  </div>
                  <p className="text-[13px] font-bold text-text-primary tracking-tight">
                    Drop files to attach
                  </p>
                  <p className="text-[11px] text-accent/80">
                    Release to upload · images, PDFs, docs, sheets &amp; more
                  </p>
                </div>
              </div>
            )}
            <div className="flex items-center justify-between gap-2 px-3 pt-2 pb-0 text-[11px]">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <div ref={agentPickerRef} className="relative z-[80] flex-1">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setAgentPickerOpen((o) => !o);
                    }}
                    title="Routing: Auto or pin a catalogue agent"
                    className="model-trigger-button flex items-center gap-1.5 cursor-pointer select-none group relative py-1 px-2 rounded-lg border border-transparent hover:border-border-subtle hover:bg-surface-2 transition-all text-text-muted hover:text-text-secondary"
                  >
                    <Zap className="w-3.5 h-3.5 text-accent shrink-0" fill="currentColor" />
                    <span className="text-[11px] font-semibold tracking-tight truncate text-left">
                      {agentPickerTriggerLabel}
                    </span>
                    <svg
                      className={`w-3 h-3 text-text-faint shrink-0 transition-transform ${agentPickerOpen ? 'rotate-180' : ''}`}
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      aria-hidden
                    >
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </button>

                  {agentPickerOpen && (
                    <div
                      className="absolute bottom-full left-0 mb-3 w-[280px] max-w-[calc(100vw-2rem)] sm:w-[320px] bg-sidebar/95 backdrop-blur-3xl border border-border-default rounded-3xl shadow-[0_30px_100px_rgba(0,0,0,0.8)] overflow-hidden ring-1 ring-border-subtle animate-in fade-in slide-in-from-bottom-4 duration-200"
                      onClick={(e) => e.stopPropagation()}
                      role="listbox"
                      aria-label="Select routing"
                    >
                      <div className="p-2 border-b border-border-subtle bg-surface-1">
                        <p className="px-3 py-1 text-[9px] sm:text-[10px] font-black text-text-faint uppercase tracking-[0.2em]">
                          Select conversation skill
                        </p>
                      </div>
                      <div className="max-h-[50vh] sm:max-h-[60vh] overflow-y-auto custom-scrollbar p-1.5 space-y-1">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedAgentSlug(null);
                            setAgentPickerOpen(false);
                          }}
                          className={`w-full group flex flex-col items-start px-4 py-3.5 text-left rounded-2xl transition-all duration-200 border border-transparent ${!selectedAgentSlug?.trim()
                            ? 'bg-accent/10 border-accent/20 shadow-[inset_0_0_20px_rgba(168,85,247,0.05)]'
                            : 'hover:bg-surface-2 hover:border-border-subtle'
                            }`}
                        >
                          <div className="w-full flex items-center justify-between mb-1 gap-2">
                            <div className="flex items-center gap-2.5 min-w-0">
                              <div
                                className={`w-2 h-2 rounded-full shrink-0 shadow-[0_0_8px_currentColor] ${!selectedAgentSlug?.trim()
                                  ? 'text-accent bg-accent'
                                  : 'text-text-faint bg-surface-3 group-hover:bg-surface-4'
                                  }`}
                              />
                              <span
                                className={`text-[14px] font-bold tracking-tight truncate ${!selectedAgentSlug?.trim()
                                  ? 'text-text-primary'
                                  : 'text-text-secondary group-hover:text-text-primary'
                                  }`}
                              >
                                Auto Mode
                              </span>
                            </div>
                            {!selectedAgentSlug?.trim() && (
                              <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-accent/20 text-accent text-[9px] font-black uppercase shrink-0">
                                Active
                              </div>
                            )}
                          </div>
                          <p
                            className={`text-[11px] leading-relaxed line-clamp-2 pl-4 ${!selectedAgentSlug?.trim() ? 'text-text-muted' : 'text-text-faint group-hover:text-text-faint'
                              }`}
                          >
                            Backend picks the best agent and model for each message.
                          </p>
                        </button>

                        {(catalogue?.categories ?? []).map((cat) => {
                          const agents = (cat.agents ?? []).filter((a) => a?.slug);
                          if (!agents.length) return null;
                          const sorted = [...agents].sort(
                            (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0),
                          );
                          return (
                            <div key={cat.id ?? cat.slug} className="pt-1">
                              <p className="px-3 py-1.5 text-[9px] font-black text-text-faint uppercase tracking-[0.2em]">
                                {cat.name}
                              </p>
                              {sorted.map((a) => {
                                const name = catalogueAgentDisplayName(a);
                                const short = catalogueAgentShortDescription(a);
                                const isActive = selectedAgentSlug?.trim() === a.slug;
                                return (
                                  <button
                                    key={a.slug}
                                    type="button"
                                    onClick={() => {
                                      setSelectedAgentSlug(a.slug);
                                      setAgentPickerOpen(false);
                                    }}
                                    className={`w-full group flex flex-col items-start px-4 py-3.5 text-left rounded-2xl transition-all duration-200 border border-transparent mt-0.5
                                ${isActive
                                        ? 'bg-accent/10 border-accent/20 shadow-[inset_0_0_20px_rgba(168,85,247,0.05)]'
                                        : 'hover:bg-surface-2 hover:border-border-subtle'
                                      }`}
                                  >
                                    <div className="w-full flex items-center justify-between mb-1 gap-2">
                                      <div className="flex items-center gap-2.5 min-w-0">
                                        <div
                                          className={`w-2 h-2 rounded-full shrink-0 shadow-[0_0_8px_currentColor] ${isActive
                                            ? 'text-accent bg-accent'
                                            : 'text-text-faint bg-surface-3 group-hover:bg-surface-4'
                                            }`}
                                        />
                                        <span
                                          className={`text-[14px] font-bold tracking-tight truncate ${isActive ? 'text-text-primary' : 'text-text-secondary group-hover:text-text-primary'
                                            }`}
                                        >
                                          {name}
                                        </span>
                                      </div>
                                      {isActive && (
                                        <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-accent/20 text-accent text-[9px] font-black uppercase shrink-0">
                                          Active
                                        </div>
                                      )}
                                    </div>
                                    {short ? (
                                      <p
                                        className={`text-[11px] leading-relaxed line-clamp-2 pl-4 ${isActive ? 'text-text-muted' : 'text-text-faint group-hover:text-text-faint'
                                          }`}
                                      >
                                        {short}
                                      </p>
                                    ) : null}
                                  </button>
                                );
                              })}
                            </div>
                          );
                        })}
                      </div>
                      <div className="p-3 bg-surface-1 border-t border-border-subtle flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
                          <span className="text-[10px] font-bold text-text-faint uppercase truncate">
                            Intelligence ready
                          </span>
                        </div>
                        <span className="text-[10px] font-medium text-text-faint shrink-0 tabular-nums">
                          {catalogueAgentCount} agents
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <RateLimitComposerIndicator />
                {attachments.length > 0 && (
                  <span
                    className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-accent/10 border border-accent/20 text-[10px] font-semibold text-accent tabular-nums"
                    title={`${attachments.length} attachment${attachments.length === 1 ? '' : 's'}`}
                  >
                    <Paperclip size={10} className="opacity-80" />
                    {attachments.length} attached
                  </span>
                )}
              </div>
            </div>

            {attachments.length > 0 && (
              <div className="px-3 pt-2 pb-1 border-b border-border-subtle">
                <div className="flex items-center gap-2 mb-1.5 px-0.5">
                  <p className="text-[9px] font-black tracking-[0.2em] text-text-faint uppercase">
                    Attachments
                  </p>
                  <span className="text-[10px] text-text-faint tabular-nums">
                    · {attachments.length}
                  </span>
                  <button
                    type="button"
                    onClick={clearAllAttachments}
                    className="ml-auto text-[10px] font-medium text-text-faint hover:text-text-secondary transition-colors px-1.5 py-0.5 rounded-md hover:bg-surface-2"
                  >
                    Clear all
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5 max-h-[124px] overflow-y-auto custom-scrollbar pr-1">
                  {attachments.map((att) => {
                    const visual = getFileVisual(att.type, att.name);
                    const VIcon = visual.Icon;
                    return (
                      <div
                        key={att.tempId}
                        className={`group/chip relative flex items-center gap-2.5 pl-1.5 pr-2 py-1.5 rounded-xl border bg-surface-2 backdrop-blur-md transition-all duration-200 hover:bg-surface-3 ${visual.ring}`}
                      >
                        <div
                          className={`relative w-9 h-9 rounded-lg flex items-center justify-center shrink-0 overflow-hidden border border-border-default ${visual.iconBg}`}
                        >
                          {att.previewUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={att.previewUrl}
                              alt={att.name}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <VIcon size={16} className={visual.iconColor} />
                          )}
                          {att.status === 'uploading' && (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/55 backdrop-blur-[2px]">
                              <Loader2 size={14} className="animate-spin text-text-primary" />
                            </div>
                          )}
                          {att.status === 'error' && (
                            <div className="absolute inset-0 flex items-center justify-center bg-red-500/60">
                              <AlertTriangle size={14} className="text-text-primary" />
                            </div>
                          )}
                          {att.status === 'ready' && (
                            <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-emerald-500/95 border border-app flex items-center justify-center shadow-[0_0_8px_rgba(16,185,129,0.5)]">
                              <CheckCircle2 size={10} className="text-text-primary" />
                            </div>
                          )}
                        </div>
                        <div className="min-w-0 max-w-[170px] flex-1">
                          <p
                            className="text-[12px] font-semibold text-text-primary truncate leading-tight"
                            title={att.name}
                          >
                            {att.name}
                          </p>
                          <p className="text-[10px] text-text-muted tabular-nums leading-tight mt-0.5 flex items-center gap-1">
                            <span className={`uppercase tracking-wider ${visual.iconColor} opacity-90`}>
                              {visual.label}
                            </span>
                            <span className="text-text-faint">·</span>
                            <span>{humanFileSize(att.size)}</span>
                            {att.status === 'uploading' && (
                              <>
                                <span className="text-text-faint">·</span>
                                <span className="text-text-secondary">Uploading…</span>
                              </>
                            )}
                            {att.status === 'error' && (
                              <>
                                <span className="text-text-faint">·</span>
                                <span className="text-red-300/90" title={att.errorMsg || 'Validation failed'}>
                                  {att.errorMsg || 'Validation failed'}
                                </span>
                              </>
                            )}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeAttachment(att.tempId)}
                          aria-label={`Remove ${att.name}`}
                          title="Remove"
                          className="shrink-0 w-6 h-6 rounded-md text-text-faint hover:text-text-primary hover:bg-surface-3 flex items-center justify-center transition-colors"
                        >
                          <X size={13} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            <div className="flex items-end gap-2 px-3 py-2.5">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadBusy || !fileUploadEnabled}
                title={
                  !fileUploadEnabled
                    ? 'File uploads are not available on your plan'
                    : 'Attach files (or drag · paste)'
                }
                aria-label="Attach files"
                className={`relative w-9 h-9 rounded-xl flex items-center justify-center transition-all shrink-0 mb-0.5 group/attach ${uploadBusy || !fileUploadEnabled
                  ? 'text-text-faint cursor-not-allowed bg-surface-1'
                  : attachments.length > 0
                    ? 'text-accent bg-accent/10 border border-accent/25 hover:bg-accent/15 hover:border-accent/40'
                    : 'text-text-muted hover:text-text-primary border border-transparent hover:border-border-default hover:bg-surface-3'
                  }`}
              >
                {uploadBusy ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <Paperclip
                    size={16}
                    className="transition-transform group-hover/attach:rotate-[-10deg]"
                  />
                )}
                {!uploadBusy && attachments.length > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[16px] h-[16px] px-1 rounded-full bg-accent text-[9px] font-bold text-text-primary flex items-center justify-center shadow-[0_0_8px_rgba(168,85,247,0.6)] tabular-nums">
                    {attachments.length}
                  </span>
                )}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                multiple
                accept={FILE_INPUT_ACCEPT}
                disabled={uploadBusy || !fileUploadEnabled}
                onChange={(e) => {
                  void onPickFiles(e.target.files);
                  if (e.target) e.target.value = '';
                }}
              />
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    if (canSend) void handleSend();
                  }
                }}
                onPaste={handlePaste}
                rows={3}
                disabled={isSending}
                placeholder={
                  attachments.length > 0
                    ? 'Add a message about these attachments…'
                    : 'Message Grizon AI… (drag, paste or attach files)'
                }
                className="flex-1 resize-none bg-transparent text-[14px] text-text-primary placeholder:text-text-faint outline-none leading-relaxed py-1 min-h-[24px] max-h-[180px] custom-scrollbar"
              />
              <div className="flex items-center gap-1 shrink-0 mb-0.5">
                {isSending ? (
                  <button
                    type="button"
                    onClick={() => void handleCancel()}
                    className="w-8 h-8 rounded-lg bg-red-500/20 border border-red-500/30 text-red-300 hover:bg-red-500/30 flex items-center justify-center transition-colors"
                    title="Stop"
                  >
                    <Square size={14} fill="currentColor" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void handleSend()}
                    disabled={!canSend}
                    className="w-8 h-8 rounded-lg bg-accent hover:bg-accent-hover text-text-primary flex items-center justify-center transition-colors disabled:opacity-25 disabled:cursor-not-allowed"
                    title={
                      attachmentsBlockSend
                        ? 'Wait for attachments to finish processing'
                        : 'Send'
                    }
                    aria-label="Send message"
                  >
                    {attachmentsBlockSend && input.trim() ? (
                      <Loader2 size={15} className="animate-spin" />
                    ) : (
                      <Send size={15} />
                    )}
                  </button>
                )}
              </div>
            </div>
          </div>
          <p className="text-center text-[10px] text-text-faint mt-2">
            Grizon AI can make mistakes. Verify important information.
          </p>
        </div>
      </footer>
    </div>
  );
}

function ModelPickerRow() {
  const { availableModels, selectedModel, setSelectedModel } = useModels();
  return (
    <select
      className="w-full max-w-xs bg-input border border-border-default rounded-lg px-2 py-1.5 text-[12px] text-text-secondary"
      value={selectedModel?.id ?? 'auto'}
      onChange={(e) => {
        const id = e.target.value;
        const m = availableModels.find((x) => x.id === id);
        if (m) setSelectedModel(m);
      }}
    >
      {availableModels.map((m) => (
        <option key={m.id} value={m.id}>
          {m.name}
        </option>
      ))}
    </select>
  );
}
