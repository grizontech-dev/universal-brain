import { getApiBaseUrl } from './auth-constants';
import { grizonRequestJson } from './grizon-api-client';
import { ApiError } from './auth-api';
import { authenticatedFetch } from './auth-session';
import type { AuthTokenBundle, AuthUserProfile } from './auth-api';
import type {
  ApiArtifact,
  ApiConversation,
  ApiMessage,
  ApiMessageAttachedFile,
  ApiMessageArtifact,
  ApiMessageFile,
  CatalogueResponse,
  ChatCancelResponse,
  ChatEnqueueResponse,
  ChatJobStatusResponse,
  Plan,
  SubscriptionResponse,
  WalletResponse,
} from './chat-contracts';
import type {
  AuthSessionsListDto,
  UsageHistoryDto,
  UsageRateLimitDto,
  UsageSummaryDto,
  WalletTransactionDetailDto,
  WalletTransactionsListDto,
} from '../types/settings-api';

const enc = (p: Record<string, string | number | undefined>) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) {
    if (v !== undefined && v !== '') q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : '';
};

// ─── Payment API ──────────────────────────────────────────────────────────────

export async function fetchPlans(): Promise<{ plans: Plan[]; pagination: { page: number; pageSize: number; total: number } }> {
  return grizonRequestJson('/api/v1/plans', { method: 'GET' });
}

export async function initiateTopup(packageId: string): Promise<{
  merchantOrderId: string;
  redirectUrl: string;
  creditsToAdd: number;
  amountPaise: number;
}> {
  return grizonRequestJson('/api/v1/payment/topup', { method: 'POST', body: { packageId } });
}

export async function getTopupStatus(orderId: string): Promise<{
  status: 'pending' | 'completed' | 'failed' | 'expired';
  creditsToAdd: number;
}> {
  return grizonRequestJson(`/api/v1/payment/topup/${encodeURIComponent(orderId)}/status`, { method: 'GET' });
}

export async function initiateSubscription(body: {
  planId: string;
  billingCycle: 'monthly' | 'annual';
  mobileNumber?: string;
}): Promise<{ merchantOrderId: string; merchantSubscriptionId: string; redirectUrl: string }> {
  return grizonRequestJson('/api/v1/payment/subscription/initiate', { method: 'POST', body });
}

export async function cancelSubscription(body: { immediate: boolean }): Promise<SubscriptionResponse> {
  return grizonRequestJson('/api/v1/payment/subscription/cancel', { method: 'POST', body });
}

// ─── Catalogue ────────────────────────────────────────────────────────────────

export async function fetchCatalogue(): Promise<CatalogueResponse> {
  return grizonRequestJson<CatalogueResponse>('/api/v1/catalogue', { method: 'GET' });
}

export async function fetchSubscription(): Promise<{ subscription: SubscriptionResponse }> {
  return grizonRequestJson<{ subscription: SubscriptionResponse }>('/api/v1/subscription', { method: 'GET' });
}

export async function fetchWallet(): Promise<WalletResponse> {
  return grizonRequestJson<WalletResponse>('/api/v1/wallet', { method: 'GET' });
}

export async function fetchUsageSummary(params?: { periodStart?: string; periodEnd?: string }): Promise<UsageSummaryDto> {
  return grizonRequestJson<UsageSummaryDto>(`/api/v1/usage/summary${enc(params ?? {})}`, { method: 'GET' });
}

export async function fetchUsageHistory(days?: number): Promise<UsageHistoryDto> {
  return grizonRequestJson<UsageHistoryDto>(`/api/v1/usage/history${enc(days !== undefined ? { days } : {})}`, {
    method: 'GET',
  });
}

export async function fetchUsageRateLimit(): Promise<UsageRateLimitDto> {
  return grizonRequestJson<UsageRateLimitDto>('/api/v1/usage/rate-limit', { method: 'GET' });
}

export async function fetchWalletTransactions(params?: {
  page?: number;
  page_size?: number;
  type?: string;
  from?: string;
  to?: string;
}): Promise<WalletTransactionsListDto> {
  return grizonRequestJson<WalletTransactionsListDto>(`/api/v1/wallet/transactions${enc(params ?? {})}`, {
    method: 'GET',
  });
}

export async function fetchWalletTransactionById(id: string): Promise<WalletTransactionDetailDto> {
  return grizonRequestJson<WalletTransactionDetailDto>(`/api/v1/wallet/transactions/${encodeURIComponent(id)}`, {
    method: 'GET',
  });
}

/** Authenticated profile update (`PATCH /auth/me`). */
export async function patchAuthMe(body: {
  name?: string;
  bio?: string | null;
  avatar_url?: string | null;
  locale?: string | null;
  timezone?: string | null;
}): Promise<AuthUserProfile> {
  return grizonRequestJson<AuthUserProfile>('/api/v1/auth/me', { method: 'PATCH', body });
}

/** Authenticated password change — returns new token pair (other sessions revoked server-side). */
export async function postAuthPasswordChange(body: {
  current_password: string;
  new_password: string;
}): Promise<AuthTokenBundle> {
  return grizonRequestJson<AuthTokenBundle>('/api/v1/auth/password/change', { method: 'POST', body });
}

export async function fetchAuthSessions(): Promise<AuthSessionsListDto> {
  return grizonRequestJson<AuthSessionsListDto>('/api/v1/auth/sessions', { method: 'GET' });
}

export async function deleteAuthSession(sessionId: string): Promise<void> {
  return grizonRequestJson<void>(`/api/v1/auth/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
}

export async function postAuthLogoutAll(): Promise<void> {
  return grizonRequestJson<void>('/api/v1/auth/logout-all', { method: 'POST' });
}

export async function postAuthEmailVerifyRequest(): Promise<void> {
  return grizonRequestJson<void>('/api/v1/auth/email/verify/request', { method: 'POST' });
}

export async function listConversations(opts?: { cursor?: string; limit?: number }): Promise<ApiConversation[]> {
  return grizonRequestJson<ApiConversation[]>(
    `/api/v1/conversations${enc({ cursor: opts?.cursor, limit: opts?.limit })}`,
    { method: 'GET' },
  );
}

export async function createConversation(body: {
  defaultAgentSlug?: string | null;
  defaultModelId?: string | null;
  tags?: string[];
}): Promise<{ conversation: ApiConversation }> {
  return grizonRequestJson<{ conversation: ApiConversation }>('/api/v1/conversations', {
    method: 'POST',
    body,
  });
}

export async function getConversation(id: string): Promise<{
  conversation: ApiConversation;
  messages: ApiMessage[];
  summary: { text: string; coversUpToMessageId: string } | null;
}> {
  return grizonRequestJson(`/api/v1/conversations/${id}`, { method: 'GET' });
}

/** All files uploaded to a conversation (newest first). */
export async function listConversationFiles(
  conversationId: string,
  opts?: { limit?: number },
): Promise<{ files: ApiMessageFile[] }> {
  return grizonRequestJson<{ files: ApiMessageFile[] }>(
    `/api/v1/conversations/${encodeURIComponent(conversationId)}/files${enc({ limit: opts?.limit ?? 100 })}`,
    { method: 'GET' },
  );
}

/** Latest AI-generated artifacts for a conversation (newest first). */
export async function listConversationArtifacts(
  conversationId: string,
  opts?: { limit?: number },
): Promise<{ artifacts: ApiArtifact[] }> {
  return grizonRequestJson<{ artifacts: ApiArtifact[] }>(
    `/api/v1/conversations/${encodeURIComponent(conversationId)}/artifacts${enc({ limit: opts?.limit ?? 100 })}`,
    { method: 'GET' },
  );
}

export async function patchConversation(
  id: string,
  body: { title?: string; pinned?: boolean; status?: 'active' | 'archived'; tags?: string[] },
): Promise<{ conversation: ApiConversation }> {
  return grizonRequestJson<{ conversation: ApiConversation }>(`/api/v1/conversations/${id}`, {
    method: 'PATCH',
    body,
  });
}

export async function deleteConversation(id: string): Promise<void> {
  await grizonRequestJson<void>(`/api/v1/conversations/${id}`, { method: 'DELETE' });
}

export async function listMessages(
  conversationId: string,
  opts?: { cursor?: string; limit?: number },
): Promise<ApiMessage[]> {
  return grizonRequestJson<ApiMessage[]>(
    `/api/v1/conversations/${conversationId}/messages${enc({ cursor: opts?.cursor, limit: opts?.limit })}`,
    { method: 'GET' },
  );
}

export type ChatEnqueueBody = {
  conversationId: string;
  clientMessageId: string;
  content: string;
  attachedFileIds?: string[];
  /** Omit for auto routing; backend derives mode. */
  agentSlug?: string;
  options?: {
    temperature?: number;
    customSystemPrompt?: string;
    searchContextSize?: 'low' | 'medium' | 'high';
  };
};

export async function enqueueChat(body: ChatEnqueueBody): Promise<ChatEnqueueResponse> {
  return grizonRequestJson<ChatEnqueueResponse>('/api/v1/chat', { method: 'POST', body });
}

export async function getChatJob(jobId: string): Promise<ChatJobStatusResponse> {
  return grizonRequestJson<ChatJobStatusResponse>(`/api/v1/chat/job/${jobId}`, { method: 'GET' });
}

export async function cancelChat(conversationId: string): Promise<ChatCancelResponse> {
  return grizonRequestJson<ChatCancelResponse>(`/api/v1/chat/${conversationId}/cancel`, { method: 'POST' });
}

export async function uploadFileJson(body: {
  conversationId?: string | null;
  fileName: string;
  fileType: string;
  fileSize: number;
  contentBase64: string;
}): Promise<{ file: ApiMessageFile }> {
  return grizonRequestJson<{ file: ApiMessageFile }>('/api/v1/files/upload', { method: 'POST', body });
}

export async function getFileStatus(fileId: string): Promise<{ file: ApiMessageFile }> {
  return grizonRequestJson<{ file: ApiMessageFile }>(`/api/v1/files/${fileId}`, { method: 'GET' });
}

export async function deleteFile(fileId: string): Promise<void> {
  await grizonRequestJson<void>(`/api/v1/files/${encodeURIComponent(fileId)}`, { method: 'DELETE' });
}

/** Raw file bytes from GET /api/v1/files/:id/download (inline Content-Disposition). */
export async function downloadFile(fileId: string): Promise<Blob> {
  const res = await authenticatedFetch(`/api/v1/files/${encodeURIComponent(fileId)}/download`, {
    method: 'GET',
  });
  if (!res.ok) {
    let message = res.statusText || 'Failed to download file';
    try {
      const text = await res.text();
      const parsed = text ? JSON.parse(text) : null;
      if (parsed && typeof parsed === 'object' && 'message' in parsed && typeof parsed.message === 'string') {
        message = parsed.message;
      }
    } catch {
      /* use default message */
    }
    throw new ApiError(res.status, undefined, message);
  }
  return res.blob();
}

/** Fetch file with auth and open in a new browser tab. */
export async function openMessageFileInNewTab(file: ApiMessageAttachedFile): Promise<void> {
  const blob = await downloadFile(file.id);
  const typedBlob =
    file.fileType && blob.type !== file.fileType ? new Blob([blob], { type: file.fileType }) : blob;
  const url = URL.createObjectURL(typedBlob);
  const opened = window.open(url, '_blank', 'noopener,noreferrer');
  if (!opened) {
    URL.revokeObjectURL(url);
    throw new ApiError(0, 'POPUP_BLOCKED', 'Allow pop-ups to open this file.');
  }
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function streamUrlForJob(jobId: string): string {
  const base = getApiBaseUrl().replace(/\/$/, '');
  return `${base}/api/v1/chat/stream/${jobId}`;
}

export async function getArtifactById(artifactId: string): Promise<{ artifact: ApiArtifact }> {
  return grizonRequestJson<{ artifact: ApiArtifact }>(
    `/api/v1/artifacts/${encodeURIComponent(artifactId)}`,
    { method: 'GET' },
  );
}

/** Raw bytes from GET /api/v1/artifacts/:id/download (attachment Content-Disposition). */
export async function downloadArtifact(artifactId: string): Promise<Blob> {
  const res = await authenticatedFetch(
    `/api/v1/artifacts/${encodeURIComponent(artifactId)}/download`,
    { method: 'GET' },
  );
  if (!res.ok) {
    let message = res.statusText || 'Failed to download artifact';
    try {
      const text = await res.text();
      const parsed = text ? JSON.parse(text) : null;
      if (parsed && typeof parsed === 'object' && 'message' in parsed && typeof parsed.message === 'string') {
        message = parsed.message;
      }
    } catch {
      /* use default message */
    }
    throw new ApiError(res.status, undefined, message);
  }
  return res.blob();
}

/** Trigger browser download for a message artifact using metadata filename. */
export async function saveMessageArtifactToDisk(artifact: ApiMessageArtifact): Promise<void> {
  const blob = await downloadArtifact(artifact.id);
  const typedBlob =
    artifact.mimeType && blob.type !== artifact.mimeType
      ? new Blob([blob], { type: artifact.mimeType })
      : blob;
  const url = URL.createObjectURL(typedBlob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = artifact.filename || artifact.title || 'download';
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 500);
}
