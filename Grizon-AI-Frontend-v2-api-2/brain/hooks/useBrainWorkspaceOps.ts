'use client';

import { useEffect, useRef, useCallback } from 'react';
import {
    applyWorkspaceOps,
    type WorkspaceOp,
    onBrainPreviewReady,
} from '../lib/brainWebContainer';
import { parseProgressToActivity } from '../lib/buildActivity';

export function useBrainWorkspaceOps(jobId: string | null, syncUrl: string | null) {
    const wsRef = useRef<WebSocket | null>(null);
    const queueRef = useRef<WorkspaceOp[]>([]);
    const processingRef = useRef(false);

    const drainQueue = useCallback(async () => {
        if (processingRef.current || queueRef.current.length === 0) return;
        processingRef.current = true;
        const batch = queueRef.current.splice(0, queueRef.current.length);
        try {
            await applyWorkspaceOps(batch);
            window.dispatchEvent(new CustomEvent('refreshBrainFiles'));
        } catch (e) {
            console.error('[WebContainer] op batch failed:', e);
        } finally {
            processingRef.current = false;
            if (queueRef.current.length > 0) drainQueue();
        }
    }, []);

    const enqueueOps = useCallback(
        (ops: WorkspaceOp[]) => {
            if (!ops?.length) return;
            queueRef.current.push(...ops);
            drainQueue();
        },
        [drainQueue]
    );

    useEffect(() => {
        const handleOpsEvent = (e: Event) => {
            const detail = (e as CustomEvent).detail;
            if (detail?.ops) enqueueOps(detail.ops);
        };
        window.addEventListener('applyBrainWorkspaceOps', handleOpsEvent);
        return () => window.removeEventListener('applyBrainWorkspaceOps', handleOpsEvent);
    }, [enqueueOps]);

    useEffect(() => {
        if (!syncUrl || !jobId) return;

        const ws = new WebSocket(syncUrl);
        wsRef.current = ws;

        ws.onopen = () => ws.send('ping');

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.type === 'workspace_ops' && data.ops) {
                    enqueueOps(data.ops);
                    if (data.progress_msg) {
                        const parsed = parseProgressToActivity(String(data.progress_msg));
                        if (parsed) {
                            window.dispatchEvent(
                                new CustomEvent('updateSandboxProgress', {
                                    detail: { progressMsg: data.progress_msg },
                                })
                            );
                        }
                    }
                    if (data.activities?.length) {
                        window.dispatchEvent(
                            new CustomEvent('brainBuildActivity', { detail: { activities: data.activities } })
                        );
                    }
                } else if (data.type === 'workspace_op') {
                    enqueueOps([data]);
                } else if (data.type === 'file_change') {
                    window.dispatchEvent(new CustomEvent('refreshBrainFiles'));
                }
            } catch (err) {
                console.error('[WebContainer] WS parse error:', err);
            }
        };

        return () => {
            ws.close();
            wsRef.current = null;
        };
    }, [syncUrl, jobId, enqueueOps]);

    useEffect(() => {
        const unsub = onBrainPreviewReady((url) => {
            window.dispatchEvent(
                new CustomEvent('brainPreviewReady', { detail: { url, streamUrl: url } })
            );
        });
        return () => {
            unsub();
        };
    }, []);

    return { enqueueOps };
}
