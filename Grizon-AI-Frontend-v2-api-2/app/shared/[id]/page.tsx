'use client';

import { use } from 'react';
import { Globe } from 'lucide-react';

export default function SharedArtifactPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = use(params);

    return (
        <div className="min-h-screen bg-app flex flex-col items-center justify-center gap-6 p-8 text-center">
            <div className="w-20 h-20 rounded-[2rem] bg-surface-2 flex items-center justify-center text-text-faint">
                <Globe size={40} />
            </div>
            <div>
                <h1 className="text-2xl font-black text-text-primary uppercase tracking-wider mb-2">Shared links disabled</h1>
                <p className="text-text-muted max-w-md mx-auto text-sm">
                    This UI-only build does not load shared artifacts. Requested id:{' '}
                    <span className="text-text-secondary font-mono text-xs">{id}</span>
                </p>
            </div>
            <a
                href="/"
                className="px-8 py-4 bg-surface-2 border border-border-default rounded-2xl text-text-secondary hover:text-text-primary hover:bg-surface-3 transition-all text-xs font-black uppercase tracking-widest"
            >
                Return home
            </a>
        </div>
    );
}
