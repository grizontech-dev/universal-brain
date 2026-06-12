'use client';

import React, { useState, useEffect } from 'react';
import { Brain, Search, Activity, CheckCircle2, Circle } from 'lucide-react';
import { useExecutionStore } from './store/execution-store';
import BrainLiveTodos from './components/BrainLiveTodos';
import { useStream } from './lib/streaming/useStream';
import { agentEngine } from './lib/agent-engine/engine';

interface BrainViewProps {
  standalone?: boolean;
}
export default function BrainView({ standalone = true }: BrainViewProps) {
  const [activeTab, setActiveTab] = useState('overview');
  const { currentPhase, timeline, activeAgents, streamingMessage } = useExecutionStore();
  const { streamedText, startStream, stopStream } = useStream();

  useEffect(() => {
      if (streamingMessage) {
          startStream(streamingMessage);
      } else {
          stopStream();
      }
  }, [streamingMessage, startStream, stopStream]);

  const triggerTest = () => {
      agentEngine.startExecution("Create an AI finance dashboard");
  };

  return (
    <div className={`flex flex-col ${standalone ? 'h-screen' : 'h-full'} bg-[#09090b] text-white overflow-hidden font-sans`}>
      {/* Header */}
      {standalone && (
        <header className="h-16 border-b border-white/5 flex items-center px-6 justify-between shrink-0 bg-[#09090b]/80 backdrop-blur-md z-10">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-accent/20 flex items-center justify-center border border-accent/30 shadow-glow">
              <Brain className="text-accent" size={18} />
            </div>
            <div className="flex flex-col">
              <h1 className="text-[15px] font-bold tracking-tight bg-gradient-to-r from-white to-white/60 bg-clip-text text-transparent leading-none">
                Neural Brain
              </h1>
              <span className="text-[10px] text-white/30 font-medium tracking-wide">Command Center</span>
            </div>
            <span className="ml-2 px-1.5 py-0.5 rounded-[4px] text-[9px] font-bold bg-accent/10 border border-accent/20 text-accent uppercase tracking-widest">
              v2.0
            </span>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="hidden md:flex items-center gap-1 px-3 py-1.5 rounded-full bg-white/5 border border-white/10">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-[11px] font-medium text-white/60">Neural Network Active</span>
            </div>
            <div className="flex items-center gap-2">
               <button className="p-2 rounded-lg hover:bg-white/5 transition-colors text-white/40 hover:text-white">
                  <Search size={18} />
               </button>
               <div className="w-8 h-8 rounded-full bg-surface-3 border border-white/10" />
            </div>
          </div>
        </header>
      )}

      {/* Main Content */}
      <main className="flex-1 flex overflow-hidden">
        {/* Workspace Area */}
        <section className="flex-1 relative bg-[#0d0c14] overflow-y-auto custom-scrollbar">
          {/* Subtle grid background */}
          <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:40px_40px] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)] pointer-events-none" />
          
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(151,109,248,0.05),transparent_70%)] pointer-events-none" />
          
          <div className="p-8 max-w-6xl mx-auto space-y-8 relative z-1">
            {activeTab === 'overview' && (
              <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                
                {/* Control Panel (for testing) */}
                <div className="flex gap-4 mb-8">
                    <button onClick={triggerTest} className="px-4 py-2 bg-[#976df8] text-white rounded-lg font-bold text-sm hover:bg-[#976df8]/80 transition-colors">
                        Simulate Agent Execution
                    </button>
                    <div className="px-4 py-2 bg-white/5 border border-white/10 rounded-lg flex items-center gap-2">
                        <Activity size={14} className="text-[#976df8]" />
                        <span className="text-[11px] font-black uppercase tracking-widest text-white/50">Phase: {currentPhase}</span>
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    {/* Left Column: Timeline & Todos */}
                    <div className="lg:col-span-2 space-y-8">
                        {/* Streaming Thought Bubble */}
                        {(streamingMessage || streamedText) && (
                            <div className="p-6 rounded-2xl bg-[#976df8]/5 border border-[#976df8]/20 relative">
                                <div className="absolute -top-3 left-6 px-2 bg-[#09090b] text-[10px] font-black text-[#976df8] uppercase tracking-widest flex items-center gap-2">
                                    <div className="w-1.5 h-1.5 rounded-full bg-[#976df8] animate-pulse" />
                                    Agent Thought
                                </div>
                                <p className="text-white/80 font-mono text-sm min-h-[40px]">
                                    {streamedText}
                                    <span className="inline-block w-1.5 h-4 ml-1 bg-[#976df8] animate-pulse align-middle" />
                                </p>
                            </div>
                        )}

                        {/* Live Todos */}
                        <BrainLiveTodos />

                        {/* Execution Timeline */}
                        {timeline.length > 0 && (
                            <div className="p-6 rounded-2xl bg-white/[0.02] border border-white/5 space-y-4">
                                <h3 className="text-[11px] font-black text-white/50 uppercase tracking-widest mb-4">Execution Timeline</h3>
                                <div className="space-y-4 relative before:absolute before:inset-0 before:ml-2.5 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-white/10 before:to-transparent">
                                    {timeline.map((event, i) => (
                                        <div key={event.id} className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
                                            <div className="flex items-center justify-center w-5 h-5 rounded-full border border-white/10 bg-[#13131a] shadow shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2">
                                                <div className={`w-1.5 h-1.5 rounded-full ${event.type === 'SUCCESS' ? 'bg-emerald-500' : 'bg-[#976df8]'}`} />
                                            </div>
                                            <div className="w-[calc(100%-3rem)] md:w-[calc(50%-2.5rem)] p-3 rounded-xl bg-white/5 border border-white/5">
                                                <div className="flex items-center justify-between mb-1">
                                                    <span className="text-[10px] text-white/40 font-bold font-mono">{new Date(event.timestamp).toLocaleTimeString()}</span>
                                                </div>
                                                <p className="text-sm text-white/70">{event.text}</p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Right Column: Active Agents */}
                    <div className="space-y-4">
                        <h3 className="text-[11px] font-black text-white/50 uppercase tracking-widest">Active Agents</h3>
                        {Object.values(activeAgents).map((agent) => (
                            <div key={agent.id} className={`p-4 rounded-xl border ${
                                agent.status === 'WORKING' || agent.status === 'THINKING' 
                                ? 'bg-[#976df8]/10 border-[#976df8]/20 shadow-[0_0_15px_rgba(151,109,248,0.05)]' 
                                : 'bg-white/[0.02] border-white/5'
                            }`}>
                                <div className="flex items-center gap-3 mb-2">
                                    <div className="relative">
                                        <Brain size={16} className={agent.status === 'WORKING' ? 'text-[#976df8]' : 'text-white/40'} />
                                        {(agent.status === 'WORKING' || agent.status === 'THINKING') && (
                                            <span className="absolute top-0 right-0 w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping" />
                                        )}
                                    </div>
                                    <span className="text-xs font-bold text-white/80">{agent.name}</span>
                                </div>
                                <div className="text-[10px] text-white/40 font-mono uppercase tracking-wider">
                                    Status: <span className={agent.status === 'WORKING' ? 'text-emerald-500' : agent.status === 'THINKING' ? 'text-amber-500' : 'text-white/20'}>{agent.status}</span>
                                </div>
                                {agent.currentTask && (
                                    <div className="mt-2 text-[11px] text-[#976df8]/80 font-medium bg-[#976df8]/10 px-2 py-1 rounded inline-block">
                                        {agent.currentTask}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>

              </div>
            )}
            
            {activeTab === 'terminal' && (
              <div className="h-[600px] rounded-3xl border border-white/10 bg-[#09090b] shadow-premium overflow-hidden flex flex-col font-mono animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="h-10 bg-white/5 border-b border-white/5 flex items-center px-4 justify-between">
                  <div className="flex gap-2">
                    <div className="w-3 h-3 rounded-full bg-red-500/20 border border-red-500/40" />
                    <div className="w-3 h-3 rounded-full bg-amber-500/20 border border-amber-500/40" />
                    <div className="w-3 h-3 rounded-full bg-emerald-500/20 border border-emerald-500/40" />
                  </div>
                  <span className="text-[10px] text-white/20 uppercase tracking-widest font-bold">system@brain: ~/neural-sandbox</span>
                </div>
                <div className="flex-1 p-6 overflow-y-auto space-y-4 text-sm">
                  <div className="flex gap-3">
                    <span className="text-accent font-bold">»</span>
                    <span className="text-white/80">initializing brain_v2.sys...</span>
                  </div>
                  <div className="flex gap-3">
                    <span className="text-accent font-bold">»</span>
                    <span className="text-white/80">mounting distributed_memory_v4... [OK]</span>
                  </div>
                  <div className="flex gap-3">
                    <span className="text-accent font-bold">»</span>
                    <span className="text-white/80">verifying encrypted_keys... [VERIFIED]</span>
                  </div>
                  <div className="flex gap-3">
                    <span className="text-accent font-bold">»</span>
                    <span className="text-white/80">loading local knowledge graphs... [DONE]</span>
                  </div>
                  <div className="flex gap-3 pt-4">
                    <span className="text-emerald-500 font-bold">$</span>
                    <span className="text-white/90">awaiting neural command<span className="animate-pulse">_</span></span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}


