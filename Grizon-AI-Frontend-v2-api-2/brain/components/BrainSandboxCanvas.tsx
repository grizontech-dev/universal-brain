'use client';

import { useState, useEffect, useRef } from 'react';
import { X, Terminal, Activity, CheckCircle2, AlertCircle, Loader2, Play, Hash, Code, ListChecks, Zap } from 'lucide-react';

interface SandboxLog {
    source: string;
    line: string;
    timestamp: number;
}

interface SandboxJobSummary {
    cost_usd?: number;
    num_turns?: number;
    features?: number;
    elapsed_s?: number;
}

interface BrainSandboxCanvasProps {
    streamUrl: string;
    jobId: string;
    onClose: () => void;
    todoList?: any[];
}

export default function BrainSandboxCanvas({ streamUrl, jobId, onClose, todoList }: BrainSandboxCanvasProps) {
    const [status, setStatus] = useState<string>('connecting');
    const [logs, setLogs] = useState<SandboxLog[]>([]);
    const [summary, setSummary] = useState<SandboxJobSummary | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [isDone, setIsDone] = useState(false);
    const [localTodoList, setLocalTodoList] = useState<any[]>(todoList || []);
    const [showTasks, setShowTasks] = useState(true);
    
    // Update local todo list when props change
    useEffect(() => {
        if (todoList && todoList.length > 0) {
            setLocalTodoList(todoList);
        }
    }, [todoList]);

    const activeTask = localTodoList.find(t => t.status === 'executing' || t.status === 'running' || t.status === 'pending_confirmation');
    const completedTasksCount = localTodoList.filter(t => t.status === 'completed').length;
    
    const logsEndRef = useRef<HTMLDivElement>(null);
    const wsRef = useRef<WebSocket | null>(null);
    const lastJobIdRef = useRef<string | null>(null);
    const isDoneRef = useRef(false);
    const isConnectingRef = useRef(false);

    // Sync isDone state with ref for handlers
    useEffect(() => {
        isDoneRef.current = isDone;
    }, [isDone]);

    useEffect(() => {
        if (!streamUrl || !jobId) return;

        // Prevent redundant reconnections if already connected OR currently connecting
        if (lastJobIdRef.current === jobId && (wsRef.current?.readyState === WebSocket.OPEN || wsRef.current?.readyState === WebSocket.CONNECTING || isConnectingRef.current)) {
            return;
        }
        
        lastJobIdRef.current = jobId;
        isDoneRef.current = false;
        setIsDone(false); // Reset state for new job
        
        let retryCount = 0;
        const maxRetries = 5;

        const connect = (url: string) => {
            if (isDoneRef.current || isConnectingRef.current) return;
            isConnectingRef.current = true;

            
            const baseWsUrl = url.startsWith('http') ? url.replace(/^http/, 'ws') : url;
            
            // If we've already tried and failed on a specific port, we'll try both 8080 and 8081 in parallel
            // to find the working one instantly.
            const ports = [8080, 8081];
            const urlsToTry = ports.map(port => {
                if (baseWsUrl.includes(':8080')) return baseWsUrl.replace(':8080', `:${port}`);
                if (baseWsUrl.includes(':8081')) return baseWsUrl.replace(':8081', `:${port}`);
                return baseWsUrl;
            });

            // Keep track of active probes
            const probes: WebSocket[] = [];
            let resolved = false;

            urlsToTry.forEach((targetUrl) => {
                console.log(`Probing sandbox stream: ${targetUrl}`);
                const ws = new WebSocket(targetUrl);
                probes.push(ws);

                ws.onopen = () => {
                    if (resolved) {
                        ws.close();
                        return;
                    }
                    resolved = true;
                    isConnectingRef.current = false;
                    console.log(`Successfully connected to sandbox on: ${targetUrl}`);

                    wsRef.current = ws;
                    setStatus('connected');
                    setError(null);
                    retryCount = 0;
                    
                    // Close all other probes
                    probes.forEach(p => { if (p !== ws) p.close(); });
                    
                    // Set up the real handlers for the winner
                    setupHandlers(ws, targetUrl);
                };

                ws.onerror = () => {
                    if (!resolved) ws.close();
                };
            });

            // Timeout if no probe succeeds in 5s
            setTimeout(() => {
                if (!resolved) {
                    isConnectingRef.current = false;
                    probes.forEach(p => p.close());
                    if (retryCount < maxRetries && !isDoneRef.current) {
                        retryCount++;
                        const delay = Math.min(1000 * Math.pow(2, retryCount), 10000);
                        setTimeout(() => connect(url), delay);
                    }
                }
            }, 5000);
        };

        const setupHandlers = (ws: WebSocket, originalUrl: string) => {
            ws.onmessage = (event) => {
                if (isDoneRef.current) return;
                try {
                    const frame = JSON.parse(event.data);
                    console.log(`Sandbox frame received: ${frame.type}`, frame.data);
                    
                    switch (frame.type) {
                        case "status":
                            setStatus(frame.data.status);
                            break;
                        case "log":
                            // Check for internal agent errors like rate limits
                            if (frame.data.line && frame.data.line.includes('"error":"rate_limit"')) {
                                setError("Internal Sandbox Agent (Claude) is currently rate-limited. Please try again in a few minutes.");
                            }
                            const newLog = {
                                source: frame.data.source,
                                line: frame.data.line,
                                timestamp: Date.now()
                            };
                            setLogs(prev => [...prev.slice(-499), newLog]);
                            break;

                        case "summary":
                            setSummary(frame.data);
                            break;
                        case "error":
                            const rawData = typeof frame.data === 'string' ? frame.data : JSON.stringify(frame.data);
                            let errorMsg = typeof frame.data === 'string' 
                                ? frame.data 
                                : (frame.data.message || rawData);
                            
                            if (rawData.includes("authentication_failed")) {
                                errorMsg = "❌ API Key Authentication Failed. Please verify your ANTHROPIC_API_KEY in Grizon-AI-Backend/.env and restart the service.";
                            }
                            
                            setError(errorMsg);
                            console.error("Sandbox reported error:", frame.data);
                            break;

                        case "done":
                            setStatus(frame.data.outcome);
                            if (frame.data.outcome === 'failed') {
                                setError(frame.data.outcome_summary || frame.data.outcome_description || "Sandbox job failed execution.");
                            }
                            setIsDone(true);
                            // Cleanup on completion
                            lastJobIdRef.current = null; 
                            break;

                    }
                } catch (e) {
                    console.error("Failed to parse sandbox frame:", e);
                }
            };
        };

        const handleProgress = (e: any) => {
            const data = e.detail || {};
            if (data.progressMsg) {
                const msg = String(data.progressMsg);
                
                // Add to logs if it's a command or output
                if (msg.startsWith('[COMMAND]') || msg.startsWith('[OUTPUT]')) {
                    const source = msg.startsWith('[COMMAND]') ? 'SHELL' : 'OUTPUT';
                    const line = msg.replace(/^\[COMMAND\]\s*/, '').replace(/^\[OUTPUT\]\s*/, '');
                    
                    const newLog = {
                        source,
                        line,
                        timestamp: Date.now()
                    };
                    setLogs(prev => [...prev.slice(-499), newLog]);
                }
                
                // Update task status if it's a progress marker
                if (msg.includes('[TASK_PROGRESS]')) {
                    const parts = msg.replace('[TASK_PROGRESS]', '').trim().split(':');
                    const taskTitle = parts[0]?.trim();
                    const taskStatus = parts[1]?.trim()?.toLowerCase();
                    
                    if (taskTitle && taskStatus) {
                        setLocalTodoList(prev => prev.map(t => {
                            if (t.task === taskTitle || t.title === taskTitle) {
                                return { ...t, status: taskStatus === 'success' ? 'completed' : 'failed' };
                            }
                            return t;
                        }));
                    }
                }
            }
            if (data.todoList) {
                setLocalTodoList(data.todoList);
            }
        };

        window.addEventListener('updateSandboxProgress', handleProgress);
        connect(streamUrl);

        return () => {
            window.removeEventListener('updateSandboxProgress', handleProgress);
            if (wsRef.current) {
                console.log("Cleaning up sandbox WebSocket...");
                wsRef.current.close();
            }
        };
    }, [streamUrl, jobId]);


    useEffect(() => {
        logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [logs]);

    const getStatusColor = () => {
        if (error) return 'text-red-400';
        if (isDone) return status === 'succeeded' ? 'text-[#00e696]' : 'text-red-400';
        return 'text-[#976df8]';
    };

    return (
        <div className="fixed inset-y-4 right-4 w-[450px] bg-[#0a0a0a] border border-white/10 rounded-2xl shadow-2xl z-[60] flex flex-col overflow-hidden animate-in slide-in-from-right-4 duration-300">
            {/* Header */}
            <div className="h-14 border-b border-white/5 flex items-center justify-between px-5 bg-white/[0.03] backdrop-blur-sm relative overflow-hidden shrink-0">
                <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-[#976df8]/50 to-transparent" />
                
                <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-[#976df8]/20 flex items-center justify-center text-[#976df8] shadow-[0_0_15px_rgba(151,109,248,0.2)]">
                        <Terminal size={16} />
                    </div>
                    <div>
                        <h2 className="text-[11px] font-bold text-white uppercase tracking-wider">Neural Sandbox</h2>
                        <div className="flex items-center gap-1.5 mt-0.5">
                            <div className={`w-1.5 h-1.5 rounded-full ${isDone ? 'bg-[#00e696]' : 'bg-[#976df8] animate-pulse shadow-[0_0_8px_rgba(151,109,248,0.8)]'}`} />
                            <span className={`text-[8px] font-bold uppercase tracking-widest ${getStatusColor()}`}>
                                {isDone ? 'Finished' : 'Live Session'}
                            </span>
                        </div>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <button 
                        onClick={() => setShowTasks(!showTasks)}
                        className={`p-1.5 rounded-lg transition-all ${showTasks ? 'bg-[#976df8]/20 text-[#976df8]' : 'text-white/40 hover:bg-white/10'}`}
                        title="Toggle Tasks"
                    >
                        <ListChecks size={18} />
                    </button>
                    <button onClick={onClose} className="p-1.5 hover:bg-white/10 rounded-lg text-white/40 hover:text-white transition-all">
                        <X size={18} />
                    </button>
                </div>
            </div>

            {/* Todo List Panel */}
            {showTasks && localTodoList.length > 0 && (
                <div className="border-b border-white/5 bg-black/40 backdrop-blur-md max-h-[180px] overflow-hidden flex flex-col animate-in slide-in-from-top duration-300">
                    <div className="px-5 py-3 flex items-center justify-between bg-white/[0.02]">
                        <div className="flex items-center gap-2">
                            <Activity size={14} className="text-[#976df8]" />
                            <span className="text-[10px] font-bold text-white/70 uppercase tracking-widest">
                                Roadmap Progress ({completedTasksCount}/{localTodoList.length})
                            </span>
                        </div>
                        {activeTask && (
                            <div className="flex items-center gap-2 px-2 py-0.5 rounded-full bg-[#976df8]/10 border border-[#976df8]/20">
                                <Loader2 size={10} className="text-[#976df8] animate-spin" />
                                <span className="text-[9px] font-bold text-[#976df8] uppercase">Executing</span>
                            </div>
                        )}
                    </div>
                    
                    <div className="flex-1 overflow-y-auto px-5 py-2 space-y-2 custom-scrollbar">
                        {localTodoList.map((task, idx) => {
                            const isExecuting = task.status === 'executing' || task.status === 'running' || task.status === 'pending_confirmation';
                            const isCompleted = task.status === 'completed';
                            
                            return (
                                <div 
                                    key={idx} 
                                    className={`flex items-center gap-3 p-2 rounded-lg transition-all ${isExecuting ? 'bg-[#976df8]/10 border border-[#976df8]/20' : 'bg-transparent'}`}
                                >
                                    <div className="shrink-0">
                                        {isCompleted ? (
                                            <CheckCircle2 size={14} className="text-[#00e696]" />
                                        ) : isExecuting ? (
                                            <Loader2 size={14} className="text-[#976df8] animate-spin" />
                                        ) : (
                                            <div className="w-3.5 h-3.5 rounded-full border border-white/20" />
                                        )}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <div className={`text-[11px] truncate ${isCompleted ? 'text-white/40 line-through' : isExecuting ? 'text-white font-bold' : 'text-white/70'}`}>
                                            {task.task}
                                        </div>
                                        {isExecuting && (
                                            <div className="text-[9px] text-[#976df8]/70 mt-0.5 animate-pulse italic">
                                                Task in progress...
                                            </div>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Stats Bar (if done) */}
            {summary && (
                <div className="p-4 bg-[#00e696]/5 border-b border-[#00e696]/10 grid grid-cols-2 gap-3 animate-in fade-in duration-500">
                    <div className="flex items-center gap-2">
                        <Zap size={14} className="text-[#00e696]" />
                        <span className="text-[11px] text-white/60">Cost: <span className="text-white font-mono">${summary.cost_usd?.toFixed(3)}</span></span>
                    </div>
                    <div className="flex items-center gap-2">
                        <RotateCw size={14} className="text-[#00e696]" />
                        <span className="text-[11px] text-white/60">Turns: <span className="text-white font-mono">{summary.num_turns}</span></span>
                    </div>
                </div>
            )}

            {/* Log Terminal */}
            <div className="flex-1 overflow-y-auto p-5 font-mono text-[11px] custom-scrollbar bg-black/60 relative">
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(151,109,248,0.03),transparent_70%)] pointer-events-none" />
                
                <div className="space-y-1.5 relative z-1">
                    <div className="flex items-center gap-2 text-white/20 pb-3 border-b border-white/5 mb-3">
                        <Activity size={12} />
                        <span className="uppercase tracking-[0.2em] font-bold text-[9px]">Initializing remote session: {jobId.slice(0, 8)}...</span>
                    </div>
                    
                    {logs.map((log, i) => (
                        <div key={i} className="flex gap-4 group/log animate-in fade-in slide-in-from-left-1 duration-200">
                            <span className="w-16 shrink-0 text-white/10 text-right uppercase tracking-tighter font-bold group-hover/log:text-white/20 transition-colors">{log.source}</span>
                            <span className="text-white/70 break-words flex-1 leading-relaxed selection:bg-[#976df8]/30">{log.line}</span>
                        </div>
                    ))}
                    
                    {error && (
                        <div className="flex items-start gap-3 p-4 mt-6 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 animate-in shake duration-500">
                            <AlertCircle size={16} className="shrink-0 mt-0.5" />
                            <div className="text-[12px] leading-relaxed font-medium">{error}</div>
                        </div>
                    )}
                    
                    <div ref={logsEndRef} className="h-4" />
                </div>
            </div>

            {/* Footer Status */}
            <div className="p-4 bg-white/[0.02] border-t border-white/5">
                <div className="flex flex-col gap-3">
                    <div className="flex items-center justify-between text-[11px]">
                        <span className="text-white/40 uppercase tracking-widest font-bold">Progress</span>
                        <span className="text-white/60">{isDone ? '100%' : 'Executing...'}</span>
                    </div>
                    <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                        <div 
                            className={`h-full transition-all duration-1000 ${isDone ? 'bg-[#00e696] w-full' : 'bg-[#976df8] animate-pulse w-2/3'}`} 
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}

// Minimal RotateCw icon since lucide-react RotateCw is not imported
function RotateCw({ size, className }: { size: number, className?: string }) {
    return (
        <svg 
            xmlns="http://www.w3.org/2000/svg" 
            width={size} 
            height={size} 
            viewBox="0 0 24 24" 
            fill="none" 
            stroke="currentColor" 
            strokeWidth="2" 
            strokeLinecap="round" 
            strokeLinejoin="round" 
            className={className}
        >
            <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/>
            <path d="M21 3v5h-5"/>
        </svg>
    );
}
