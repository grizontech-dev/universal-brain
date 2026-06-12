'use client';

import React from 'react';
import { useExecutionStore } from '../store/execution-store';
import { CheckCircle2, Circle, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export default function BrainLiveTodos() {
    const { dynamicTodos } = useExecutionStore();

    if (dynamicTodos.length === 0) return null;

    return (
        <div className="w-full bg-[#13131a]/80 backdrop-blur-md border border-white/5 rounded-2xl p-4 shadow-xl">
            <h3 className="text-[11px] font-black text-white/50 uppercase tracking-widest mb-4 flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-[#976df8] animate-pulse" />
                Live Execution Queue
            </h3>
            <div className="space-y-3">
                <AnimatePresence>
                    {dynamicTodos.map((todo) => (
                        <motion.div
                            key={todo.id}
                            initial={{ opacity: 0, y: 10, scale: 0.98 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            transition={{ duration: 0.3 }}
                            className={`flex items-center gap-3 p-3 rounded-xl border transition-colors ${
                                todo.status === 'COMPLETED'
                                    ? 'bg-emerald-500/5 border-emerald-500/10'
                                    : todo.status === 'IN_PROGRESS'
                                    ? 'bg-[#976df8]/10 border-[#976df8]/20 shadow-[0_0_15px_rgba(151,109,248,0.1)]'
                                    : 'bg-white/[0.02] border-white/5'
                            }`}
                        >
                            {todo.status === 'COMPLETED' && <CheckCircle2 size={16} className="text-emerald-500 shrink-0" />}
                            {todo.status === 'IN_PROGRESS' && <Loader2 size={16} className="text-[#976df8] animate-spin shrink-0" />}
                            {todo.status === 'PENDING' && <Circle size={16} className="text-white/20 shrink-0" />}
                            
                            <span className={`text-sm font-medium ${
                                todo.status === 'COMPLETED' ? 'text-white/40 line-through' :
                                todo.status === 'IN_PROGRESS' ? 'text-[#976df8]' : 'text-white/70'
                            }`}>
                                {todo.text}
                            </span>
                        </motion.div>
                    ))}
                </AnimatePresence>
            </div>
        </div>
    );
}
