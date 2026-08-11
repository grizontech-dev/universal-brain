'use client';

import { useEffect, useRef, useCallback } from 'react';
import type { WorkspaceOp } from '../lib/brainWebContainer';
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

        // Rewrite syncUrl: backend sends ws://localhost:8001 but browser needs real host
        let wsUrl = syncUrl;
        try {
            const apiBase = (process.env.NEXT_PUBLIC_BRAIN_API_URL || 'http://127.0.0.1:8001').replace(/\/$/, '');
            const wsBase = apiBase.replace(/^http/, 'ws');
            const urlObj = new URL(syncUrl);
            
            if (urlObj.hostname === 'localhost' || urlObj.hostname === '127.0.0.1') {
                const baseObj = new URL(wsBase);
                urlObj.hostname = baseObj.hostname;
                urlObj.port = baseObj.port || (baseObj.protocol === 'wss:' ? '443' : '80');
                urlObj.protocol = baseObj.protocol;
                wsUrl = urlObj.toString();
            } else if (wsBase.startsWith('wss:') && urlObj.protocol === 'ws:') {
                // Force WSS to prevent mixed content on GCP/Vercel
                urlObj.protocol = 'wss:';
                if (urlObj.port === '80') urlObj.port = '443';
                wsUrl = urlObj.toString();
            }
        } catch { /* keep original syncUrl */ }

        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => ws.send('ping');

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.type === 'workspace_ops' && data.ops) {
                    enqueueOps(data.ops);
                    const todoList = data.todoList || data.plan;
                    
                    if (data.progress_msg || todoList) {
                        const parsed = data.progress_msg ? parseProgressToActivity(String(data.progress_msg)) : null;
                        if (parsed || todoList) {
                            let pm = data.progress_msg;
                            // If backend sent current_task_index, inject it so BrainMessages can pick it up
                            if (data.current_task_index !== undefined) {
                                if (typeof pm === 'string' && pm.startsWith('{')) {
                                    try {
                                        const pmObj = JSON.parse(pm);
                                        pmObj.taskId = data.current_task_index;
                                        pm = JSON.stringify(pmObj);
                                    } catch {}
                                } else if (!pm) {
                                    pm = JSON.stringify({ taskId: data.current_task_index });
                                }
                            }
                            window.dispatchEvent(
                                new CustomEvent('updateSandboxProgress', {
                                    detail: { 
                                        progressMsg: pm,
                                        todoList: todoList
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
                    if (data.sandbox_job) {
                        // Backend detached runner has updated the sandbox job (e.g. tunnel_url is ready)
                        const jobData = {
                            jobId: data.sandbox_job.job_id || data.sandbox_job.jobId || jobId,
                            syncUrl: data.sandbox_job.sync_url || data.sandbox_job.syncUrl || syncUrl,
                            streamUrl: data.sandbox_job.tunnel_url || data.sandbox_job.stream_url || data.sandbox_job.streamUrl,
                            framework: data.sandbox_job.framework,
                            todoList: todoList,
                            runtime: data.sandbox_job.runtime || 'sandbox_mcp',
                        };
                        // Dispatch openBrainEditor to update the buildJob state in BrainMessages
                        window.dispatchEvent(new CustomEvent('openBrainEditor', { detail: jobData }));
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
                } else if (data.type === 'task_orchestrator' && data.task_orchestrator) {
                    const orch = data.task_orchestrator;
                    let pm = orch.progress_msg || '{}';
                    if (orch.current_task_index !== undefined) {
                        if (typeof pm === 'string' && pm.startsWith('{')) {
                            try {
                                const pmObj = JSON.parse(pm);
                                pmObj.taskId = orch.current_task_index;
                                pm = JSON.stringify(pmObj);
                            } catch {}
                        } else if (typeof pm === 'string') {
                            pm = JSON.stringify({ taskId: orch.current_task_index, type: 'task_started', text: pm });
                        }
                    }
                    window.dispatchEvent(
                        new CustomEvent('updateSandboxProgress', {
                            detail: {
                                progressMsg: pm,
                                todoList: orch.plan
                            }
                        })
                    );
                } else if (data.type === 'task_failed' || data.type === 'build_error') {
                    window.dispatchEvent(
                        new CustomEvent('updateSandboxProgress', {
                            detail: {
                                progressMsg: JSON.stringify({ error: data.reason || data.error, taskId: data.task_index }),
                                todoList: data.plan
                            }
                        })
                    );
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

    return { enqueueOps };
}
