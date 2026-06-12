import type { LucideIcon } from 'lucide-react';
import {
  Code2,
  File,
  FileImage,
  FileJson,
  FileSpreadsheet,
  FileText,
} from 'lucide-react';
import { artifactExtension, specForArtifactType } from './file-kinds';

export type CanvasViewerKind =
  | 'code'
  | 'pdf'
  | 'json'
  | 'image'
  | 'readme'
  | 'html'
  | 'docx'
  | 'spreadsheet'
  | 'binary';

export type FileVisual = {
  Icon: LucideIcon;
  colorClass: string;
  label: string;
  viewerKind: CanvasViewerKind;
};

function extFromName(name: string): string {
  const parts = name.split('.');
  if (parts.length < 2) return '';
  return (parts.pop() ?? '').toLowerCase();
}

export function viewerKindFromMimeAndName(mimeType: string | undefined, fileName: string): CanvasViewerKind {
  const mime = (mimeType ?? '').toLowerCase();
  const ext = extFromName(fileName);

  if (mime.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) {
    return 'image';
  }
  if (mime === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (mime.includes('json') || ext === 'json') return 'json';
  if (
    mime.includes('html') ||
    ext === 'html' ||
    ext === 'htm'
  ) {
    return 'html';
  }
  if (
    mime.includes('markdown') ||
    ext === 'md' ||
    ext === 'markdown' ||
    ext === 'txt'
  ) {
    return 'readme';
  }
  if (mime === 'text/csv' || mime.includes('spreadsheet') || ext === 'xlsx' || ext === 'xls' || ext === 'csv') {
    return 'spreadsheet';
  }
  if (
    mime.includes('wordprocessingml') ||
    mime.includes('msword') ||
    ext === 'docx' ||
    ext === 'doc'
  ) {
    return 'docx';
  }
  if (
    mime.startsWith('text/') ||
    ['js', 'ts', 'tsx', 'jsx', 'py', 'java', 'c', 'cpp', 'css', 'xml', 'yaml', 'yml', 'sh', 'sql'].includes(ext)
  ) {
    return 'code';
  }
  if (['pptx', 'ppt'].includes(ext) || mime.includes('presentation')) {
    return 'binary';
  }
  return 'binary';
}

export function visualForUploadedFile(fileName: string, fileType: string): FileVisual {
  const ext = extFromName(fileName);
  const viewerKind = viewerKindFromMimeAndName(fileType, fileName);

  if (viewerKind === 'image') {
    return { Icon: FileImage, colorClass: 'text-[#a78bfa]', label: ext.toUpperCase() || 'IMAGE', viewerKind };
  }
  if (viewerKind === 'pdf') {
    return { Icon: FileText, colorClass: 'text-[#f87171]', label: 'PDF', viewerKind };
  }
  if (viewerKind === 'json') {
    return { Icon: FileJson, colorClass: 'text-[#fbbf24]', label: 'JSON', viewerKind };
  }
  if (viewerKind === 'readme' || viewerKind === 'code') {
    return { Icon: Code2, colorClass: 'text-[#60a5fa]', label: ext.toUpperCase() || 'TEXT', viewerKind };
  }
  if (viewerKind === 'spreadsheet' || ['csv', 'xlsx', 'xls'].includes(ext)) {
    return {
      Icon: FileSpreadsheet,
      colorClass: 'text-[#4ade80]',
      label: ext.toUpperCase() || 'SHEET',
      viewerKind: viewerKind === 'spreadsheet' ? 'spreadsheet' : viewerKind,
    };
  }
  if (viewerKind === 'docx') {
    return { Icon: FileText, colorClass: 'text-[#60a5fa]', label: 'DOCX', viewerKind };
  }
  return { Icon: File, colorClass: 'text-white/50', label: ext.toUpperCase() || 'FILE', viewerKind };
}

export function visualForArtifact(artifactType: string, filename: string): FileVisual {
  const type = (artifactType || '').toLowerCase();
  const ext = (artifactExtension(artifactType) || extFromName(filename)).replace(/^\./, '');
  const viewerKind = viewerKindFromMimeAndName(
    specForArtifactType(type)?.mimeType,
    filename,
  );

  if (type === 'spreadsheet' || ext === 'xlsx' || ext === 'xls') {
    return {
      Icon: FileSpreadsheet,
      colorClass: 'text-[#4ade80]',
      label: 'Spreadsheet',
      viewerKind: 'spreadsheet',
    };
  }
  if (type === 'csv' || ext === 'csv') {
    return {
      Icon: FileSpreadsheet,
      colorClass: 'text-[#4ade80]',
      label: 'CSV',
      viewerKind: 'spreadsheet',
    };
  }
  if (type === 'document' || ext === 'docx' || ext === 'doc') {
    return { Icon: FileText, colorClass: 'text-[#60a5fa]', label: 'Document', viewerKind: 'docx' };
  }
  if (type === 'pdf' || ext === 'pdf') {
    return { Icon: FileText, colorClass: 'text-[#f87171]', label: 'PDF', viewerKind: 'pdf' };
  }
  if (type === 'image' || ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext)) {
    return { Icon: FileImage, colorClass: 'text-[#a78bfa]', label: 'Image', viewerKind: 'image' };
  }
  if (type === 'markdown' || ext === 'md' || ext === 'txt') {
    return { Icon: Code2, colorClass: 'text-[#c4b5fd]', label: 'Markdown', viewerKind: 'readme' };
  }
  if (type === 'html' || ext === 'html') {
    return { Icon: Code2, colorClass: 'text-[#fbbf24]', label: 'HTML', viewerKind: 'html' };
  }
  return {
    Icon: File,
    colorClass: 'text-[#c4b5fd]',
    label: type ? type.charAt(0).toUpperCase() + type.slice(1) : 'Artifact',
    viewerKind,
  };
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
