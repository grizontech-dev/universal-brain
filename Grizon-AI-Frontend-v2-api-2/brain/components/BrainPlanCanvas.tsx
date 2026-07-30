"use client";

import React, { useState } from 'react';
import { ListTodo, ChevronDown, ChevronUp, Zap, Loader2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface Task {
    task: string;
    description: string;
    status: 'pending' | 'executing' | 'completed' | 'failed';
}

interface BrainPlanCanvasProps {
    plan?: string;
    planVersions?: string[];
    todoList?: Task[];
    onBuild?: () => void;
    onReject?: (feedback?: string) => void;
}

export default function BrainPlanCanvas({ plan, planVersions, todoList, onBuild, onReject }: BrainPlanCanvasProps) {
    const [showDetails, setShowDetails] = useState(false);
    const [isRejecting, setIsRejecting] = useState(false);
    const [feedback, setFeedback] = useState("");
    const [selectedVersionIdx, setSelectedVersionIdx] = useState<number | null>(null);

    if (plan === undefined && (!todoList || todoList.length === 0)) return null;

    const allPlans = [...(planVersions || [])];
    if (plan !== undefined && !allPlans.includes(plan)) {
        allPlans.push(plan);
    }

    const activePlanIdx = selectedVersionIdx !== null ? selectedVersionIdx : Math.max(0, allPlans.length - 1);
    const activePlanContent = allPlans[activePlanIdx] || plan;

    // Parse the plan JSON
    let parsedPlan: any = null;
    if (activePlanContent) {
        try {
            if (activePlanContent.trim().startsWith('{') || activePlanContent.trim().startsWith('[')) {
                parsedPlan = JSON.parse(activePlanContent);
            } else {
                const jsonMatch = activePlanContent.match(/\{[\s\S]*\}/);
                if (jsonMatch) parsedPlan = JSON.parse(jsonMatch[0]);
            }
        } catch (e) {
            console.warn("Plan parsing failed", e);
        }
    }

    const isExecuting = todoList?.some(t => t.status === 'executing');
    const isCompleted = todoList?.every(t => t.status === 'completed') && (todoList?.length ?? 0) > 0;

    const handleRejectSubmit = () => {
        if (feedback.trim() && onReject) {
            onReject(feedback);
            setIsRejecting(false);
            setFeedback("");
        }
    };

    // Extract display data
    const projectName = parsedPlan?.project_name || "Implementation Plan";
    let markdownPlan = parsedPlan?.markdown_plan;
    
    // Pre-process markdown to fix AI formatting quirks
    if (markdownPlan) {
        // Fix Windows line endings
        markdownPlan = markdownPlan.replace(/\r\n/g, '\n');
        
        // Convert "**Heading**" on its own line into "## Heading"
        markdownPlan = markdownPlan.replace(/^[\s]*\*\*(.+?)\*\*[\s]*$/gm, '\n## $1\n');
        
        // Convert short plain text lines that look like headings (no punctuation at end, capitalized) to "## Heading"
        markdownPlan = markdownPlan.replace(/^[\s]*([A-Z][a-zA-Z0-9\s]{2,40})[\s]*$/gm, '\n## $1\n');
        
        // Ensure there are blank lines around lists
        markdownPlan = markdownPlan.replace(/([^\n])\n(-|\*|\d+\.) /g, '$1\n\n$2 ');
        
        // Ensure there are blank lines between paragraphs (if a lowercase/uppercase letter is followed by a newline and then another letter)
        markdownPlan = markdownPlan.replace(/([a-zA-Z\.])\n([a-zA-Z])/g, '$1\n\n$2');
        
        // Make sure headers have space after
        markdownPlan = markdownPlan.replace(/(## .+)\n([^\n])/g, '$1\n\n$2');
    }

    const summaryPoints: { key: string; value: string }[] = parsedPlan?.summary_points || [];
    const structuralDetails: string[] = parsedPlan?.structural_details || [];

    return (
        <div className="w-full mt-4 animate-in fade-in slide-in-from-bottom-2 duration-500">

            <div className="bg-surface-2 border border-border-default rounded-2xl overflow-hidden shadow-xl">

                {/* Header */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-border-subtle">
                    <div className="flex items-center gap-2.5">
                        <ListTodo size={16} className="text-accent shrink-0" />
                        <h3 className="text-[14px] font-bold text-text-primary tracking-tight flex items-center gap-3 font-display">
                            {projectName}
                            {allPlans.length > 1 && (
                                <select 
                                    className="bg-surface-3 border border-border-subtle rounded-lg px-2 py-0.5 text-[11px] text-text-secondary font-medium focus:outline-none focus:border-accent/40 cursor-pointer"
                                    value={activePlanIdx}
                                    onChange={(e) => setSelectedVersionIdx(Number(e.target.value))}
                                >
                                    {allPlans.map((_, i) => (
                                        <option key={i} value={i} className="bg-surface-2 text-text-primary">
                                            v{i + 1} {i === allPlans.length - 1 ? '(Latest)' : ''}
                                        </option>
                                    ))}
                                </select>
                            )}
                        </h3>
                    </div>

                </div>

                {/* Markdown Plan (v0 style) */}
                {(activePlanContent === "" || (!markdownPlan && summaryPoints.length === 0)) ? (
                    <div className="px-6 py-10 flex flex-col items-center justify-center gap-3">
                        <Loader2 size={24} className="animate-spin text-accent" />
                        <p className="text-[13px] text-text-muted font-medium">Generating new architecture...</p>
                    </div>
                ) : markdownPlan ? (
                    <div className={`px-6 pb-6 mt-3 relative transition-all duration-300 ${showDetails ? 'max-h-[65vh] overflow-y-auto custom-scrollbar' : 'max-h-[300px] overflow-hidden'}`}>
                        <div className="max-w-none">
                            <ReactMarkdown 
                                remarkPlugins={[remarkGfm]}
                                components={{
                                    h2: ({node, ...props}) => <h2 className="text-[20px] font-bold tracking-tight text-text-primary mt-6 mb-3 border-b border-border-subtle pb-2.5 font-display" {...props} />,
                                    h3: ({node, ...props}) => <h3 className="text-[16px] font-bold tracking-tight text-text-primary mt-5 mb-2.5 font-display" {...props} />,
                                    p: ({node, ...props}) => <p className="text-[14px] leading-relaxed text-text-secondary my-3" {...props} />,
                                    ul: ({node, ...props}) => <ul className="list-disc pl-5 my-3 space-y-1.5 text-text-secondary" {...props} />,
                                    ol: ({node, ...props}) => <ol className="list-decimal pl-5 my-3 space-y-1.5 text-text-secondary" {...props} />,
                                    li: ({node, ...props}) => <li className="text-[14px]" {...props} />,
                                    strong: ({node, ...props}) => <strong className="font-bold text-text-primary" {...props} />,
                                    a: ({node, ...props}) => <a className="text-accent no-underline hover:underline font-semibold" {...props} />
                                }}
                            >
                                {markdownPlan}
                            </ReactMarkdown>
                        </div>
                        {/* Fade out gradient when hidden */}
                        {!showDetails && (
                            <div className="absolute bottom-0 left-0 right-0 h-28 bg-gradient-to-t from-surface-2 to-transparent pointer-events-none" />
                        )}
                    </div>
                ) : (
                    <>
                        {/* Fallback Summary bullet points */}
                        {summaryPoints.length > 0 && (
                            <div className="px-5 pb-5 space-y-2">
                                {summaryPoints.map((point, i) => (
                                    <div key={i} className="flex items-start gap-2.5 text-[13.5px] leading-relaxed">
                                        <span className="mt-[5px] w-[5px] h-[5px] shrink-0 rounded-full bg-accent" />
                                        <p className="text-text-secondary">
                                            <strong className="text-text-primary font-semibold">{point.key}</strong>
                                            {': '}
                                            <span className="font-light">{point.value}</span>
                                        </p>
                                    </div>
                                ))}
                            </div>
                        )}
                    </>
                )}

                {/* Collapsible Details */}
                {showDetails && structuralDetails.length > 0 && (
                    <div className="px-5 pb-6 border-t border-border-subtle pt-4 animate-in slide-in-from-top-2 duration-300">
                        <div className="space-y-2">
                            {structuralDetails.map((detail: string, idx: number) => (
                                <div key={idx} className="flex items-start gap-2.5 text-[13px] text-text-muted">
                                    <span className="mt-[6px] w-[3px] h-[3px] shrink-0 rounded-full bg-accent/60" />
                                    <span className="font-light">{detail}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Reject feedback textarea (v0 style) */}
                {isRejecting && (
                    <div className="px-4 pb-4 animate-in slide-in-from-bottom-2 duration-200">
                        <textarea
                            autoFocus
                            value={feedback}
                            onChange={(e) => setFeedback(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault();
                                    handleRejectSubmit();
                                }
                                if (e.key === 'Escape') setIsRejecting(false);
                            }}
                            placeholder="What would you like to change?"
                            className="w-full bg-surface-3 border border-border-subtle rounded-xl px-4 py-3 text-[13px] text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/40 resize-none min-h-[90px]"
                        />
                    </div>
                )}

                {/* Footer: Show details | Request Changes | Build */}
                <div className="flex items-center justify-between px-4 py-3 border-t border-border-subtle bg-surface-1/40">
                    <button
                        onClick={() => setShowDetails(!showDetails)}
                        className="flex items-center gap-1.5 text-[12.5px] font-medium text-text-muted hover:text-text-primary transition-colors"
                    >
                        {showDetails ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        <span>{showDetails ? 'Hide details' : 'Show details'}</span>
                    </button>

                    <div className="flex items-center gap-2">
                        {isRejecting ? (
                            <>
                                <button
                                    onClick={() => setIsRejecting(false)}
                                    className="px-4 py-1.5 text-[12.5px] font-medium text-text-secondary hover:text-text-primary border border-border-subtle hover:bg-surface-3 rounded-xl transition-all"
                                >
                                    Back
                                </button>
                                <button
                                    onClick={handleRejectSubmit}
                                    disabled={!feedback.trim()}
                                    className="px-4 py-1.5 bg-accent text-white hover:brightness-110 text-[13px] font-bold rounded-xl transition-all disabled:opacity-50 shadow-md"
                                >
                                    Submit Feedback
                                </button>
                            </>
                        ) : isCompleted ? (
                            <div className="px-5 py-1.5 rounded-xl bg-emerald-500/10 text-emerald-500 text-[12px] font-bold border border-emerald-500/20">
                                Complete
                            </div>
                        ) : isExecuting ? (
                            <div className="px-5 py-1.5 rounded-xl bg-surface-3 text-text-muted text-[12px] font-medium border border-border-subtle flex items-center gap-2">
                                <Loader2 size={12} className="animate-spin text-accent" />
                                Building...
                            </div>
                        ) : (
                            <>
                                {onReject && (
                                    <button
                                        onClick={() => setIsRejecting(true)}
                                        className="px-4 py-1.5 text-[12.5px] font-medium text-text-secondary hover:text-text-primary border border-border-subtle hover:bg-surface-3 rounded-xl transition-all"
                                    >
                                        Request Changes
                                    </button>
                                )}
                                {onBuild && (
                                    <button
                                        onClick={onBuild}
                                        className="px-6 py-2 bg-accent text-white hover:brightness-110 text-[13px] font-semibold rounded-full transition-all flex items-center gap-2 shadow-lg shadow-accent/25 whitespace-nowrap shrink-0 cursor-pointer"
                                    >
                                        <Zap size={13} fill="currentColor" />
                                        Build
                                    </button>

                                )}
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

