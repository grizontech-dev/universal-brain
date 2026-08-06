"use client";

import React from 'react';
import { CheckCircle2, Circle, Loader2, PlayCircle, Terminal, ShieldCheck, FilePlus } from 'lucide-react';

interface Task {
    task: string;
    description: string;
    status: 'pending' | 'executing' | 'completed' | 'failed';
    files?: string[];
    api?: string[];
}

function fileBasename(p: string): string {
    const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
    return idx >= 0 ? p.slice(idx + 1) : p;
}

function TaskChips({ files, apis }: { files?: string[]; apis?: string[] }) {
    const fileList = (files || []).filter(Boolean);
    const apiList = (apis || []).filter(Boolean);
    if (fileList.length === 0 && apiList.length === 0) return null;
    return (
        <div className="flex flex-wrap gap-1 mt-1.5">
            {fileList.slice(0, 3).map((f, i) => (
                <span key={`f-${i}`} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-white/[0.04] border border-white/[0.06] text-[10px] font-mono text-white/40">
                    <FilePlus size={9} className="shrink-0" />
                    {fileBasename(f)}
                </span>
            ))}
            {fileList.length > 3 && (
                <span className="text-[10px] text-white/30 font-mono">+{fileList.length - 3}</span>
            )}
            {apiList.slice(0, 2).map((a, i) => (
                <span key={`a-${i}`} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-[#976df8]/[0.08] border border-[#976df8]/[0.15] text-[10px] font-mono text-[#c4b5fd]">
                    <Terminal size={9} className="shrink-0" />
                    {a}
                </span>
            ))}
            {apiList.length > 2 && (
                <span className="text-[10px] text-white/30 font-mono">+{apiList.length - 2}</span>
            )}
        </div>
    );
}

interface BrainTodoCanvasProps {
    todoList: Task[];
}

export default function BrainTodoCanvas({ todoList }: BrainTodoCanvasProps) {
    if (!todoList || todoList.length === 0) return null;

    const completedCount = todoList.filter(t => t.status === 'completed').length;
    const progress = Math.round((completedCount / todoList.length) * 100);
    const activeTask = todoList.find(t => t.status === 'executing');

    return (
        <div className="w-full mt-6 animate-in fade-in slide-in-from-bottom-4 duration-700 font-sans">
            <div className="bg-surface-2 border border-border-default rounded-2xl overflow-hidden shadow-xl">
                
                {/* Dashboard Header */}
                <div className="px-6 py-5 bg-surface-1/40 border-b border-border-subtle flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-surface-3 rounded-xl border border-border-subtle">
                            <Terminal size={18} className="text-accent" />
                        </div>
                        <div>
                            <h3 className="text-[14px] font-bold text-text-primary tracking-tight uppercase font-display">Execution Pipeline</h3>
                            <p className="text-[11px] text-text-muted font-medium uppercase tracking-[0.05em]">Mission Control • Build v1.0</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-4">
                        <div className="text-right">
                            <div className="text-[18px] font-bold text-text-primary tabular-nums">{completedCount} of {todoList.length} Done</div>
                            <div className="text-[10px] text-text-muted font-bold uppercase tracking-wider">Pipeline Progress</div>
                        </div>
                        <div className="w-24 h-1.5 bg-surface-3 rounded-full overflow-hidden border border-border-subtle">
                            <div 
                                className="h-full bg-accent transition-all duration-1000 ease-out shadow-sm" 
                                style={{ width: `${progress}%` }}
                            />
                        </div>
                    </div>
                </div>

                {/* Active Task Highlight */}
                {activeTask && (
                    <div className="px-6 py-4 bg-surface-1/60 border-b border-border-subtle flex items-center gap-4">
                        <div className="relative">
                            <div className="absolute inset-0 bg-accent/30 rounded-full animate-ping" />
                            <PlayCircle size={20} className="relative text-accent z-10" />
                        </div>
                        <div className="flex-1">
                            <div className="text-[10px] font-bold text-text-muted uppercase tracking-widest mb-0.5">Currently Executing</div>
                            <div className="text-[13px] text-text-primary font-bold">{activeTask.task}</div>
                        </div>
                    </div>
                )}

                {/* Task Grid */}
                <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-3">
                    {todoList.map((item, idx) => {
                        const isCompleted = item.status === 'completed';
                        const isExecuting = item.status === 'executing';
                        const isFailed = item.status === 'failed';

                        return (
                            <div 
                                key={idx}
                                className={`
                                    group relative px-4 py-3.5 rounded-xl border transition-all duration-300
                                    ${isCompleted ? 'bg-emerald-500/[0.05] border-emerald-500/20' : 
                                      isExecuting ? 'bg-surface-3 border-accent/40 shadow-md' : 
                                      'bg-surface-1/30 border-border-subtle hover:border-border-default'}
                                `}
                            >
                                <div className="flex items-start gap-3">
                                    <div className="mt-0.5">
                                        {isCompleted ? (
                                            <CheckCircle2 size={16} className="text-emerald-500" />
                                        ) : isExecuting ? (
                                            <Loader2 size={16} className="text-accent animate-spin" />
                                        ) : isFailed ? (
                                            <ShieldCheck size={16} className="text-rose-500" />
                                        ) : (
                                            <Circle size={16} className="text-text-muted group-hover:text-text-secondary transition-colors" />
                                        )}
                                    </div>
                                    <div className="flex-1">
                                        <div className={`text-[13px] font-medium transition-colors ${isCompleted ? 'text-text-muted line-through' : isExecuting ? 'text-accent font-bold' : 'text-text-secondary group-hover:text-text-primary'}`}>
                                            {item.task}
                                        </div>
                                        {item.description && (
                                            <p className={`text-[11px] mt-1 line-clamp-1 group-hover:line-clamp-none transition-all ${isFailed ? 'text-rose-500/80' : 'text-text-muted'}`}>
                                                {item.description}
                                            </p>
                                        )}
                                        <TaskChips files={item.files} apis={item.api} />
                                        {isFailed && (item as any).error && (
                                            <p className="text-[10px] text-rose-500 mt-2 font-mono bg-rose-500/10 p-2 rounded border border-rose-500/20 whitespace-pre-wrap">
                                                {(item as any).error}
                                            </p>
                                        )}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* Footer Info */}
                <div className="px-6 py-3 bg-surface-1/40 border-t border-border-subtle flex items-center justify-between">
                    <div className="flex items-center gap-2 text-[10px] font-bold text-text-muted uppercase tracking-[0.1em]">
                        <ShieldCheck size={12} className="text-accent" />
                        Isolated Docker Environment • Secure
                    </div>
                    <div className="text-[10px] font-bold text-text-muted uppercase">
                        {completedCount} / {todoList.length} Tasks Verified
                    </div>
                </div>
            </div>
        </div>
    );
}

