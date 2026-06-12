'use client';

import React, { useMemo } from 'react';
import { Bot, User, Cpu, Code, ClipboardCheck, Layout, Boxes, Search } from 'lucide-react';

interface Activity {
    role: string;
    action: string;
    status: 'completed' | 'running' | 'pending';
    time: string;
    icon: any;
    color: string;
}

export function SquadActivity({ content }: { content: string }) {
    // Detect activity from content (simulated for now, or parsed from the squad logic)
    const activities: Activity[] = useMemo(() => {
        const list: Activity[] = [
            { role: 'Product Manager', action: 'Drafting PRD', status: 'completed', time: '2m ago', icon: ClipboardCheck, color: 'text-blue-400' },
            { role: 'Architect', action: 'System Design', status: 'completed', time: '1m ago', icon: Boxes, color: 'text-purple-400' },
            { role: 'Lead Engineer', action: 'Implementing Core logic', status: 'running', time: 'now', icon: Code, color: 'text-emerald-400' },
        ];

        // If content contains Vite/React markers, add specific activities
        if (content.includes('Vite') || content.includes('React')) {
            list.push({ role: 'Frontend Engineer', action: 'Vite Scaffolding', status: 'completed', time: '30s ago', icon: Layout, color: 'text-pink-400' });
        }
        
        if (content.includes('Search') || content.includes('Tavily')) {
            list.unshift({ role: 'Research Assistant', action: 'Web Search', status: 'completed', time: '5m ago', icon: Search, color: 'text-cyan-400' });
        }

        return list;
    }, [content]);

    return (
        <div className="flex flex-col h-full bg-[#08080c] p-6 gap-6">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-purple-500/10 flex items-center justify-center border border-purple-500/20">
                        <Boxes size={20} className="text-purple-400" />
                    </div>
                    <div>
                        <h3 className="text-[14px] font-bold text-white tracking-wide">Engineering Squad</h3>
                        <p className="text-[11px] text-white/30 uppercase tracking-widest font-medium">MetaGPT Orchestration</p>
                    </div>
                </div>
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="text-[10px] font-black uppercase tracking-widest text-emerald-400">Project Live</span>
                </div>
            </div>

            <div className="grid grid-cols-1 gap-4">
                {activities.map((act, i) => (
                    <div key={i} className="flex items-start gap-4 p-4 rounded-2xl bg-white/[0.02] border border-white/[0.05] hover:bg-white/[0.04] transition-all group">
                        <div className={`w-10 h-10 rounded-xl bg-white/[0.03] flex items-center justify-center border border-white/5 ${act.color}`}>
                            <act.icon size={18} />
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between mb-1">
                                <span className="text-[13px] font-bold text-white/90">{act.role}</span>
                                <span className="text-[10px] font-mono text-white/20">{act.time}</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="text-[12px] text-white/50">{act.action}</span>
                                {act.status === 'running' && (
                                    <div className="flex gap-0.5">
                                        <div className="w-1 h-1 rounded-full bg-emerald-500 animate-bounce [animation-delay:-0.3s]" />
                                        <div className="w-1 h-1 rounded-full bg-emerald-500 animate-bounce [animation-delay:-0.15s]" />
                                        <div className="w-1 h-1 rounded-full bg-emerald-500 animate-bounce" />
                                    </div>
                                )}
                            </div>
                        </div>
                        <div className={`text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-md ${
                            act.status === 'completed' ? 'text-emerald-400/50 bg-emerald-400/5' : 'text-purple-400 bg-purple-400/10'
                        }`}>
                            {act.status}
                        </div>
                    </div>
                ))}
            </div>

            <div className="mt-auto p-4 rounded-2xl bg-purple-500/5 border border-purple-500/10 flex items-center gap-4">
                <div className="w-12 h-12 rounded-full border-2 border-purple-500/20 flex items-center justify-center relative">
                    <div className="absolute inset-0 rounded-full border-t-2 border-purple-500 animate-spin" />
                    <Bot size={20} className="text-purple-400" />
                </div>
                <div className="flex-1">
                    <p className="text-[11px] font-bold text-purple-400 uppercase tracking-[0.2em] mb-1">Squad Insight</p>
                    <p className="text-[12px] text-white/60 leading-relaxed italic">
                        "Architecting a modular React ecosystem with optimized state management and responsive Tailwind primitives."
                    </p>
                </div>
            </div>
        </div>
    );
}
