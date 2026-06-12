'use client';

import { BRAIN_FRAMEWORKS, type BrainFrameworkId } from '../constants/frameworks';

interface BrainFrameworkSelectorProps {
    value: BrainFrameworkId;
    onChange: (id: BrainFrameworkId) => void;
    disabled?: boolean;
    compact?: boolean;
}

export default function BrainFrameworkSelector({
    value,
    onChange,
    disabled,
    compact,
}: BrainFrameworkSelectorProps) {
    return (
        <div
            className={`flex items-center gap-1 ${compact ? '' : 'flex-wrap'}`}
            role="group"
            aria-label="Frontend framework"
        >
            {BRAIN_FRAMEWORKS.map((fw) => {
                const active = value === fw.id;
                return (
                    <button
                        key={fw.id}
                        type="button"
                        disabled={disabled}
                        onClick={() => onChange(fw.id)}
                        title={fw.description}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-bold uppercase tracking-wider transition-all border shrink-0
                            ${active
                                ? 'bg-[#976df8]/20 border-[#976df8]/40 text-[#c4b5fd]'
                                : 'bg-white/5 border-white/10 text-white/40 hover:text-white/70 hover:border-white/20'
                            }
                            ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
                    >
                        {fw.label}
                    </button>
                );
            })}
        </div>
    );
}
