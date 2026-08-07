'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
    CheckCircle2, Circle, Loader2, FilePlus, FilePen, FileSearch,
    FolderPlus, Terminal, Sparkles, Search, Compass, AlertCircle,
    Layers, Clock, ChevronDown, ChevronRight, Check
} from 'lucide-react';
import type { BuildActivity, BuildActivityType, BuildTodoItem } from '../lib/buildActivity';
import { isBuildTodosComplete, isNoisyTerminalLine, normalizeTodoStatus } from '../lib/buildActivity';
import { getBrainApiUrl } from '../lib/brainApiBase';

export type { BuildTodoItem };

interface BrainBuildActivityFeedProps {
    activities: BuildActivity[];
    todos: BuildTodoItem[];
    isSyncing?: boolean;
    workedSeconds?: number;
    className?: string;
}

function iconForType(type: BuildActivityType) {
    switch (type) {
        case 'write_file': return FilePlus;
        case 'edit_file': return FilePen;
        case 'read_file': return FileSearch;
        case 'mkdir': return FolderPlus;
        case 'run_command': return Terminal;
        case 'template': return Layers;
        case 'search': return Search;
        case 'explore': return Compass;
        case 'task_start':
        case 'task_done':
        case 'task_failed':
        case 'milestone': return Sparkles;
        case 'sync': return Loader2;
        default: return Circle;
    }
}

function todoStatusIcon(status?: string) {
    const s = normalizeTodoStatus(status);
    if (s === 'completed') {
        return <CheckCircle2 size={14} className="text-emerald-500 shrink-0" />;
    }
    if (s === 'failed') {
        return <AlertCircle size={14} className="text-red-500 shrink-0" />;
    }
    if (s === 'executing') {
        return <Loader2 size={14} className="text-accent animate-spin shrink-0" />;
    }
    return <Circle size={14} className="text-text-muted shrink-0" />;
}

function fileBasename(p: string): string {
    const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
    return idx >= 0 ? p.slice(idx + 1) : p;
}

function TodoChips({ todo }: { todo: BuildTodoItem }) {
    const files = (todo.files || []).filter(Boolean);
    const apis = (todo.api || []).filter(Boolean);
    if (files.length === 0 && apis.length === 0) return null;

    const fileChips = files.slice(0, 3).map(fileBasename);
    const apiChips = apis.slice(0, 2);
    const extraFiles = files.length - fileChips.length;
    const extraApis = apis.length - apiChips.length;

    return (
        <div className="flex flex-wrap items-center gap-1 mt-0.5">
            {fileChips.map((f, i) => (
                <span
                    key={`f-${i}`}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-surface-2 border border-border-subtle text-[10px] font-mono text-text-muted"
                >
                    <FilePlus size={9} className="shrink-0" />
                    {f}
                </span>
            ))}
            {extraFiles > 0 && (
                <span className="text-[10px] text-text-muted/60 font-mono">+{extraFiles}</span>
            )}
            {apiChips.map((a, i) => (
                <span
                    key={`a-${i}`}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-accent/10 border border-accent/20 text-[10px] font-mono text-accent"
                >
                    <Terminal size={9} className="shrink-0" />
                    {a}
                </span>
            ))}
            {extraApis > 0 && (
                <span className="text-[10px] text-text-muted/60 font-mono">+{extraApis}</span>
            )}
        </div>
    );
}

function FileChangeCard({ singleAct }: { singleAct: any }) {
    const [isOpen, setIsOpen] = useState(false);
    const [fileContent, setFileContent] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const filePath = singleAct.path || singleAct.label || '';
    const fileName = fileBasename(filePath);
    const dirPath = filePath.includes('/') ? filePath.split('/').slice(0, -1).join('/') : '';
    const isFolder = filePath.endsWith('/');
    const isNew = singleAct.isNew;
    const actionLabel = isNew ? 'Created' : 'Edited';
    const actionColor = isNew ? 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20' : 'text-amber-500 bg-amber-500/10 border-amber-500/20';
    const hasLines = (singleAct.linesAdded || 0) > 0 || (singleAct.linesRemoved || 0) > 0;

    const fetchFileContent = async () => {
        if (fileContent !== null || !filePath) return;
        setLoading(true);
        try {
            const jobId = (window as any).__brainJobId || '';
            const userId = (window as any).__brainUserId || '';
            if (!jobId) { setFileContent('// No workspace'); setLoading(false); return; }
            const uid = userId ? `&user_id=${encodeURIComponent(userId)}` : '';
            const url = getBrainApiUrl(`sandbox/read-file?workspace_id=${encodeURIComponent(jobId)}&path=${encodeURIComponent(filePath)}${uid}`);
            const res = await fetch(url, { cache: 'no-store' });
            if (res.ok) {
                const data = await res.json();
                setFileContent(data.content ?? '// Empty file');
            } else {
                setFileContent('// Unable to load file');
            }
        } catch {
            setFileContent('// Unable to load file');
        }
        setLoading(false);
    };

    const handleToggle = () => {
        const next = !isOpen;
        setIsOpen(next);
        if (next && fileContent === null) fetchFileContent();
    };

    const handleFileOpen = () => {
        if (!isFolder && filePath) {
            window.dispatchEvent(new CustomEvent('openBrainFile', { detail: { path: filePath } }));
        }
    };

    const ext = fileName.split('.').pop()?.toLowerCase() || '';
    const langMap: Record<string, string> = { js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript', py: 'python', sql: 'sql', css: 'css', html: 'html', json: 'json', md: 'markdown' };
    const lang = langMap[ext] || 'text';

    return (
        <div className="animate-in fade-in slide-in-from-bottom-1 duration-200">
            <button
                onClick={() => { handleToggle(); handleFileOpen(); }}
                className="w-full flex items-center gap-2.5 py-2 px-2.5 rounded-lg hover:bg-surface-2 transition-colors group"
            >
                {isFolder
                    ? <FolderPlus size={14} className="text-text-muted shrink-0" />
                    : <FilePen size={14} className="text-text-muted shrink-0" />}
                <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded border ${actionColor} shrink-0`}>
                        {actionLabel}
                    </span>
                    <div className="flex flex-col items-start min-w-0">
                        <span className="text-[13px] font-medium text-text-primary truncate max-w-full">{fileName}</span>
                        {dirPath && (
                            <span className="text-[10px] text-text-muted truncate max-w-full">{dirPath}</span>
                        )}
                    </div>
                </div>
                {hasLines && (
                    <div className="flex items-center gap-1 text-[11px] font-mono shrink-0">
                        {singleAct.linesAdded > 0 && <span className="text-emerald-500">+{singleAct.linesAdded}</span>}
                        {singleAct.linesRemoved > 0 && <span className="text-red-500">-{singleAct.linesRemoved}</span>}
                    </div>
                )}
                <ChevronRight
                    size={12}
                    className={`text-text-muted shrink-0 transition-transform duration-150 ${isOpen ? 'rotate-90' : ''}`}
                />
            </button>

            {isOpen && !isFolder && (
                <div className="ml-6 mt-1 mb-2 rounded-lg border border-border-subtle bg-[#0d0d0d] overflow-hidden">
                    {loading ? (
                        <div className="flex items-center gap-2 px-3 py-2.5 text-[11px] text-text-muted">
                            <Loader2 size={12} className="animate-spin" />
                            <span>Loading...</span>
                        </div>
                    ) : fileContent ? (
                        <pre className="overflow-x-auto max-h-[300px] overflow-y-auto custom-scrollbar text-[11px] leading-[1.6] font-mono">
                            <code className="block p-3">
                                {fileContent.split('\n').map((line, i) => (
                                    <div key={i} className="flex">
                                        <span className="inline-block w-7 text-right pr-2 text-text-muted/40 select-none shrink-0">{i + 1}</span>
                                        <span className={`flex-1 ${line.trim().startsWith('//') || line.trim().startsWith('#') || line.trim().startsWith('/*') ? 'text-text-muted/50 italic' : 'text-text-primary/80'}`}>
                                            {line || '\u00A0'}
                                        </span>
                                    </div>
                                ))}
                            </code>
                        </pre>
                    ) : (
                        <div className="px-3 py-2.5 text-[11px] text-text-muted">No content</div>
                    )}
                </div>
            )}
        </div>
    );
}

function CollapsibleActivityGroup({ act, activities }: { act: any, activities: any[] }) {
    return (
        <div className="flex flex-col py-0.5">
            {activities.map((singleAct: any) => (
                <FileChangeCard key={singleAct.id} singleAct={singleAct} />
            ))}
        </div>
    );
}

export default function BrainBuildActivityFeed({
    activities,
    todos,
    isSyncing,
    workedSeconds,
    className = '',
}: BrainBuildActivityFeedProps) {
    const milestones = activities.filter((a) => a.type === 'task_done' || a.type === 'milestone');
    const stream = activities.filter((a) => {
        if (a.type === 'task_done' || a.type === 'milestone') return false;
        if (a.type === 'narration' && isNoisyTerminalLine(a.label)) return false;
        return true;
    });

    const dedupedStream = (() => {
        // 1. Keep the LATEST occurrence of each ID
        const latestById = new Map();
        for (const a of stream) {
            latestById.set(a.id, a);
        }
        
        // 2. Convert back to array, preserving original order
        const orderedUnique = [];
        const seenInOrder = new Set();
        for (const a of stream) {
            if (!seenInOrder.has(a.id)) {
                seenInOrder.add(a.id);
                orderedUnique.push(latestById.get(a.id));
            }
        }

        // 3. Filter out redundant reloads and duplicate narrations/explore tasks
        let sawReload = false;
        let lastExploreLabel: string | null = null;
        const seenNarrations = new Set();
        
        return orderedUnique.reverse().filter((a) => {
            const isReload = a.type === 'narration' && a.label.includes('Reloaded — restoring preview');
            if (isReload) {
                if (sawReload) return false;
                sawReload = true;
            }
            if (a.type === 'explore' || a.type === 'task_start') {
                if (a.label === lastExploreLabel) return false;
                lastExploreLabel = a.label;
            } else if (a.type !== 'narration' && !['write_file', 'edit_file', 'mkdir'].includes(a.type)) {
                lastExploreLabel = null;
            }
            
            if (a.type === 'narration') {
                if (seenNarrations.has(a.label)) return false; // dedup identical narrations globally in this stream
                seenNarrations.add(a.label);
            }
            return true;
        }).reverse();
    })();

    const streamEndRef = useRef<HTMLDivElement>(null);
    const tasksEndRef = useRef<HTMLLIElement>(null);

    useEffect(() => {
        streamEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }, [dedupedStream.length, activities.length]);

    return (
        <div className={`flex flex-col ${className}`}>
            {isSyncing && !isBuildTodosComplete(todos) && (
                <div className="mx-4 mt-4 flex items-center gap-2 px-3 py-2 rounded-full bg-surface-2 border border-border-subtle text-[12px] text-text-secondary">
                    <Loader2 size={14} className="animate-spin text-accent" />
                    <span>Syncing project files…</span>
                </div>
            )}

            {todos.length > 0 && (
                <div className="px-3 pt-3 pb-2 border-b border-border-subtle sticky top-0 z-10 bg-surface-2">
                    <p className="text-[10px] font-bold text-text-muted uppercase tracking-widest mb-2">
                        Tasks <span className="text-text-muted/60 normal-case">({todos.filter(t => t.status === 'completed' || t.status === 'done' || t.status === 'success').length}/{todos.length})</span>
                    </p>
                    <ul className="space-y-1 max-h-[220px] overflow-y-auto custom-scrollbar">
                        {todos.map((t, i) => {
                            const s = (t.status || '').toLowerCase();
                            const isRunning = s === 'executing' || s === 'running' || s === 'pending_confirmation';
                            const isDone = t.status === 'completed' || t.status === 'done' || t.status === 'success';
                            return (
                            <li
                                key={t.id || i}
                                ref={isRunning ? tasksEndRef : undefined}
                                className="flex flex-col py-0.5"
                            >
                                <div className="flex items-center gap-2 text-[11px]">
                                    <span className={`shrink-0 ${
                                        isDone ? 'text-emerald-500'
                                        : isRunning ? 'text-accent' : 'text-text-muted'
                                    }`}>
                                        {isDone ? '✔' : isRunning ? <Loader2 size={11} className="animate-spin" /> : '○'}
                                    </span>
                                    <span className={`leading-snug truncate ${
                                        isDone
                                            ? 'text-text-muted line-through'
                                            : isRunning
                                              ? 'text-accent font-semibold'
                                              : 'text-text-primary'
                                    }`}>
                                        {t.title || t.task || 'Task'}
                                    </span>
                                </div>
                                <div className="pl-[18px]">
                                    <TodoChips todo={t} />
                                </div>
                            </li>
                            );
                        })}
                    </ul>
                </div>
            )}

            <div className="flex-1 px-2 py-3 space-y-2.5">
                {dedupedStream.length === 0 && !isSyncing && (
                    <p className="text-[13px] text-text-muted leading-relaxed">
                        Building your project in Sandbox. Actions will appear here as they run.
                    </p>
                )}

                {(() => {
                    const grouped: any[] = [];
                    let currentGroup: any = null;
                    for (const act of dedupedStream) {
                        const isFileOp = ['write_file', 'edit_file', 'mkdir', 'read_file'].includes(act.type);
                        if (isFileOp) {
                            // Each file op becomes its own individual card (Lovable style)
                            currentGroup = null;
                            grouped.push({
                                id: act.id,
                                isGroup: true,
                                type: 'file_single',
                                singleAct: act,
                            });
                        } else {
                            currentGroup = null;
                            grouped.push(act);
                        }
                    }
                    
                    const completedTodos = todos.filter(t => t.status === 'completed' || t.status === 'done' || t.status === 'success');
                    
                    const isTaskCompleted = (taskTitle: string, actIdx: number) => {
                        if (!taskTitle) return false;
                        
                        // 1. If there's a task_done activity for this taskTitle later in the feed
                        if (activities.some(a => a.type === 'task_done' && a.taskTitle === taskTitle)) {
                            return true;
                        }
                        
                        // 2. Since tasks run sequentially, if there is ANY newer task_start or explore after this one, this one is done
                        const hasNewerTask = grouped.slice(actIdx + 1).some((a: any) => 
                            !a.isGroup && (a.type === 'explore' || a.type === 'task_start')
                        );
                        if (hasNewerTask) {
                            return true;
                        }

                        // 3. Fallback to todo status fuzzy matching
                        const key = taskTitle.trim().toLowerCase();
                        return completedTodos.some(t => {
                            const tk = (t.title || t.task || '').trim().toLowerCase();
                            return tk === key || (tk && key.includes(tk)) || (key && tk.includes(key));
                        });
                    };

                    return grouped.map((act: any, idx: number) => {
                        const isMilestone = act.type === 'task_done' || act.type === 'milestone';

                        if (isMilestone) {
                            return (
                                <div
                                    key={act.id}
                                    className="rounded-xl border border-border-subtle bg-surface-2 px-3 py-2.5 flex items-center justify-between gap-2 animate-in fade-in duration-300"
                                >
                                    <div className="flex items-center gap-2 min-w-0">
                                        <Sparkles size={14} className="text-accent shrink-0" />
                                        <span className="text-[13px] font-bold text-text-primary truncate">{act.label}</span>
                                    </div>
                                    {act.status === 'done' && (
                                        <CheckCircle2 size={14} className="text-emerald-500 shrink-0" />
                                    )}
                                </div>
                            );
                        }

                        if (act.isGroup) {
                            if (act.type === 'file_single') {
                                return <FileChangeCard key={act.id} singleAct={act.singleAct} />;
                            }
                            return <CollapsibleActivityGroup key={act.id} act={act} activities={act.activities} />;
                        }

                        if (act.type === 'explore' || act.type === 'task_start') {
                            const isRunning = act.status === 'running' && !isTaskCompleted(act.taskTitle || '', idx);
                            const labelText = act.label.replace(/^Exploring\s*[-—]\s*/i, 'Moved to ');
                            const matchedTodo = todos.find(t => {
                                const title = (t.title || t.task || '').toLowerCase();
                                const taskTitle = (act.taskTitle || '').toLowerCase();
                                return title && taskTitle && (title.includes(taskTitle) || taskTitle.includes(title));
                            });
                            return (
                                <div key={act.id} className="flex items-center gap-2.5 animate-in fade-in slide-in-from-bottom-1 duration-200 py-2">
                                    <div className="w-[18px] h-[18px] rounded-full bg-surface-2 border border-border-subtle flex items-center justify-center shrink-0">
                                        {isRunning ? (
                                            <Loader2 size={10} className="text-accent animate-spin" />
                                        ) : (
                                            <Check size={10} className="text-emerald-500" />
                                        )}
                                    </div>
                                    <div className="flex flex-col min-w-0 flex-1">
                                        <span className={`text-[13px] font-bold truncate ${isRunning ? 'text-accent' : 'text-text-primary'}`}>
                                            {labelText}
                                        </span>
                                        {matchedTodo && <TodoChips todo={matchedTodo} />}
                                    </div>
                                </div>
                            );
                        }

                        if (act.type === 'thinking') {
                            const timeStr = act.timestamp ? new Date(act.timestamp).toLocaleTimeString([], { hour12: false }) : '';
                            return (
                                <div key={act.id} className="flex flex-col animate-in fade-in slide-in-from-bottom-1 duration-200 py-2">
                                    <div className="flex items-start gap-3">
                                        <span className="text-[11px] text-text-muted font-mono shrink-0 mt-0.5">{timeStr}</span>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-[13px] text-text-secondary italic leading-relaxed">
                                                <span className="font-semibold text-text-primary not-italic mr-2">💭 Thinking:</span>
                                                {act.label}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            );
                        }

                        // Normal narration — clean paragraph, visible high-contrast text
                        return (
                            <div key={act.id} className="animate-in fade-in slide-in-from-bottom-1 duration-200 py-1">
                                <p className="text-[13.5px] font-medium text-text-primary leading-[1.7]">{act.label}</p>

                                {act.detail && act.type === 'run_command' && !act.reason && (
                                    <p className="text-[11px] text-text-muted mt-1 font-mono truncate">{act.detail}</p>
                                )}
                            </div>
                        );
                    });
                })()}
                
                <div ref={streamEndRef} className="h-1 shrink-0" aria-hidden />
            </div>

            {workedSeconds !== undefined && workedSeconds > 0 && (
                <div className="px-4 py-3 border-t border-border-subtle flex items-center justify-between gap-2 text-[11px] text-text-muted">
                    <div className="flex items-center gap-2">
                        <Clock size={12} className="text-accent" />
                        <span>Worked for {workedSeconds}s</span>
                    </div>
                </div>
            )}
        </div>
    );
}

