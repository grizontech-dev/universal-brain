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
                        className={`px-2 sm:px-2.5 py-0.5 sm:py-1 rounded-full text-[10px] sm:text-[11px] font-extrabold uppercase tracking-wider transition-all border shrink-0
                            ${active
                                ? 'bg-accent border-accent text-white shadow-md shadow-accent/30 scale-105'
                                : 'bg-surface-3 border-border-subtle text-text-muted hover:text-text-primary hover:border-border-default'
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

