'use client';

import React, { useState, useEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import { Terminal as TerminalIcon, X, Maximize2, Minimize2, ChevronRight, Square, Sparkles } from 'lucide-react';

interface TerminalPanelProps {
    stdout?: string;
    stderr?: string;
    systemOutput?: string;
    status?: string;
    onClose?: () => void;
    stdin?: string;
    onStdinChange?: (v: string) => void;
    onRun?: () => void;
    onFixWithAI?: () => void;
}

export interface TerminalHandle {
    clear: () => void;
    appendSystem: (msg: string) => void;
    clearSystem: () => void;
}

const TerminalPanel = forwardRef<TerminalHandle, TerminalPanelProps>(({ 
    stdout, 
    stderr, 
    systemOutput, 
    status,
    onClose,
    stdin,
    onStdinChange,
    onRun,
    onFixWithAI
}, ref) => {
    const [isMaximized, setIsMaximized] = useState(false);
    const [panelHeight, setPanelHeight] = useState(320);
    const [logs, setLogs] = useState<{type: 'out' | 'err' | 'sys', text: string}[]>([]);
    const scrollRef = useRef<HTMLDivElement>(null);
    const isResizing = useRef(false);

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            onRun?.();
        }
    };

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [stdout, logs, status]);

    // Draggable Resizer Logic
    const startResizing = (e: React.MouseEvent) => {
        isResizing.current = true;
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', stopResizing);
    };

    const stopResizing = () => {
        isResizing.current = false;
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', stopResizing);
    };

    const handleMouseMove = (e: MouseEvent) => {
        if (!isResizing.current) return;
        const newHeight = window.innerHeight - e.clientY - 20;
        if (newHeight > 100 && newHeight < window.innerHeight - 200) {
            setPanelHeight(newHeight);
        }
    };

    // Expose API via ref
    useImperativeHandle(ref, () => ({
        clear: () => setLogs([]),
        appendSystem: (msg: string) => setLogs(prev => [...prev, { type: 'sys', text: msg }]),
        clearSystem: () => setLogs(prev => prev.filter(l => l.type !== 'sys'))
    }));

    // Auto-scroll on new output
    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [stdout, stderr, systemOutput, logs]);

    return (
        <div 
            className={`flex flex-col bg-[#0d0c14] border-t border-white/10 transition-all duration-300 ease-in-out relative ${isMaximized ? 'h-full absolute inset-0 z-50' : ''}`}
            style={!isMaximized ? { height: panelHeight } : {}}
        >
            {/* Top Resizer Handle */}
            {!isMaximized && (
                <div 
                    onMouseDown={startResizing}
                    className="absolute -top-1 inset-x-0 h-2 cursor-ns-resize z-20 flex items-center justify-center hover:bg-emerald-500/10 transition-colors"
                >
                    <div className="w-16 h-1 bg-white/5 group-hover:bg-emerald-500/40 rounded-full" />
                </div>
            )}

            {/* Terminal Header */}
            <div className="h-12 px-6 flex items-center justify-between border-b border-white/[0.05] bg-black/40 shrink-0">
                <div className="flex items-center gap-3">
                    <TerminalIcon size={16} className="text-emerald-400" />
                    <span className="text-[11px] font-black uppercase tracking-[0.2em] text-white/60">Live Debug Terminal</span>
                    {status === 'running' && (
                        <div className="flex items-center gap-2 ml-4 px-3 py-1 rounded-full bg-yellow-400/10 border border-yellow-400/20">
                            <span className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse shadow-[0_0_8px_rgba(250,204,21,0.5)]" />
                            <span className="text-[9px] font-black text-yellow-400 uppercase tracking-widest">Process Active</span>
                        </div>
                    )}
                </div>
                <div className="flex items-center gap-1">
                    <button 
                        onClick={() => setIsMaximized(!isMaximized)}
                        className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-white/5 text-white/20 hover:text-white transition-all outline-none"
                    >
                        {isMaximized ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                    </button>
                    {onClose && (
                        <button onClick={onClose} className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-red-500/10 text-white/20 hover:text-red-400 transition-all outline-none">
                            <X size={18} />
                        </button>
                    )}
                </div>
            </div>

            {/* Terminal Body */}
            <div 
                ref={scrollRef}
                onClick={() => {
                    const el = document.getElementById('terminal-input');
                    el?.focus();
                }}
                className="flex-1 overflow-y-auto p-8 font-mono text-[13px] leading-relaxed custom-scrollbar bg-black/60 shadow-inner scroll-smooth cursor-text"
            >
                {/* System Initial Message */}
                <div className="flex gap-3 text-white/30 mb-6 border-b border-white/[0.03] pb-4 select-none">
                    <span className="shrink-0 text-emerald-400">grizon@cloud:~$</span>
                    <span className="font-bold">System initialized. Connected to [grizon-runner-v2].</span>
                </div>

                {/* Logs & Output List */}
                <div className="space-y-2">
                    {logs.map((log, i) => (
                        <div key={i} className={`flex gap-3 animate-in slide-in-from-left-2 duration-300 ${log.type === 'err' ? 'text-red-400' : log.type === 'sys' ? 'text-blue-400' : 'text-white/90'}`}>
                            <span className="shrink-0 opacity-20 select-none">{log.type === 'sys' ? '<i>' : '>'}</span>
                            <span className="whitespace-pre-wrap">{log.text}</span>
                        </div>
                    ))}

                    {stdout && (
                        <div className="flex gap-3 text-emerald-400">
                            <span className="shrink-0 opacity-40 select-none">$</span>
                            <span className="whitespace-pre-wrap font-medium">{stdout}</span>
                        </div>
                    )}
                </div>

                {stderr && (
                    <div className="mt-4 animate-in zoom-in-95 duration-200">
                        <div className="flex gap-3 text-red-100 p-5 rounded-t-2xl bg-red-500/10 border border-red-500/20 border-b-0 shadow-xl font-bold">
                            <Square size={14} className="shrink-0 mt-1 fill-red-500/40 text-red-400" />
                            <span className="whitespace-pre-wrap select-all">{stderr}</span>
                        </div>
                        <button 
                            onClick={onFixWithAI}
                            className="w-full py-3 rounded-b-2xl bg-gradient-to-r from-red-500/20 to-amber-500/20 hover:from-red-500/30 hover:to-amber-500/30 border border-red-500/20 border-t-white/5 flex items-center justify-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-white/80 hover:text-white transition-all active:scale-[0.98]"
                        >
                            <Sparkles size={14} className="text-amber-400 animate-pulse" />
                            <span>Fix with AI</span>
                        </button>
                    </div>
                )}

                {/* Seamless VS Code Command Prompt */}
                <div className="flex items-start gap-3 mt-8 pb-10 group relative border-t border-white/5 pt-6">
                    <div className="flex items-center gap-2 mt-1.5 shrink-0 select-none">
                         <span className="text-emerald-400 font-black text-xs leading-none">{'>'}</span>
                        <span className="text-emerald-400/80 font-black text-[10px] tracking-[0.1em] uppercase">Grizon@Cloud:~$</span>
                    </div>
                    <div className="relative flex-1">
                        <textarea
                            id="terminal-input"
                            autoFocus
                            value={stdin || ''}
                            onChange={(e) => onStdinChange?.(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder="Enter command or input here..."
                            rows={1}
                            className="w-full bg-transparent border-none outline-none text-white font-mono text-[13px] font-medium resize-none placeholder:text-white/30 placeholder:font-bold transition-all mt-0.5 relative z-10"
                        />
                        {!stdin && (
                            <div className="absolute left-0 top-1.5 w-2 h-4 bg-emerald-400 shadow-[0_0_15px_rgba(52,211,153,0.6)] animate-[blink_1s_infinite] pointer-events-none" />
                        )}
                    </div>
                    
                    {/* Floating Status Indicator */}
                    <div className="fixed bottom-12 right-12 px-4 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center gap-2.5 shadow-[0_0_30px_rgba(16,185,129,0.1)] backdrop-blur-xl animate-in fade-in zoom-in duration-700">
                        <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)] animate-pulse" />
                        <span className="text-[8px] font-black text-emerald-400 uppercase tracking-[0.2em]">{status === 'running' ? 'Executing Environment' : 'Terminal Ready'}</span>
                    </div>
                </div>
            </div>

            <style jsx>{`
                .custom-scrollbar::-webkit-scrollbar {
                    width: 6px;
                }
                .custom-scrollbar::-webkit-scrollbar-track {
                    background: transparent;
                }
                .custom-scrollbar::-webkit-scrollbar-thumb {
                    background: rgba(255, 255, 255, 0.1);
                    border-radius: 10px;
                }
                .custom-scrollbar::-webkit-scrollbar-thumb:hover {
                    background: rgba(255, 255, 255, 0.2);
                }
                @keyframes blink {
                    0%, 100% { opacity: 1; }
                    50% { opacity: 0; }
                }
            `}</style>

            <style jsx>{`
                @keyframes blink {
                    0%, 100% { opacity: 1; }
                    50% { opacity: 0; }
                }
            `}</style>

            <style jsx>{`
                @keyframes blink {
                    0%, 100% { opacity: 1; }
                    50% { opacity: 0; }
                }
            `}</style>
        </div>
    );
});

TerminalPanel.displayName = 'TerminalPanel';

export default TerminalPanel;
