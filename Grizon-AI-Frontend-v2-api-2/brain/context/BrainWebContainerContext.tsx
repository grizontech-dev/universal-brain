'use client';

import React, { createContext, useContext, useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { getBrainWebContainer, isWebContainerBooted, type WorkspaceOp } from '../lib/brainWebContainer';
import { useBrainWorkspaceOps } from '../hooks/useBrainWorkspaceOps';

interface BrainWebContainerContextValue {
    jobId: string | null;
    syncUrl: string | null;
    previewUrl: string | null;
    previewPort: number | null;
    isBooting: boolean;
    isReady: boolean;
    setWorkspace: (jobId: string, syncUrl?: string | null) => void;
    applyOps: (ops: WorkspaceOp[]) => void;
}

const BrainWebContainerContext = createContext<BrainWebContainerContextValue | null>(null);

export function BrainWebContainerProvider({ children }: { children: React.ReactNode }) {
    const [jobId, setJobId] = useState<string | null>(null);
    const [syncUrl, setSyncUrl] = useState<string | null>(null);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [previewPort, setPreviewPort] = useState<number | null>(null);
    const [isBooting, setIsBooting] = useState(false);
    const [isReady, setIsReady] = useState(false);
    const workspaceKeyRef = useRef<string | null>(null);

    const { enqueueOps } = useBrainWorkspaceOps(jobId, syncUrl);

    const setWorkspace = useCallback((id: string, sync?: string | null) => {
        const key = `${id}|${sync ?? ''}`;
        const unchanged = workspaceKeyRef.current === key;
        workspaceKeyRef.current = key;
        setJobId(id);
        if (sync !== undefined) setSyncUrl(sync);
        if (unchanged && (isReady || isWebContainerBooted())) {
            if (!isReady && isWebContainerBooted()) setIsReady(true);
            return;
        }
        setIsBooting(true);
        getBrainWebContainer()
            .then(() => {
                setIsReady(true);
                setIsBooting(false);
            })
            .catch((e) => {
                if (isWebContainerBooted()) {
                    setIsReady(true);
                    setIsBooting(false);
                    return;
                }
                console.warn('[WebContainer] boot skipped (will use API file tree):', e);
                setIsBooting(false);
            });
    }, [isReady]);

    const applyOps = useCallback(
        (ops: WorkspaceOp[]) => {
            enqueueOps(ops);
        },
        [enqueueOps]
    );

    useEffect(() => {
        const onPreview = (e: Event) => {
            const detail = (e as CustomEvent).detail || {};
            const url = detail.url || detail.streamUrl;
            const port = typeof detail.port === 'number' ? detail.port : null;
            if (url) {
                setPreviewUrl(url);
                if (port) setPreviewPort(port);
            }
        };
        window.addEventListener('brainPreviewReady', onPreview);
        return () => window.removeEventListener('brainPreviewReady', onPreview);
    }, []);

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
        () => ({ jobId, syncUrl, previewUrl, previewPort, isBooting, isReady, setWorkspace, applyOps }),
        [jobId, syncUrl, previewUrl, previewPort, isBooting, isReady, setWorkspace, applyOps]
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
