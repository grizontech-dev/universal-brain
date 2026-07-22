"use client";

import React, { useState, useEffect, useRef } from 'react';
import { Sparkles, Brain, Activity, Copy, Check, RotateCw, Terminal, ListChecks, CheckCircle2, Loader2, Play, MoreHorizontal, Link } from 'lucide-react';
import { MarkdownRenderer } from '@/components/chat/MarkdownRenderer';
import BrainPlanCanvas from './BrainPlanCanvas';
import BrainTodoCanvas from './BrainTodoCanvas';
import BrainClarificationCard from './BrainClarificationCard';
import BrainAgentStatus, { AgentStep } from './BrainAgentStatus';
import BrainBuildActivityFeed from './BrainBuildActivityFeed';

import type { BuildActivity, BuildTodoItem } from '../lib/buildActivity';

export interface BrainAgentMessageProps {
  content: string;
  dateTime: string;
  model?: string;
  isLoading?: boolean;
  planContent?: string;
  planVersions?: string[];
  planApproved?: boolean;
  planSuperseded?: boolean;
  sandboxJob?: any;
  todoList?: {
      task: string;
      description: string;
      status: 'pending' | 'executing' | 'completed' | 'failed';
  }[];
  onRegenerate?: () => void;
  clarificationData?: any;
  onClarifySelect?: (answer: string) => void;
  onClarifySkip?: () => void;
  onBuild?: () => void;
  onReject?: () => void;
  agentStep?: AgentStep;
  thoughts?: string;
  timeline?: any[];
  exploreGroups?: any[]; // For nested tool execution logs
  buildActivities?: BuildActivity[];
  buildTodos?: BuildTodoItem[];
  isBuildSyncing?: boolean;

}

export default function BrainAgentMessage({
  content,
  dateTime,
  model = 'Grizon Brain',
  isLoading = false,
  planContent,
  planVersions,
  planApproved,
  planSuperseded,
  sandboxJob,
  todoList,
  onRegenerate,
  clarificationData,
  onClarifySelect,
  onClarifySkip,
  onBuild,
  onReject,
  agentStep,
  thoughts,
  timeline,
  exploreGroups,
  buildActivities,
  buildTodos,
  isBuildSyncing,

}: BrainAgentMessageProps) {
  const [isCopied, setIsCopied] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowMenu(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(String(content || ""));
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy', err);
    }
  };

  return (
    <div className="w-full max-w-full min-w-0 overflow-hidden flex flex-col items-start gap-2 pb-6 animate-in fade-in slide-in-from-bottom-2 duration-300 text-left">
      {/* Header */}
      <div className="flex items-center gap-3 mb-2 w-full">
        <div className="w-8 h-8 shrink-0 flex items-center justify-center">
            <Brain className="text-white/20" size={16} />
        </div>
        <div className="flex items-center gap-2">
            <span className="text-[12px] font-medium text-white/20 uppercase tracking-[0.1em]">
                Grizon Brain
            </span>
            <span className="text-[11px] text-white/10 font-medium lowercase">
              {dateTime || 'analyzing...'}
            </span>
        </div>
      </div>

      {/* Content */}
      <div className="w-full max-w-full">
        <div className="text-white/80 leading-relaxed text-[15px] font-light markdown-content pl-11 relative">
          
          {/* Active Status & Thoughts (V0 style) */}
          {(thoughts || (timeline && timeline.length > 0) || (agentStep && agentStep !== 'idle')) && (
             <div className="-ml-3 mb-3">
                 <BrainAgentStatus 
                    step={agentStep || 'completed'} 
                    thoughts={thoughts}
                    timeline={timeline}
                    exploreGroups={exploreGroups}
                 />
             </div>
          )}

          {/* Only render content if it's not a structural plan (safety gate) */}
          {content && typeof content === 'string' && !planContent && !(
            content.trim().startsWith('{') ||
            content.includes('"project_name"') ||
            content.includes('Strategic Plan') ||
            content.includes('Strategic Roadmap') ||
            content.includes('## 🗺️') ||
            content.includes('### 🏗️') ||
            content.startsWith('__CLARIFY__:')
          ) && (
            <MarkdownRenderer content={content} />
          )}

          {/* Plan Canvas (v0 style) */}
          {(!clarificationData?.length && (!!planContent || agentStep === 'planning' || (planVersions && planVersions.length > 0) || (typeof content === 'string' && content.includes('Revising architecture')))) && !planSuperseded && (
            <div className="mt-4 w-full pr-10 animate-in fade-in slide-in-from-bottom-2 duration-500">
              <BrainPlanCanvas 
                plan={planContent} 
                planVersions={planVersions}
                todoList={todoList} 
                onBuild={onBuild}
                onReject={onReject}
              />
            </div>
          )}

          {/* Build Activity Feed (Inline v0 style) */}
          {(buildActivities !== undefined || buildTodos !== undefined) && (
             <div className="mt-4 pb-2 w-full pr-10 animate-in fade-in slide-in-from-bottom-2 duration-500">
                 <BrainBuildActivityFeed
                     activities={buildActivities || []}
                     todos={buildTodos || []}
                     isSyncing={isBuildSyncing}
                     className="bg-transparent border border-white/[0.05] rounded-xl overflow-hidden"
                 />
             </div>
          )}




          {/* Clarification Questions */}
          {clarificationData && clarificationData.length > 0 && onClarifySelect && (
            <div className="mt-4">
              <BrainClarificationCard 
                questions={clarificationData} 
                onSelect={onClarifySelect}
                onSkip={onClarifySkip || (() => onClarifySelect("I'll provide more details later. Please proceed with what you have."))}
              />
            </div>
          )}

          {isLoading && !agentStep && (
              <div className="mt-2 w-8 h-1 bg-white/10 animate-pulse rounded-full" />
          )}
        </div>
      </div>

      {/* Footer Badges & Actions */}
      <div className="flex items-center justify-between w-full mt-2 pl-11 relative">
        <div className="flex items-center justify-between w-full">
          <div>{/* Left empty for flex alignment */}</div>
          
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setShowMenu(!showMenu)}
              disabled={isLoading && !showMenu}
              className={`p-1.5 transition-all rounded-md text-white/40 hover:text-white hover:bg-white/[0.05] ${showMenu ? 'bg-white/[0.05] text-white' : ''}`}
            >
              <MoreHorizontal size={16} />
            </button>

            {showMenu && (
              <div className="absolute right-0 bottom-full mb-2 w-40 bg-[#141414] border border-white/10 rounded-xl shadow-2xl overflow-hidden z-50 flex flex-col p-1.5 text-[13px]">
                  <button 
                    onClick={() => { onRegenerate?.(); setShowMenu(false); }}
                    className="flex items-center gap-3 px-3 py-2 w-full text-left text-white/60 hover:bg-white/5 hover:text-white rounded-md transition-colors"
                  >
                    <RotateCw size={14} className={isLoading ? 'animate-spin' : ''} />
                    Retry
                  </button>
                  <button 
                    onClick={() => { handleCopy(); setShowMenu(false); }}
                    className="flex items-center gap-3 px-3 py-2 w-full text-left text-white/60 hover:bg-white/5 hover:text-white rounded-md transition-colors"
                  >
                    {isCopied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
                    {isCopied ? 'Copied' : 'Copy'}
                  </button>
                  <button 
                    onClick={() => { setShowMenu(false); }}
                    className="flex items-center gap-3 px-3 py-2 w-full text-left text-white/60 hover:bg-white/5 hover:text-white rounded-md transition-colors"
                  >
                    <Link size={14} />
                    Copy Link
                  </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
