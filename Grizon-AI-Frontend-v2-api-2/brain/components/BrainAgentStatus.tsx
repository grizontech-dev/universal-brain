'use client';

import React, { useState, useEffect } from 'react';
import { ChevronDown, ChevronRight, Activity, CheckCircle2, Circle, LayoutList, Search, FileText, Code2, Terminal, FolderOpen } from 'lucide-react';
import { useExecutionStore } from '../store/execution-store';
import { MarkdownRenderer } from '@/components/chat/MarkdownRenderer';

export type AgentStep = 'idle' | 'reading' | 'analyzing' | 'clarifying' | 'researching' | 'planning' | 'taskifying' | 'executing' | 'finalizing' | 'completed';

export interface ExploreAction {
    id: string;
    title: string;
    description?: string;
    icon?: 'search' | 'file' | 'code' | 'terminal' | 'folder';
}

export interface ExploreGroup {
    id: string;
    title: string;
    stats?: string; // e.g. "1 File • 1 Search"
    actions: ExploreAction[];
}

interface BrainAgentStatusProps {
    step: AgentStep;
    thoughts?: string;
    timeline?: any[];
    exploreGroups?: ExploreGroup[]; // New prop for v0 style explore tree
}

// Helper to render specific icons based on type
const ActionIcon = ({ type, className = "" }: { type?: string, className?: string }) => {
    switch(type) {
        case 'search': return <Search size={13} className={className} />;
        case 'file': return <FileText size={13} className={className} />;
        case 'code': return <Code2 size={13} className={className} />;
        case 'terminal': return <Terminal size={13} className={className} />;
        case 'folder': return <FolderOpen size={13} className={className} />;
        default: return <FileText size={13} className={className} />;
    }
};

const ExploreGroupView = ({ group }: { group: ExploreGroup }) => {
    const [isExpanded, setIsExpanded] = useState(false);

    return (
        <div className="flex flex-col text-[13px] font-sans">
            <button 
                onClick={() => setIsExpanded(!isExpanded)}
                className="flex items-center gap-2 text-white/50 hover:text-white/80 transition-colors w-fit py-1"
            >
                {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <span className="font-medium tracking-tight">
                    {group.title} {group.stats && <span className="text-white/30 ml-1">• {group.stats}</span>}
                </span>
            </button>
            
            {isExpanded && (
                <div className="ml-[7px] pl-4 border-l border-white/10 flex flex-col gap-3 py-2 animate-in fade-in slide-in-from-top-1 duration-200">
                    {group.actions.map(action => (
                        <div key={action.id} className="flex flex-col">
                            <div className="flex items-center gap-2 text-white/60">
                                <ChevronDown size={12} className="text-white/20" />
                                <span className="font-medium">{action.title}</span>
                            </div>
                            {action.description && (
                                <div className="ml-[17px] mt-1 pl-3 border-l border-white/10 text-white/40 flex items-center gap-2">
                                    <span className="text-[12.5px] font-light flex items-center gap-1.5">
                                        <ActionIcon type={action.icon} className="text-white/30" />
                                        {action.description}
                                    </span>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default function BrainAgentStatus({ step, thoughts: propThoughts, timeline: propTimeline, exploreGroups }: BrainAgentStatusProps) {
    const store = useExecutionStore();
    const streamingMessage = propThoughts !== undefined ? propThoughts : store.streamingMessage;
    const timeline = propTimeline !== undefined ? propTimeline : store.timeline;
    
    const [seconds, setSeconds] = useState(0);
    const [isExpanded, setIsExpanded] = useState(false);

    useEffect(() => {
        if (step !== 'idle' && step !== 'completed') {
            const timer = setInterval(() => setSeconds(s => s + 1), 1000);
            return () => clearInterval(timer);
        }
    }, [step]);

    if (step === 'idle' && timeline.length === 0 && !streamingMessage && (!exploreGroups || exploreGroups.length === 0)) return null;

    return (
        <div className="w-full py-2 space-y-4 font-sans animate-in fade-in slide-in-from-top-2 duration-500 pl-[11px]">
            
            {/* V0 Style Thought Section */}
            {streamingMessage && (
                <div className="flex flex-col gap-2">
                    <button 
                        onClick={() => setIsExpanded(!isExpanded)}
                        className="flex items-center gap-1.5 text-white/40 hover:text-white/70 transition-colors w-fit"
                    >
                        {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        <span className="text-[13px] font-medium tracking-tight">Thought for {seconds}s</span>
                    </button>

                    {isExpanded && (
                        <div className="ml-1.5 pl-4 border-l-2 border-white/10 text-white/60 text-[13px] leading-[1.6]">
                            {/* Render rich markdown thoughts */}
                            <div className="thought-markdown [&_p]:mb-2 [&_ul]:list-disc [&_ul]:pl-4 [&_ul]:mb-2 [&_ol]:list-decimal [&_ol]:pl-4 [&_ol]:mb-2 [&_li]:mb-0.5 [&_strong]:text-white/80 [&_strong]:font-medium [&_h1]:text-white/80 [&_h2]:text-white/80 [&_h3]:text-white/80">
                                <MarkdownRenderer content={streamingMessage} />
                            </div>
                            {step !== 'completed' && (
                                <span className="inline-block w-1.5 h-3.5 ml-1 bg-white/40 animate-pulse align-middle" />
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* V0 Style Explore Tree */}
            {exploreGroups && exploreGroups.length > 0 && (
                <div className="flex flex-col gap-1.5 pt-1">
                    {exploreGroups.map(group => (
                        <ExploreGroupView key={group.id} group={group} />
                    ))}
                </div>
            )}

            {/* Event Timeline (V0 action pills) */}
            {timeline && timeline.length > 0 && (
                <div className="space-y-3 pt-2">
                    {timeline.map((event, i) => (
                        <div key={event.id || i} className="flex items-center gap-2.5 text-[13px]">
                            {event.type === 'SUCCESS' ? (
                                <CheckCircle2 size={15} className="text-white/40" />
                            ) : event.type === 'ERROR' ? (
                                <Circle size={15} className="text-red-400" />
                            ) : (
                                <LayoutList size={15} className="text-white/40" />
                            )}
                            <span className="text-white/70 font-medium tracking-wide">{event.text}</span>
                        </div>
                    ))}
                </div>
            )}

            {/* Worked for footer */}
            {step === 'completed' && (
                <div className="flex items-center gap-2 text-white/40 text-[12px] pt-3">
                    <Activity size={14} />
                    <span>Worked for {seconds}s</span>
                </div>
            )}
        </div>
    );
}
