'use client';

import { useState } from 'react';
import BrainBuildActivityFeed, { type BuildTodoItem } from './BrainBuildActivityFeed';
import BrainEditorCanvas from './BrainEditorCanvas';
import type { BuildActivity } from '../lib/buildActivity';
import { isBuildTodosComplete } from '../lib/buildActivity';
import { ArrowRight } from 'lucide-react';

export interface BrainBuildJob {
    jobId: string;
    syncUrl?: string;
    streamUrl?: string;
    framework?: string;
}

interface BrainBuildWorkspaceProps {
    activities: BuildActivity[];
    todos: BuildTodoItem[];
    job: BrainBuildJob | null;
    isSyncing?: boolean;
    workedSeconds?: number;
    onFollowUp?: (text: string) => void;
    followUpDisabled?: boolean;
}

export default function BrainBuildWorkspace({
    activities,
    todos,
    job,
    isSyncing = false,
    workedSeconds,
    onFollowUp,
    followUpDisabled,
}: BrainBuildWorkspaceProps) {
    const [followUp, setFollowUp] = useState('');

    const handleSend = () => {
        const t = followUp.trim();
        if (!t || !onFollowUp) return;
        onFollowUp(t);
        setFollowUp('');
    };

    const buildComplete = isBuildTodosComplete(todos);
    const isBuilding = !buildComplete || isSyncing;

    return (
        <div className="flex flex-1 min-h-0 w-full overflow-hidden">
            <aside className="w-full max-w-[400px] min-w-[320px] shrink-0 flex flex-col border-r border-white/10 bg-[#0a0a0a]">
                <BrainBuildActivityFeed
                    activities={activities}
                    todos={todos}
                    isSyncing={isSyncing}
                    workedSeconds={workedSeconds}
                />
                <div className="shrink-0 p-3 border-t border-white/10">
                    <div className="flex items-end gap-2 rounded-xl border border-white/10 bg-[#141414] px-3 py-2 focus-within:border-white/20">
                        <input
                            type="text"
                            value={followUp}
                            onChange={(e) => setFollowUp(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                            placeholder="Ask a follow-up…"
                            disabled={followUpDisabled}
                            className="flex-1 bg-transparent text-[13px] text-white placeholder:text-white/25 outline-none min-h-[36px]"
                        />
                        <button
                            type="button"
                            onClick={handleSend}
                            disabled={!followUp.trim() || followUpDisabled}
                            className="p-1.5 rounded-lg bg-white/10 text-white/50 hover:text-white disabled:opacity-30"
                        >
                            <ArrowRight size={16} />
                        </button>
                    </div>
                </div>
            </aside>

            <main className="flex-1 min-w-0 flex flex-col bg-[#0d0d0d] relative">
                {job && (
                    <BrainEditorCanvas
                        embedded
                        isOpen
                        buildJob={job}
                        buildComplete={buildComplete}
                        forceBuilding={isBuilding}
                        todoList={todos}
                    />
                )}
                {!job && (
                    <div className="flex-1 flex items-center justify-center text-white/30 text-sm">
                        Initializing workspace…
                    </div>
                )}
            </main>
        </div>
    );
}
