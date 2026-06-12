export type BrainFrameworkId = 'react' | 'next';

export interface BrainFrameworkOption {
    id: BrainFrameworkId;
    label: string;
    template: string;
    description: string;
}

export const BRAIN_FRAMEWORKS: BrainFrameworkOption[] = [
    {
        id: 'react',
        label: 'React',
        template: 'react-template',
        description: 'Vite + React in frontend/',
    },
    {
        id: 'next',
        label: 'Next.js',
        template: 'next-template',
        description: 'Next.js App Router in frontend/',
    },
];

export const DEFAULT_BRAIN_FRAMEWORK: BrainFrameworkId = 'react';

export function normalizeBrainFramework(value?: string | null): BrainFrameworkId {
    if (value === 'next' || value === 'nextjs') return 'next';
    return 'react';
}
