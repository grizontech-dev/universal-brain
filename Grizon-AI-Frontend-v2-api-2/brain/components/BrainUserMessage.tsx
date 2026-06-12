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
                <span className="text-[12px] font-medium text-white/20 uppercase tracking-[0.1em]">You</span>
            </div>
            <div className="bg-[#1a1a1a] px-5 py-3 rounded-2xl text-white/90 leading-relaxed text-[16px] font-medium w-fit max-w-[85%] border border-white/5 shadow-xl">
                <MarkdownRenderer content={content.trim()} />
            </div>
        </div>
    );
}
