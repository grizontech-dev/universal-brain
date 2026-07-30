import React from 'react';
import { FileText, Folder as FolderIcon, Music, Film, File, Image, FileCode, Archive, Table } from 'lucide-react';
import { MarkdownRenderer } from '@/components/chat/MarkdownRenderer';

interface BrainUserMessageProps {
    content: string;
    dateTime?: string;
}

export default function BrainUserMessage({ content, dateTime }: BrainUserMessageProps) {
    return (
        <div className="flex flex-col items-end gap-1 w-full pb-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div className="flex items-center gap-2 mb-1 px-1">
                <span className="text-[11px] font-bold text-accent/80 uppercase tracking-[0.1em]">You</span>
            </div>
            <div className="bg-surface-2 px-5 py-3 rounded-2xl rounded-tr-sm text-text-primary leading-relaxed text-[15px] font-normal w-fit max-w-[85%] border border-border-default shadow-sm break-words [overflow-wrap:anywhere] [word-break:break-word]">
                <MarkdownRenderer content={content.trim()} />
            </div>
        </div>
    );
}

