'use client';

import React, { useState, useEffect } from 'react';
import { Loader2, Pencil } from 'lucide-react';

interface ClarificationQuestion {
    id: string;
    text: string;
    options: string[];
    category?: string;
    type?: 'single' | 'multi';
    allowAll?: boolean;
}

interface BrainClarificationCardProps {
    questions: ClarificationQuestion[];
    onSelect: (answer: string) => void;
    onSkip: () => void;
}

export default function BrainClarificationCard({ questions, onSelect, onSkip }: BrainClarificationCardProps) {
    const [currentPage, setCurrentPage] = useState(0);
    const [answers, setAnswers] = useState<string[]>([]);
    const [selectedOption, setSelectedOption] = useState<string | null>(null);
    const [multiSelected, setMultiSelected] = useState<Set<string>>(new Set());
    const [allSelected, setAllSelected] = useState(false);
    const [customInput, setCustomInput] = useState('');
    const [isCustom, setIsCustom] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const question = questions[currentPage];
    const isMulti = question?.type === 'multi';

    // Clear state when page changes
    useEffect(() => {
        setSelectedOption(null);
        setMultiSelected(new Set());
        setAllSelected(false);
        setCustomInput('');
        setIsCustom(false);
    }, [currentPage]);

    if (!question || isSubmitting) {
        if (isSubmitting) {
            return (
                <div className="w-full max-w-lg bg-[#141414] border border-white/[0.08] rounded-2xl p-8 flex flex-col items-center justify-center gap-4">
                    <Loader2 size={22} className="text-white/40 animate-spin" />
                    <span className="text-white/40 text-[13px]">Syncing your requirements...</span>
                </div>
            );
        }
        return null;
    }

    const handleSingleAnswer = (val: string) => {
        const newAnswers = [...answers];
        newAnswers[currentPage] = val;
        setAnswers(newAnswers);
        setSelectedOption(val);
    };

    const handleMultiToggle = (val: string) => {
        const next = new Set(multiSelected);
        if (next.has(val)) {
            next.delete(val);
            if (question.allowAll && allSelected) setAllSelected(false);
        } else {
            next.add(val);
            if (question.allowAll && next.size === question.options.length) {
                setAllSelected(true);
            }
        }
        const newAnswers = [...answers];
        newAnswers[currentPage] = Array.from(next).join(', ');
        setAnswers(newAnswers);
        setMultiSelected(next);
    };

    const handleAllToggle = () => {
        if (allSelected) {
            setMultiSelected(new Set());
            setAllSelected(false);
            const newAnswers = [...answers];
            newAnswers[currentPage] = '';
            setAnswers(newAnswers);
        } else {
            const all = new Set(question.options);
            setMultiSelected(all);
            setAllSelected(true);
            const newAnswers = [...answers];
            newAnswers[currentPage] = Array.from(all).join(', ');
            setAnswers(newAnswers);
        }
    };

    const handleNext = () => {
        const currentAnswers = [...answers];
        let currentAnswer: string;

        if (isMulti) {
            currentAnswer = currentAnswers[currentPage] || '';
        } else {
            currentAnswer = currentAnswers[currentPage] || selectedOption || '';
        }

        if (!currentAnswer) return;
        currentAnswers[currentPage] = currentAnswer;
        setAnswers(currentAnswers);

        if (currentPage < questions.length - 1) {
            setCurrentPage(p => p + 1);
        } else {
            setIsSubmitting(true);
            const summary = currentAnswers.map((ans, i) => `${questions[i].text}: ${ans}`).join('\n');
            onSelect(summary);
        }
    };

    const handleCustomSubmit = () => {
        if (!customInput.trim()) return;
        if (isMulti) {
            handleMultiToggle(customInput.trim());
        } else {
            handleSingleAnswer(customInput.trim());
        }
        setCustomInput('');
        setIsCustom(false);
    };

    const categoryLabel = question.category
        ? question.category.charAt(0).toUpperCase() + question.category.slice(1)
        : `Question ${currentPage + 1}`;

    const hasAnswer = isMulti
        ? multiSelected.size > 0 || !!answers[currentPage]
        : !!answers[currentPage] || !!selectedOption;

    return (
        <div className="w-full max-w-lg animate-in fade-in slide-in-from-bottom-2 duration-400 mb-6">
            <div className="bg-[#141414] border border-white/[0.1] rounded-2xl overflow-hidden shadow-2xl">
                <div className="flex items-center justify-between px-5 pt-4 pb-3">
                    <div className="flex items-center gap-2.5">
                        <span className="w-6 h-6 rounded-md bg-[#3b82f6] flex items-center justify-center text-[12px] font-bold text-white shrink-0">
                            {currentPage + 1}
                        </span>
                        <span className="text-[15px] font-semibold text-white/90 tracking-tight">
                            {categoryLabel}
                        </span>
                        {isMulti && (
                            <span className="text-[10px] font-bold uppercase tracking-widest text-white/30 bg-white/5 px-2 py-0.5 rounded">
                                Select all that apply
                            </span>
                        )}
                    </div>
                    <span className="text-[13px] text-white/30 tabular-nums font-medium">
                        {currentPage + 1}/{questions.length}
                    </span>
                </div>

                <div className="px-5 pb-4">
                    <p className="text-[14px] text-white/60 leading-relaxed">
                        {question.text}
                    </p>
                </div>

                <div className="px-4 pb-2 space-y-1">
                    {question.options.map((opt, i) => {
                        const isSelected = isMulti
                            ? multiSelected.has(opt)
                            : selectedOption === opt || answers[currentPage] === opt;
                        return (
                            <button
                                key={i}
                                onClick={() => isMulti ? handleMultiToggle(opt) : handleSingleAnswer(opt)}
                                className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-left transition-all duration-150 group ${
                                    isSelected
                                        ? 'bg-white/[0.07]'
                                        : 'hover:bg-white/[0.04]'
                                }`}
                            >
                                {isMulti ? (
                                    <span className={`w-[18px] h-[18px] shrink-0 rounded border-2 flex items-center justify-center transition-all ${
                                        isSelected
                                            ? 'border-white/60 bg-white/60'
                                            : 'border-white/20 group-hover:border-white/40'
                                    }`}>
                                        {isSelected && (
                                            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                                                <path d="M2 5L4 7L8 3" stroke="#141414" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                                            </svg>
                                        )}
                                    </span>
                                ) : (
                                    <span className={`w-[18px] h-[18px] shrink-0 rounded-full border-2 flex items-center justify-center transition-all ${
                                        isSelected
                                            ? 'border-white/60 bg-white/60'
                                            : 'border-white/20 group-hover:border-white/40'
                                    }`}>
                                        {isSelected && (
                                            <span className="w-[7px] h-[7px] rounded-full bg-[#141414]" />
                                        )}
                                    </span>
                                )}
                                <span className={`text-[13.5px] font-medium leading-snug transition-colors ${
                                    isSelected ? 'text-white/90' : 'text-white/50 group-hover:text-white/70'
                                }`}>
                                    {opt}
                                </span>
                            </button>
                        );
                    })}

                    {isMulti && question.allowAll && (
                        <button
                            onClick={handleAllToggle}
                            className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-left transition-all duration-150 group ${
                                allSelected ? 'bg-white/[0.07]' : 'hover:bg-white/[0.04]'
                            }`}
                        >
                            <span className={`w-[18px] h-[18px] shrink-0 rounded border-2 flex items-center justify-center transition-all ${
                                allSelected
                                    ? 'border-white/60 bg-white/60'
                                    : 'border-white/20 group-hover:border-white/40'
                            }`}>
                                {allSelected && (
                                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                                        <path d="M2 5L4 7L8 3" stroke="#141414" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                                    </svg>
                                )}
                            </span>
                            <span className={`text-[13.5px] font-semibold leading-snug transition-colors ${
                                allSelected ? 'text-white/90' : 'text-white/40 group-hover:text-white/60'
                            }`}>
                                All of the above
                            </span>
                        </button>
                    )}

                    {!isCustom ? (
                        <button
                            onClick={() => setIsCustom(true)}
                            className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-left hover:bg-white/[0.04] transition-all group"
                        >
                            <span className="w-[18px] h-[18px] shrink-0 rounded-full border-2 border-white/10 flex items-center justify-center group-hover:border-white/30 transition-all">
                                <Pencil size={9} className="text-white/20 group-hover:text-white/40" />
                            </span>
                            <span className="text-[13.5px] text-white/25 font-medium group-hover:text-white/45 transition-colors">
                                Something else
                            </span>
                        </button>
                    ) : (
                        <div className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white/[0.05] border border-white/10 mx-0.5">
                            <Pencil size={12} className="text-white/30 shrink-0" />
                            <input
                                autoFocus
                                type="text"
                                value={customInput}
                                onChange={(e) => setCustomInput(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleCustomSubmit();
                                    if (e.key === 'Escape') setIsCustom(false);
                                }}
                                placeholder="Type your answer..."
                                className="flex-1 bg-transparent border-none focus:ring-0 focus:outline-none text-[13px] text-white placeholder:text-white/20"
                            />
                            <button
                                onClick={handleCustomSubmit}
                                disabled={!customInput.trim()}
                                className="px-2.5 py-1 text-[11px] font-bold bg-white/10 text-white/70 rounded-lg disabled:opacity-30 hover:bg-white/20 transition-all"
                            >
                                OK
                            </button>
                        </div>
                    )}
                </div>

                <div className="flex items-center gap-2 px-4 py-3.5 border-t border-white/[0.06] mt-1">
                    <button
                        onClick={onSkip}
                        className="flex-1 py-2 text-[13px] font-semibold text-white/60 hover:text-white/80 bg-white/[0.05] hover:bg-white/[0.08] border border-white/[0.08] rounded-xl transition-all"
                    >
                        Skip
                    </button>
                    <button
                        onClick={handleNext}
                        disabled={!hasAnswer}
                        className={`flex-1 py-2 text-[13px] font-semibold rounded-xl border transition-all ${
                            hasAnswer
                                ? 'bg-white/[0.08] hover:bg-white/[0.12] text-white/80 border-white/[0.1] cursor-pointer'
                                : 'bg-transparent text-white/20 border-white/[0.06] cursor-not-allowed'
                        }`}
                    >
                        {currentPage === questions.length - 1 ? 'Submit' : 'Next'}
                    </button>
                </div>
            </div>
        </div>
    );
}
