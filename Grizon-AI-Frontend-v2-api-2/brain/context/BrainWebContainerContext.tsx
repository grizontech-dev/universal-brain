'use client';

import React, { createContext, useContext, useState, useCallback, useEffect, useRef, useMemo } from 'react';
import type { WorkspaceOp } from '../lib/brainWebContainer';
import { useBrainWorkspaceOps } from '../hooks/useBrainWorkspaceOps';

interface BrainWebContainerContextValue {
    jobId: string | null;
    syncUrl: string | null;
    setWorkspace: (jobId: string, syncUrl?: string | null) => void;
    applyOps: (ops: WorkspaceOp[]) => void;
}

const BrainWebContainerContext = createContext<BrainWebContainerContextValue | null>(null);

export function BrainWebContainerProvider({ children }: { children: React.ReactNode }) {
    const [jobId, setJobId] = useState<string | null>(null);
    const [syncUrl, setSyncUrl] = useState<string | null>(null);
    const workspaceKeyRef = useRef<string | null>(null);

    const { enqueueOps } = useBrainWorkspaceOps(jobId, syncUrl);

    const setWorkspace = useCallback((id: string, sync?: string | null) => {
        const key = `${id}|${sync ?? ''}`;
        const unchanged = workspaceKeyRef.current === key;
        workspaceKeyRef.current = key;
        setJobId(id);
        if (sync !== undefined) setSyncUrl(sync);
        if (unchanged) return;
    }, []);

    const applyOps = useCallback(
        (ops: WorkspaceOp[]) => {
            enqueueOps(ops);
        },
        [enqueueOps]
    );

    useEffect(() => {
        const onOpen = (e: Event) => {
            const d = (e as CustomEvent).detail || {};
            if (d.jobId) {
                setWorkspace(d.jobId, d.syncUrl ?? null);
            }
        };
        window.addEventListener('openBrainEditor', onOpen);
        window.addEventListener('openSandboxCanvas', onOpen);
        return () => {
            window.removeEventListener('openBrainEditor', onOpen);
            window.removeEventListener('openSandboxCanvas', onOpen);
        };
    }, [setWorkspace]);

    const value = useMemo(
        () => ({ jobId, syncUrl, setWorkspace, applyOps }),
        [jobId, syncUrl, setWorkspace, applyOps]
    );

    return (
        <BrainWebContainerContext.Provider value={value}>
            {children}
        </BrainWebContainerContext.Provider>
    );
}

export function useBrainWebContainer() {
    const ctx = useContext(BrainWebContainerContext);
    if (!ctx) throw new Error('useBrainWebContainer must be used within BrainWebContainerProvider');
    return ctx;
}
