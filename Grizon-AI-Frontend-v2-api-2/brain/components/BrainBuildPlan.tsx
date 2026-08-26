'use client';

import React, { useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    CheckCircle2, Circle, Loader2, AlertTriangle, Zap,
    Cpu, FileCode2, Clock, Boxes, Layers,
} from 'lucide-react';
import type { BuildTodoItem } from '../lib/buildActivity';
import { normalizeTodoStatus, isBuildTodosComplete } from '../lib/buildActivity';
import { useExecutionStore } from '../store/execution-store';

interface BrainBuildPlanProps {
    todos: BuildTodoItem[];
    isSyncing?: boolean;
    workedSeconds?: number;
}

function StatusIcon({ status }: { status?: string }) {
    const s = normalizeTodoStatus(status);
    if (s === 'completed') return <CheckCircle2 size={16} className="text-success shrink-0" />;
    if (s === 'failed') return <AlertTriangle size={16} className="text-danger shrink-0" />;
    if (s === 'executing') return <Loader2 size={16} className="text-accent animate-spin shrink-0" />;
    return <Circle size={16} className="text-text-faint shrink-0" />;
}

function StatusLabel({ status }: { status?: string }) {
    const s = normalizeTodoStatus(status);
    if (s === 'completed') return <span className="text-success">Done</span>;
    if (s === 'failed') return <span className="text-danger">Failed</span>;
    if (s === 'executing') return <span className="text-accent">Running…</span>;
    return <span className="text-text-faint">Queued</span>;
}

function TodoChips({ todo }: { todo: BuildTodoItem }) {
    const files = (todo.files || []).filter(Boolean).slice(0, 3);
    const apis = (todo.api || []).filter(Boolean).slice(0, 2);
    const extraFiles = (todo.files || []).length - files.length;

    if (files.length === 0 && apis.length === 0) return null;

    return (
        <div className="flex flex-wrap items-center gap-1.5 mt-2">
            {files.map((f, i) => (
                <span
                    key={`f-${i}`}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-surface-2 border border-border-subtle text-[10px] font-mono text-text-muted"
                >
                    <FileCode2 size={9} className="shrink-0" />
                    {f.split('/').pop()}
                </span>
            ))}
            {extraFiles > 0 && (
                <span className="text-[10px] text-text-muted/70 font-mono">+{extraFiles}</span>
            )}
            {apis.map((a, i) => (
                <span
                    key={`a-${i}`}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-accent/10 border border-accent/20 text-[10px] font-mono text-accent"
                >
                    <Zap size={9} className="shrink-0" />
                    {a}
                </span>
            ))}
        </div>
    );
}

export default function BrainBuildPlan({ todos, isSyncing = false, workedSeconds }: BrainBuildPlanProps) {
    const isStopped = useExecutionStore((s) => s.isStopped);
    const doneCount = todos.filter((t) => {
        const s = normalizeTodoStatus(t.status);
        return s === 'completed' || s === 'failed';
    }).length;
    const failedCount = todos.filter((t) => normalizeTodoStatus(t.status) === 'failed').length;
    const executingCount = todos.filter((t) => normalizeTodoStatus(t.status) === 'executing').length;
    const progress = todos.length ? Math.round((doneCount / todos.length) * 100) : 0;
    const complete = isBuildTodosComplete(todos);

    const runningIndex = useMemo(() => {
        const idx = todos.findIndex((t) => normalizeTodoStatus(t.status) === 'executing');
        return idx >= 0 ? idx : -1;
    }, [todos]);

    const listRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (runningIndex < 0) return;
        const el = listRef.current?.children[runningIndex] as HTMLElement | undefined;
        el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, [runningIndex]);

    return (
        <aside className="hidden lg:flex lg:w-[21%] min-w-[240px] max-w-[320px] shrink-0 flex-col bg-surface-1 border-r border-border-subtle relative overflow-hidden">
            {/* Header */}
            <div className="shrink-0 px-4 py-3.5 border-b border-border-subtle bg-sidebar/40 backdrop-blur-md sticky top-0 z-20">
                <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-lg bg-accent/15 border border-accent/25 flex items-center justify-center">
                            <Cpu size={12} className="text-accent" />
                        </div>
                        <h3 className="text-[11px] font-black uppercase tracking-widest text-text-secondary">
                            Build Plan
                        </h3>
                    </div>
                    {!complete && !isStopped && (executingCount > 0 || isSyncing) && (
                        <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-accent">
                            <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
                            Live
                        </span>
                    )}
                    {isStopped && !complete && (
                        <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-red-400">
                            <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
                            Interrupted
                        </span>
                    )}
                    {complete && (
                        <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-success">
                            <CheckCircle2 size={11} />
                            Complete
                        </span>
                    )}
                </div>

                {/* Progress */}
                <div className="flex items-center gap-2 mt-2">
                    <div className="flex-1 h-1.5 bg-surface-3 rounded-full overflow-hidden border border-border-subtle">
                        <motion.div
                            className="h-full bg-gradient-to-r from-[#6219d6] via-[#7423ec] to-[#976df8] rounded-full"
                            initial={{ width: 0 }}
                            animate={{ width: `${progress}%` }}
                            transition={{ duration: 0.5, ease: 'easeOut' }}
                        />
                    </div>
                    <span className="text-[11px] font-black text-text-primary tabular-nums">
                        {doneCount}/{todos.length}
                    </span>
                </div>

                {failedCount > 0 && (
                    <p className="mt-2 flex items-center gap-1.5 text-[10px] text-danger font-semibold">
                        <AlertTriangle size={10} /> {failedCount} task{failedCount > 1 ? 's' : ''} failed
                    </p>
                )}
                {workedSeconds !== undefined && workedSeconds > 0 && !complete && (
                    <p className="mt-2 flex items-center gap-1.5 text-[10px] text-text-muted font-medium">
                        <Clock size={10} className={isStopped ? 'text-red-400' : 'text-accent'} />
                        {isStopped ? `Interrupted after ${Math.max(1, workedSeconds)}s` : `Working for ${Math.max(1, workedSeconds)}s`}
                    </p>
                )}
            </div>

            {/* Task list */}
            <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar py-2 px-2">
                {todos.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center gap-3 px-4 text-center">
                        <div className="w-10 h-10 rounded-2xl bg-surface-2 border border-border-subtle flex items-center justify-center">
                            <Boxes size={18} className="text-text-faint" />
                        </div>
                        <p className="text-[12px] text-text-muted leading-relaxed">
                            No tasks yet.<br />
                            The AI is analyzing your request and will build a step-by-step plan here.
                        </p>
                        {isSyncing && (
                            <div className="flex items-center gap-2 text-[10px] text-accent">
                                <Loader2 size={12} className="animate-spin" />
                                Planning…
                            </div>
                        )}
                    </div>
                ) : (
                    <div ref={listRef} className="relative space-y-1.5">
                        {todos.map((todo, i) => {
                            let s = normalizeTodoStatus(todo.status);
                            // Override executing status when stopped
                            if (isStopped && s === 'executing') s = 'pending' as any;
                            const isRunning = s === 'executing';
                            const isDone = s === 'completed';
                            const isFailed = s === 'failed';
                            const title = todo.title || todo.task || 'Untitled task';
                            const category = todo.category
                                ? String(todo.category).charAt(0).toUpperCase() + String(todo.category).slice(1)
                                : undefined;

                            return (
                                <AnimatePresence key={todo.id || `t-${i}`}>
                                    <motion.div
                                        layout
                                        initial={{ opacity: 0, x: -8 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        exit={{ opacity: 0, scale: 0.97 }}
                                        transition={{ duration: 0.25 }}
                                        className={`relative flex items-start gap-2.5 rounded-xl border px-3 py-2.5 transition-colors ${
                                            isRunning
                                                ? 'bg-accent/[0.08] border-accent/30 shadow-[0_0_18px_rgba(116,35,236,0.12)]'
                                                : isDone
                                                    ? 'bg-surface-2/40 border-border-subtle'
                                                    : isFailed
                                                        ? 'bg-danger/[0.06] border-danger/25'
                                                        : 'bg-surface-2/20 border-border-subtle'
                                        }`}
                                    >
                                        <div className="relative mt-0.5 shrink-0">
                                            <StatusIcon status={s} />
                                            {isRunning && (
                                                <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-accent animate-ping" />
                                            )}
                                        </div>

                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-start justify-between gap-2">
                                                <span className={`text-[12.5px] leading-snug font-semibold break-words ${
                                                    isDone
                                                        ? 'text-text-muted line-through decoration-text-faint/60'
                                                        : isRunning
                                                            ? 'text-accent'
                                                            : isFailed
                                                                ? 'text-danger'
                                                                : 'text-text-primary'
                                                }`}>
                                                    {title}
                                                </span>
                                                <span className="shrink-0 text-[9px] font-bold uppercase tracking-wider whitespace-nowrap mt-0.5">
                                                    <StatusLabel status={s} />
                                                </span>
                                            </div>

                                            {category && (
                                                <span className="mt-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-surface-2 border border-border-subtle text-[9px] font-bold uppercase tracking-wider text-text-muted">
                                                    <Layers size={8} />
                                                    {category}
                                                </span>
                                            )}

                                            <TodoChips todo={todo} />

                                            {isRunning && (
                                                <div className="mt-2 h-0.5 w-full bg-surface-3 rounded-full overflow-hidden">
                                                    <div className="h-full bg-accent rounded-full animate-[buildProgress_1.2s_ease-in-out_infinite]" />
                                                </div>
                                            )}
                                        </div>
                                    </motion.div>
                                </AnimatePresence>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Footer status */}
            <div className="shrink-0 px-4 py-2.5 border-t border-border-subtle flex items-center justify-between bg-sidebar/40">
                <span className="flex items-center gap-1.5 text-[10px] font-medium text-text-muted">
                    {isStopped && !complete ? (
                        <>
                            <div className="w-2 h-2 rounded-full bg-red-400" />
                            Interrupted
                        </>
                    ) : isSyncing && !complete ? (
                        <>
                            <Loader2 size={10} className="animate-spin text-accent" />
                            Syncing files…
                        </>
                    ) : complete ? (
                        <>
                            <CheckCircle2 size={10} className="text-success" />
                            Build finished
                        </>
                    ) : (
                        <>
                            <Zap size={10} className="text-accent" />
                            Agent active
                        </>
                    )}
                </span>
                {todos.length > 0 && !complete && (
                    <span className="text-[10px] font-black text-text-muted tabular-nums">
                        {progress}%
                    </span>
                )}
            </div>
        </aside>
    );
}