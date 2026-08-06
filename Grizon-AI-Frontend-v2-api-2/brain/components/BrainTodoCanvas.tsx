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
        <div className="w-full mt-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
            <div className="bg-[#0a0a0a] border border-white/[0.08] rounded-2xl overflow-hidden shadow-[0_20px_50px_rgba(0,0,0,0.5)]">
                
                {/* Dashboard Header */}
                <div className="px-6 py-5 bg-white/[0.02] border-b border-white/10 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-white/5 rounded-lg border border-white/10">
                            <Terminal size={18} className="text-white/70" />
                        </div>
                        <div>
                            <h3 className="text-[14px] font-bold text-white/90 tracking-tight uppercase">Execution Pipeline</h3>
                            <p className="text-[11px] text-white/40 font-medium uppercase tracking-[0.05em]">Mission Control • Build v1.0</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-4">
                        <div className="text-right">
                            <div className="text-[18px] font-bold text-white/90 tabular-nums">{completedCount} of {todoList.length} Done</div>
                            <div className="text-[10px] text-white/30 font-bold uppercase tracking-wider">Pipeline Progress</div>
                        </div>
                        <div className="w-24 h-1.5 bg-white/5 rounded-full overflow-hidden border border-white/10">
                            <div 
                                className="h-full bg-white transition-all duration-1000 ease-out shadow-[0_0_10px_rgba(255,255,255,0.3)]" 
                                style={{ width: `${progress}%` }}
                            />
                        </div>
                    </div>
                </div>

                {/* Active Task Highlight */}
                {activeTask && (
                    <div className="px-6 py-4 bg-white/[0.03] border-b border-white/5 flex items-center gap-4">
                        <div className="relative">
                            <div className="absolute inset-0 bg-white/20 rounded-full animate-ping" />
                            <PlayCircle size={20} className="relative text-white z-10" />
                        </div>
                        <div className="flex-1">
                            <div className="text-[10px] font-bold text-white/40 uppercase tracking-widest mb-0.5">Currently Executing</div>
                            <div className="text-[13px] text-white/90 font-medium">{activeTask.task}</div>
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
                                    ${isCompleted ? 'bg-emerald-500/[0.03] border-emerald-500/20' : 
                                      isExecuting ? 'bg-white/[0.05] border-white/20 shadow-[0_0_15px_rgba(255,255,255,0.05)]' : 
                                      'bg-white/[0.01] border-white/[0.05] hover:border-white/10'}
                                `}
                            >
                                <div className="flex items-start gap-3">
                                    <div className="mt-0.5">
                                        {isCompleted ? (
                                            <CheckCircle2 size={16} className="text-emerald-400" />
                                        ) : isExecuting ? (
                                            <Loader2 size={16} className="text-white animate-spin" />
                                        ) : isFailed ? (
                                            <ShieldCheck size={16} className="text-rose-400" />
                                        ) : (
                                            <Circle size={16} className="text-white/20 group-hover:text-white/40 transition-colors" />
                                        )}
                                    </div>
                                    <div className="flex-1">
                                        <div className={`text-[13px] font-medium transition-colors ${isCompleted ? 'text-white/20 line-through decoration-white/10' : isExecuting ? 'text-white' : 'text-white/50 group-hover:text-white/70'}`}>
                                            {item.task}
                                        </div>
                                        {item.description && (
                                            <p className={`text-[11px] mt-1 line-clamp-1 group-hover:line-clamp-none transition-all ${isFailed ? 'text-rose-400/50' : 'text-white/20'}`}>
                                                {item.description}
                                            </p>
                                        )}
                                        <TaskChips files={item.files} apis={item.api} />
                                        {isFailed && (item as any).error && (
                                            <p className="text-[10px] text-rose-400 mt-2 font-mono bg-rose-500/10 p-2 rounded border border-rose-500/20 whitespace-pre-wrap">
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
                <div className="px-6 py-3 bg-white/[0.01] border-t border-white/[0.05] flex items-center justify-between">
                    <div className="flex items-center gap-2 text-[10px] font-bold text-white/20 uppercase tracking-[0.1em]">
                        <ShieldCheck size={12} />
                        Isolated Docker Environment • Secure
                    </div>
                    <div className="text-[10px] font-bold text-white/20 uppercase">
                        {completedCount} / {todoList.length} Tasks Verified
                    </div>
                </div>
            </div>
        </div>
    );
}
