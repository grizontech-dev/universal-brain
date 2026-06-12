'use client';

import React, { useCallback, useState } from 'react';
import { FileText, Folder as FolderIcon, Music, Film, File, Image, FileCode, Archive, Table, Loader2 } from 'lucide-react';
import { MarkdownRenderer } from './MarkdownRenderer';
import { useAuth } from '@/context/AuthContext';
import type { ApiMessageAttachedFile } from '@/lib/chat-contracts';
interface UserMessageProps {
    content: string;
    dateTime?: string;
    documents?: { id: string, name: string, isFolder: boolean, extractedText?: string }[];
    attachedFiles?: ApiMessageAttachedFile[];
    onOpenAttachedFile?: (file: ApiMessageAttachedFile) => void;
}

function deriveDisplayName(user: { name?: string; email?: string } | null | undefined): string {
    const name = user?.name?.trim();
    if (name) return name;
    const email = user?.email?.trim();
    if (email) return email.split('@')[0];
    return 'You';
}

function getInitial(displayName: string): string {
    const ch = displayName.trim().charAt(0);
    return ch ? ch.toUpperCase() : 'Y';
}

function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const getFileInfo = (name: string, isFolder: boolean) => {
    if (isFolder) return { icon: <FolderIcon size={13} />, label: 'FOLDER', color: 'bg-gradient-to-br from-amber-400 to-yellow-600' };

    const ext = name.split('.').pop()?.toLowerCase() || '';

    if (['mp3', 'wav', 'm4a', 'ogg'].includes(ext)) {
        return { icon: <Music size={13} />, label: ext.toUpperCase(), color: 'bg-gradient-to-br from-sky-400 to-blue-600' };
    }
    if (['mp4', 'webm', 'mov', 'avi'].includes(ext)) {
        return { icon: <Film size={13} />, label: ext.toUpperCase(), color: 'bg-gradient-to-br from-indigo-400 to-violet-600' };
    }
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) {
        return { icon: <Image size={13} />, label: ext.toUpperCase(), color: 'bg-gradient-to-br from-emerald-400 to-teal-600' };
    }
    if (['zip', '7z', 'rar', 'tar', 'gz'].includes(ext)) {
        return { icon: <Archive size={13} />, label: ext.toUpperCase(), color: 'bg-gradient-to-br from-amber-500 to-orange-700' };
    }
    if (['js', 'ts', 'tsx', 'py', 'cpp', 'c', 'java', 'html', 'css', 'md', 'json'].includes(ext)) {
        return { icon: <FileCode size={13} />, label: ext.toUpperCase(), color: 'bg-gradient-to-br from-purple-400 to-fuchsia-600' };
    }
    if (['csv', 'xlsx', 'xls'].includes(ext)) {
        return { icon: <Table size={13} />, label: ext.toUpperCase(), color: 'bg-gradient-to-br from-green-400 to-emerald-700' };
    }
    if (ext === 'pdf') {
        return { icon: <FileText size={13} />, label: 'PDF', color: 'bg-gradient-to-br from-rose-400 to-red-600' };
    }

    return { icon: <File size={13} />, label: ext.toUpperCase() || 'FILE', color: 'bg-gradient-to-br from-slate-400 to-slate-600' };
};

export default function UserMessage({ content, dateTime, documents, attachedFiles, onOpenAttachedFile }: UserMessageProps) {
    const { user } = useAuth();
    const displayName = deriveDisplayName(user);
    const avatarUrl = user?.avatar_url || user?.avatar || null;
    const initial = getInitial(displayName);
    const [openingFileId, setOpeningFileId] = useState<string | null>(null);
    const [openError, setOpenError] = useState<string | null>(null);

    const handleOpenFile = useCallback(
        (file: ApiMessageAttachedFile) => {
            if (file.processingStatus !== 'ready') return;
            if (!onOpenAttachedFile) return;
            if (openingFileId) return;
            setOpenError(null);
            setOpeningFileId(file.id);
            try {
                onOpenAttachedFile(file);
            } catch (e) {
                const msg = e instanceof Error ? e.message : 'Could not open file';
                setOpenError(msg);
            } finally {
                setOpeningFileId(null);
            }
        },
        [onOpenAttachedFile, openingFileId],
    );

    const trimmedContent = content.replace(/\[SYSTEM INSTRUCTION:[\s\S]*?\]/g, '').trim();

    return (
        <div className="flex flex-col items-end gap-1 w-full max-w-full min-w-0 overflow-hidden animate-in fade-in slide-in-from-bottom-1 duration-200">
            {documents && documents.length > 0 && (
                <div className="flex flex-col items-end gap-1.5 mb-1.5 w-full max-w-full">
                    {documents.map((doc, i) => {
                        const { icon, label, color } = getFileInfo(doc.name, doc.isFolder);
                        return (
                            <div
                                key={doc.id || i}
                                className="group flex items-center gap-1.5 bg-gradient-to-br from-white/[0.05] to-white/[0.02] border border-white/[0.08] rounded-lg pl-1 pr-2 py-1 backdrop-blur-sm shadow-sm w-fit max-w-[80%] min-w-0 overflow-hidden"
                            >
                                <div className={`relative w-5 h-5 rounded-md flex items-center justify-center shrink-0 ${color} text-white shadow-sm overflow-hidden`}>
                                    <div className="absolute inset-0 bg-gradient-to-b from-white/25 via-transparent to-black/10 pointer-events-none" />
                                    <div className="relative z-10 flex items-center justify-center">{icon}</div>
                                </div>
                                <div className="flex items-baseline gap-1.5 min-w-0 overflow-hidden">
                                    <span className="text-[12px] leading-tight font-medium text-text-secondary truncate">{doc.name}</span>
                                    <span className="text-[9px] leading-tight text-text-muted font-semibold tracking-wider uppercase shrink-0">{label}</span>
                                    {doc.extractedText && (
                                        <span className="text-[9px] leading-tight text-emerald-400/70 font-medium shrink-0">Read</span>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
            <div className="flex items-center justify-end gap-2 mb-0.5 pr-0.5">
                {dateTime && (
                    <span className="text-[11px] text-text-faint tabular-nums">{dateTime}</span>
                )}
                <span className="text-[11px] font-semibold text-accent/80 tracking-tight">
                    {displayName}
                </span>
                <div className="w-5 h-5 rounded-md overflow-hidden shrink-0 bg-accent/15 border border-accent/25 flex items-center justify-center">
                    {avatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={avatarUrl} alt={displayName} className="w-full h-full object-cover" />
                    ) : (
                        <span className="text-[10px] font-bold text-accent uppercase leading-none">
                            {initial}
                        </span>
                    )}
                </div>
            </div>
            {trimmedContent && (
                <div className="bg-bubble-user px-4 py-2.5 rounded-2xl rounded-br-md text-text-primary leading-relaxed text-[14px] sm:text-[15px] w-fit max-w-[min(85%,640px)] border border-bubble-user-border shadow-sm break-words [overflow-wrap:anywhere] [word-break:break-word] whitespace-pre-wrap overflow-hidden flex flex-col min-w-0">
                    <MarkdownRenderer content={trimmedContent} />
                </div>
            )}
            {attachedFiles && attachedFiles.length > 0 && (
                <div className="flex flex-col items-end gap-1.5 mt-1.5 w-full max-w-full">
                    {attachedFiles.map((file) => {
                        const { icon, color } = getFileInfo(file.fileName, false);
                        const isReady = file.processingStatus === 'ready';
                        const isOpening = openingFileId === file.id;
                        const disabled = !isReady || !onOpenAttachedFile || isOpening || !!openingFileId;

                        return (
                            <button
                                key={file.id}
                                type="button"
                                disabled={disabled}
                                onClick={() => void handleOpenFile(file)}
                                className={`group flex items-center gap-1.5 bg-gradient-to-br from-white/[0.05] to-white/[0.02] border border-white/[0.08] rounded-lg pl-1 pr-2 py-1 backdrop-blur-sm shadow-sm w-fit max-w-[80%] min-w-0 overflow-hidden text-left transition-all ${
                                    isReady
                                        ? 'cursor-pointer hover:from-white/[0.08] hover:to-white/[0.04] hover:border-white/[0.16] hover:shadow-md active:scale-[0.98]'
                                        : 'cursor-not-allowed opacity-60'
                                }`}
                                title={isReady ? `View ${file.fileName}` : `File is ${file.processingStatus}`}
                            >
                                <div className={`relative w-5 h-5 rounded-md flex items-center justify-center shrink-0 ${color} text-white shadow-sm overflow-hidden`}>
                                    <div className="absolute inset-0 bg-gradient-to-b from-white/25 via-transparent to-black/10 pointer-events-none" />
                                    {isOpening ? (
                                        <Loader2 size={11} className="animate-spin text-white/95 relative z-10" />
                                    ) : (
                                        <div className="relative z-10 flex items-center justify-center">{icon}</div>
                                    )}
                                </div>
                                <div className="flex items-baseline gap-1.5 min-w-0 overflow-hidden">
                                    <span className="text-[12px] leading-tight font-medium text-text-secondary truncate">{file.fileName}</span>
                                    <span className="text-[10px] leading-tight text-text-muted font-medium tabular-nums shrink-0">
                                        {formatFileSize(file.fileSize)}
                                    </span>
                                    {!isReady && (
                                        <span className="text-[9px] leading-tight text-amber-400/80 font-medium capitalize shrink-0">
                                            {file.processingStatus}
                                        </span>
                                    )}
                                </div>
                            </button>
                        );
                    })}
                    {openError && (
                        <p className="text-[11px] text-red-400/90 pr-1" role="alert">
                            {openError}
                        </p>
                    )}
                </div>
            )}
        </div>
    );
}
