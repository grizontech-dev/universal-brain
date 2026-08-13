'use client';

import React, { useState } from 'react';

interface BrainDiffViewerProps {
    diff?: string;
    fileName?: string;
    isNew?: boolean;
    className?: string;
}

export default function BrainDiffViewer({ diff, fileName, isNew, className = '' }: BrainDiffViewerProps) {
    const [showAll, setShowAll] = useState(false);
    const maxLines = 120;

    const lines = (diff || '').split('\n').filter((l) => !l.startsWith('---') && !l.startsWith('+++'));
    const visible = showAll ? lines : lines.slice(0, maxLines);
    const hasMore = lines.length > maxLines;

    let added = 0;
    let removed = 0;
    for (const line of lines) {
        if (line.startsWith('+')) added++;
        else if (line.startsWith('-')) removed++;
    }

    if (isNew && !diff) {
        return (
            <div className={`rounded-lg border border-zinc-700 bg-[#18181b] overflow-hidden ${className}`}>
                <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-zinc-800 bg-zinc-900">
                    <span className="text-[11px] font-mono text-zinc-300 truncate">{fileName || 'New file'}</span>
                    <span className="text-[10px] font-mono text-emerald-400 shrink-0">+new</span>
                </div>
                <div className="px-3 py-3 text-[12px] text-emerald-300">
                    New file created — open the file to see its code.
                </div>
            </div>
        );
    }

    return (
        <div className={`rounded-lg border border-zinc-700 bg-[#18181b] overflow-hidden ${className}`}>
            <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-zinc-800 bg-zinc-900">
                <span className="text-[11px] font-mono text-zinc-300 truncate">{fileName || 'Diff'}</span>
                <span className="flex items-center gap-2 text-[11px] font-mono shrink-0">
                    <span className="text-emerald-400 font-semibold">+{added}</span>
                    <span className="text-red-400 font-semibold">-{removed}</span>
                </span>
            </div>
            {lines.length === 0 ? (
                <div className="px-3 py-3 text-[12px] text-zinc-400">No changes</div>
            ) : (
                <pre className="overflow-x-auto max-h-[400px] overflow-y-auto custom-scrollbar text-[12px] leading-[1.7] font-mono">
                    {visible.map((line, i) => {
                        let cls = 'text-zinc-300';
                        let bg = '';
                        if (line.startsWith('@@')) {
                            cls = 'text-purple-300 font-semibold';
                            bg = '';
                        } else if (line.startsWith('+')) {
                            cls = 'text-emerald-300';
                            bg = 'bg-emerald-500/15';
                        } else if (line.startsWith('-')) {
                            cls = 'text-red-300';
                            bg = 'bg-red-500/15';
                        } else if (line.startsWith(' ')) {
                            cls = 'text-zinc-400';
                        }
                        const marker = [' ', '+', '-', '@'].includes(line.charAt(0)) ? line.charAt(0) : ' ';
                        const markerColor = line.startsWith('+')
                            ? 'text-emerald-400'
                            : line.startsWith('-')
                              ? 'text-red-400'
                              : line.startsWith('@@')
                                ? 'text-purple-400'
                                : 'text-zinc-600';
                        return (
                            <div key={i} className={`flex ${bg}`}>
                                <span className={`inline-block w-7 text-right pr-2 select-none shrink-0 ${markerColor}`}>{marker}</span>
                                <span className={`flex-1 whitespace-pre-wrap break-words ${cls}`}>
                                    {line.startsWith('+') || line.startsWith('-') ? line.slice(1) : line}
                                </span>
                            </div>
                        );
                    })}
                    {hasMore && (
                        <button
                            onClick={() => setShowAll(true)}
                            className="w-full px-3 py-2 text-[12px] text-purple-400 hover:bg-zinc-800 text-left font-medium"
                        >
                            Show all {lines.length} diff lines
                        </button>
                    )}
                </pre>
            )}
        </div>
    );
}
