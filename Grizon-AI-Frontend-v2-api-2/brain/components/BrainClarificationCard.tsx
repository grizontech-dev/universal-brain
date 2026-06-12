'use client';

import React, { useState, useEffect } from 'react';
import { Loader2, Pencil } from 'lucide-react';

interface ClarificationQuestion {
    id: string;
    text: string;
    options: string[];
    category?: string;
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
    const [customInput, setCustomInput] = useState('');
    const [isCustom, setIsCustom] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const question = questions[currentPage];

    // Clear selection when page changes
    useEffect(() => {
        setSelectedOption(null);
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

    const handleAnswer = (val: string) => {
        const newAnswers = [...answers];
        newAnswers[currentPage] = val;
        setAnswers(newAnswers);
        setSelectedOption(val);
        // No auto-advance — user must click Next/Submit
    };

    const handleNext = () => {
        const currentAnswers = [...answers];
        const currentAnswer = currentAnswers[currentPage] || selectedOption;
        if (!currentAnswer) return;
        currentAnswers[currentPage] = currentAnswer;
        setAnswers(currentAnswers);

        if (currentPage < questions.length - 1) {
            setCurrentPage(p => p + 1);
        } else {
            // Last question — submit all answers
            setIsSubmitting(true);
            const summary = currentAnswers.map((ans, i) => `${questions[i].text}: ${ans}`).join('\n');
            onSelect(summary);
        }
    };

    const handleCustomSubmit = () => {
        if (customInput.trim()) handleAnswer(customInput.trim());
    };

    const categoryLabel = question.category
        ? question.category.charAt(0).toUpperCase() + question.category.slice(1)
        : `Question ${currentPage + 1}`;

    const hasAnswer = !!answers[currentPage];

    return (
        <div className="w-full max-w-lg animate-in fade-in slide-in-from-bottom-2 duration-400 mb-6">
            <div className="bg-[#141414] border border-white/[0.1] rounded-2xl overflow-hidden shadow-2xl">

                {/* Header row: badge + category + counter */}
                <div className="flex items-center justify-between px-5 pt-4 pb-3">
                    <div className="flex items-center gap-2.5">
                        {/* Numbered blue badge */}
                        <span className="w-6 h-6 rounded-md bg-[#3b82f6] flex items-center justify-center text-[12px] font-bold text-white shrink-0">
                            {currentPage + 1}
                        </span>
                        <span className="text-[15px] font-semibold text-white/90 tracking-tight">
                            {categoryLabel}
                        </span>
                    </div>
                    {/* n/total counter */}
                    <span className="text-[13px] text-white/30 tabular-nums font-medium">
                        {currentPage + 1}/{questions.length}
                    </span>
                </div>

                {/* Question text */}
                <div className="px-5 pb-4">
                    <p className="text-[14px] text-white/60 leading-relaxed">
                        {question.text}
                    </p>
                </div>

                {/* Options list */}
                <div className="px-4 pb-2 space-y-1">
                    {question.options.map((opt, i) => {
                        const isSelected = selectedOption === opt || answers[currentPage] === opt;
                        return (
                            <button
                                key={i}
                                onClick={() => handleAnswer(opt)}
                                className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-left transition-all duration-150 group ${
                                    isSelected
                                        ? 'bg-white/[0.07]'
                                        : 'hover:bg-white/[0.04]'
                                }`}
                            >
                                {/* Radio circle */}
                                <span className={`w-[18px] h-[18px] shrink-0 rounded-full border-2 flex items-center justify-center transition-all ${
                                    isSelected
                                        ? 'border-white/60 bg-white/60'
                                        : 'border-white/20 group-hover:border-white/40'
                                }`}>
                                    {isSelected && (
                                        <span className="w-[7px] h-[7px] rounded-full bg-[#141414]" />
                                    )}
                                </span>
                                <span className={`text-[13.5px] font-medium leading-snug transition-colors ${
                                    isSelected ? 'text-white/90' : 'text-white/50 group-hover:text-white/70'
                                }`}>
                                    {opt}
                                </span>
                            </button>
                        );
                    })}

                    {/* "Something else" custom input */}
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

                {/* Footer: Skip + Next */}
                <div className="flex items-center gap-2 px-4 py-3.5 border-t border-white/[0.06] mt-1">
                    {/* Skip button */}
                    <button
                        onClick={onSkip}
                        className="flex-1 py-2 text-[13px] font-semibold text-white/60 hover:text-white/80 bg-white/[0.05] hover:bg-white/[0.08] border border-white/[0.08] rounded-xl transition-all"
                    >
                        Skip
                    </button>
                    {/* Next / Submit button */}
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
