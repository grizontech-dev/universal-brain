/**
 * File upload + chat attachment contract (aligned with backend file.controller / chat.controller).
 * @see grizon-ai-backend-2/src/controllers/user/file.controller.ts
 */

/** MIME types the backend accepts on POST /api/v1/files/upload (documents only in UI — images fail in worker). */
export const FILE_UPLOAD_ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'text/plain',
] as const;

export type FileUploadAllowedMime = (typeof FILE_UPLOAD_ALLOWED_MIME_TYPES)[number];

/** Backend accepts these but worker marks failed (unsupported_mime) — block in UI. */
export const FILE_UPLOAD_BLOCKED_IMAGE_MIME_TYPES = ['image/png', 'image/jpeg'] as const;

export const FILE_UPLOAD_IMAGE_COMING_SOON =
  'Image uploads are coming soon. Vision support is not available yet.';

export const FILE_UPLOAD_POLL_INTERVAL_MS = 2000;
/** 30 × 2s = 60s max wait for processingStatus === "ready". */
export const FILE_UPLOAD_POLL_MAX_ATTEMPTS = 30;

export const FILE_UPLOAD_ERROR_MESSAGES = {
  FILE_TYPE_NOT_ALLOWED: "This file type isn't supported",
  FILE_TOO_LARGE: 'File exceeds your plan limit',
  FILE_LIMIT_PER_CHAT: 'Max files per conversation reached',
  ATTACHED_FILE_NOT_READY: 'Files are still processing. Wait until they are ready to send.',
} as const;

export type FileUploadErrorCode = keyof typeof FILE_UPLOAD_ERROR_MESSAGES;

export const FILE_UPLOAD_EXT_TO_MIME: Record<string, FileUploadAllowedMime> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv',
  txt: 'text/plain',
};

export const FILE_INPUT_ACCEPT =
  '.pdf,.docx,.xlsx,.csv,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,text/plain';

export function mapFileUploadCodeToMessage(code: string | null | undefined): string | null {
  if (!code) return null;
  if (code in FILE_UPLOAD_ERROR_MESSAGES) {
    return FILE_UPLOAD_ERROR_MESSAGES[code as FileUploadErrorCode];
  }
  return null;
}
