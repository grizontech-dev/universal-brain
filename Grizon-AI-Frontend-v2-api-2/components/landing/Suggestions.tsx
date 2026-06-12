import React from 'react';

interface SuggestionProps {
    onSelect: (text: string) => void;
}

export default function Suggestions({ onSelect }: SuggestionProps) {
    const suggestions = [
        {
            text: "Write a project proposal",
            icon: (
                <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--c-text-faint)' }}>
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="16" y1="13" x2="8" y2="13" />
                    <line x1="16" y1="17" x2="8" y2="17" />
                </svg>
            )
        },
        {
            text: "Analyze data for insights",
            icon: (
                <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--c-text-faint)' }}>
                    <path d="M21.21 15.89A10 10 0 1 1 8 2.83" />
                    <path d="M22 12A10 10 0 0 0 12 2v10z" />
                </svg>
            )
        },
        {
            text: "Debug my code",
            icon: (
                <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--c-text-faint)' }}>
                    <polyline points="16 18 22 12 16 6" />
                    <polyline points="8 6 2 12 8 18" />
                </svg>
            )
        },
        {
            text: "Brainstorm creative ideas",
            icon: (
                <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--c-text-faint)' }}>
                    <circle cx="12" cy="12" r="10" />
                    <line x1="2" y1="12" x2="22" y2="12" />
                    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                </svg>
            )
        },
    ];

    return (
        <>
            <div className="suggestions-grid grid grid-cols-2 gap-2.5 mt-6 w-full animate-in animate-in-delay-3">
                {suggestions.map((s, i) => (
                    <button
                        key={i}
                        className="group flex items-center gap-3 px-4 py-3.5 rounded-xl transition-all text-[14px] text-left font-medium"
                        onClick={() => onSelect(s.text)}
                        style={{
                            fontFamily: 'var(--font-inter), Inter, sans-serif',
                            background: 'var(--c-surface-2)',
                            border: '1px solid var(--c-border-subtle)',
                            color: 'var(--c-text-muted)',
                        }}
                        onMouseEnter={(e) => {
                            (e.currentTarget as HTMLButtonElement).style.background = 'var(--c-accent-soft)';
                            (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--c-accent)';
                            (e.currentTarget as HTMLButtonElement).style.color = 'var(--c-text-secondary)';
                            const icon = (e.currentTarget as HTMLButtonElement).querySelector('svg');
                            if (icon) {
                                (icon as any).style.color = 'var(--c-accent)';
                            }
                        }}
                        onMouseLeave={(e) => {
                            (e.currentTarget as HTMLButtonElement).style.background = 'var(--c-surface-2)';
                            (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--c-border-subtle)';
                            (e.currentTarget as HTMLButtonElement).style.color = 'var(--c-text-muted)';
                            const icon = (e.currentTarget as HTMLButtonElement).querySelector('svg');
                            if (icon) {
                                (icon as any).style.color = 'var(--c-text-faint)';
                            }
                        }}
                    >
                        {s.icon}
                        <span>{s.text}</span>
                    </button>
                ))}
            </div>

            {/* Responsive styles for mobile */}
            <style jsx>{`
                @media (max-width: 640px) {
                    .suggestions-grid {
                        grid-template-columns: 1fr !important;
                        padding-left: 20px;
                        padding-right: 20px;
                    }
                }
            `}</style>
        </>
    );
}
