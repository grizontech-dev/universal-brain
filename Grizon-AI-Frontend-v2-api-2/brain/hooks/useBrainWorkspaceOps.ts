'use client';

import { useEffect, useRef, useCallback } from 'react';
import type { WorkspaceOp } from '../lib/brainWebContainer';
import { onBrainPreviewReady } from '../lib/brainWebContainer';
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
            window.dispatchEvent(
                new CustomEvent('applyBrainWorkspaceOpsRemote', { detail: { ops: batch, jobId } })
            );
            window.dispatchEvent(new CustomEvent('refreshBrainFiles'));
        } catch (e) {
            console.error('[Sandbox] op batch failed:', e);
        } finally {
            processingRef.current = false;
            if (queueRef.current.length > 0) drainQueue();
        }
    }, [jobId]);

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
                    if (data.progress_msg || data.todoList) {
                        const parsed = data.progress_msg ? parseProgressToActivity(String(data.progress_msg)) : null;
                        if (parsed || data.todoList) {
                            window.dispatchEvent(
                                new CustomEvent('updateSandboxProgress', {
                                    detail: { 
                                        progressMsg: data.progress_msg,
                                        todoList: data.todoList
                                    },
                                })
                            );
                        }
                    }
                    if (data.activities?.length) {
                        window.dispatchEvent(
                            new CustomEvent('brainBuildActivity', { detail: { activities: data.activities } })
                        );
                    }
                    if (data.activities?.length) {
                        for (const act of data.activities) {
                            const tunnelMatch = String(act.detail || act.label || '').match(/https:\/\/[\w-]+\.trycloudflare\.com/);
                            if (tunnelMatch) {
                                window.dispatchEvent(
                                    new CustomEvent('brainPreviewReady', { detail: { url: tunnelMatch[0], streamUrl: tunnelMatch[0] } })
                                );
                                break;
                            }
                        }
                    }
                    if (data.progress_msg) {
                        const tunnelMatch = String(data.progress_msg).match(/https:\/\/[\w-]+\.trycloudflare\.com/);
                        if (tunnelMatch) {
                            window.dispatchEvent(
                                new CustomEvent('brainPreviewReady', { detail: { url: tunnelMatch[0], streamUrl: tunnelMatch[0] } })
                            );
                        }
                    }
                } else if (data.type === 'workspace_op') {
                    enqueueOps([data]);
                } else if (data.type === 'file_change') {
                    window.dispatchEvent(new CustomEvent('refreshBrainFiles'));
                } else if (data.type === 'sandbox_ready' || data.type === 'tunnel_ready') {
                    const url = data.tunnel_url || data.url || data.stream_url;
                    if (url) {
                        window.dispatchEvent(
                            new CustomEvent('brainPreviewReady', { detail: { url, streamUrl: url } })
                        );
                    }
                } else if (data.tunnel_url) {
                    window.dispatchEvent(
                        new CustomEvent('brainPreviewReady', { detail: { url: data.tunnel_url, streamUrl: data.tunnel_url } })
                    );
                }
            } catch (err) {
                console.error('[Sandbox] WS parse error:', err);
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
