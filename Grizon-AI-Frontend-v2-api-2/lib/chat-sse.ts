import { fetchEventSource } from '@microsoft/fetch-event-source';
import { getApiBaseUrl, PLATFORM_WEB } from './auth-constants';
import { ensureAccessToken } from './auth-session';
import type { ChatSseHandlers } from './chat-contracts';

export interface StreamChatOptions {
  jobId: string;
  signal?: AbortSignal;
  handlers: ChatSseHandlers;
  onOpen?: () => void;
}

/**
 * Subscribes to `GET /api/v1/chat/stream/:jobId` with Bearer + x-platform headers.
 */
export async function streamChatJob(opts: StreamChatOptions): Promise<void> {
  const base = getApiBaseUrl().replace(/\/$/, '');
  const url = `${base}/api/v1/chat/stream/${encodeURIComponent(opts.jobId)}`;
  const access = await ensureAccessToken();
  const headers: Record<string, string> = {
    accept: 'text/event-stream',
    'x-platform': PLATFORM_WEB,
  };
  if (access) headers.Authorization = `Bearer ${access}`;

  await fetchEventSource(url, {
    method: 'GET',
    signal: opts.signal,
    openWhenHidden: true,
    headers,
    onopen: async (res) => {
      if (res.ok) {
        opts.onOpen?.();
        return;
      }
      const text = await res.text().catch(() => '');
      throw new Error(text || `SSE failed: ${res.status}`);
    },
    onmessage: (ev) => {
      const event = ev.event || 'message';
      let data: unknown = {};
      try {
        data = ev.data ? JSON.parse(ev.data) : {};
      } catch {
        data = { raw: ev.data };
      }
      dispatchSse(event, data as Record<string, unknown>, opts.handlers);
    },
    onerror: (err) => {
      if (opts.signal?.aborted) return;
      opts.handlers.onError?.({
        message: err instanceof Error ? err.message : String(err),
        code: 'STREAM_ERROR',
      });
      throw err;
    },
  });
}

function dispatchSse(event: string, data: Record<string, unknown>, h: ChatSseHandlers) {
  switch (event) {
    case 'queued':
      h.onQueued?.(data as { position?: number });
      break;
    case 'processing':
      h.onProcessing?.(data as { agentSlug?: string | null; modelId?: string | null; modelProvider?: string | null });
      break;
    case 'status':
      h.onStatus?.(data as { phase?: string; message?: string });
      break;
    case 'chunk':
      h.onChunk?.(data as { content: string });
      break;
    case 'tool_call':
      h.onToolCall?.(
        data as { toolId?: string; name?: string; arguments?: unknown; callId: string },
      );
      break;
    case 'tool_result':
      h.onToolResult?.(
        data as { callId: string; output?: unknown; durationMs?: number; summary?: string },
      );
      break;
    case 'artifact':
      h.onArtifact?.(
        data as { artifactId: string; type?: string; title?: string; latest?: boolean },
      );
      break;
    case 'usage':
      h.onUsage?.(
        data as {
          tokensUsed?: { inputFresh: number; inputCached: number; output: number; cacheWrite: number };
          creditsDeducted?: number;
          walletBalanceAfter?: number;
          promptBreakdown?: {
            system_tokens?: number;
            context_tokens?: number;
            message_tokens?: number;
            response_tokens?: number;
            tool_result_tokens?: number;
            total_input_actual?: number;
          };
          prompt_breakdown?: {
            system_tokens?: number;
            context_tokens?: number;
            message_tokens?: number;
            response_tokens?: number;
            tool_result_tokens?: number;
            total_input_actual?: number;
          };
        },
      );
      break;
    case 'done':
      h.onDone?.(
        data as {
          messageId: string;
          conversationId: string;
          status: 'completed';
          durationMs?: number;
          llmFirstTokenMs?: number | null;
          llmTotalMs?: number | null;
          tokensUsed?: {
            input: number;
            inputCached: number;
            output: number;
            cacheWrite: number;
          };
          creditsDeducted?: number;
        },
      );
      break;
    case 'error':
      h.onError?.(data as { code?: string; message?: string; retryable?: boolean });
      break;
    case 'cancelled':
      h.onCancelled?.(data as { reason?: string });
      break;
    case 'heartbeat':
      h.onHeartbeat?.();
      break;
    default:
      h.onUnknownEvent?.(event, data);
      break;
  }
}
