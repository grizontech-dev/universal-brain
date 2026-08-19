'use client';

import { brainApiFetch } from './brainApiBase';
import type { WorkspaceOp } from './brainWebContainer';
import type { BuildTodoItem } from './buildActivity';
import { mergeTodosFromPlan, markAllTodosComplete, isBuildTodosComplete } from './buildActivity';

export type ResumeBrainPayload = {
    workspace_id: string;
    framework: string;
    todos: BuildTodoItem[];
    current_task_index: number;
    build_complete: boolean;
    build_active?: boolean;
    workspace_ops: WorkspaceOp[];
    startup_ops: WorkspaceOp[];
    sync_url: string;
    tunnel_url?: string;
};

export async function fetchResumePayload(
    workspaceId: string,
    framework: string,
    userId?: string | null
): Promise<ResumeBrainPayload | null> {
    const params = new URLSearchParams({ framework });
    if (userId) params.set('user_id', userId);
    const res = await brainApiFetch(`sandbox/resume/${workspaceId}?${params}`);
    if (!res?.ok) return null;
    return (await res.json()) as ResumeBrainPayload;
}

export type ApplyResumeOptions = {
    onProgress?: (msg: string) => void;
};

export async function applyResumeToWebContainer(
    payload: ResumeBrainPayload,
    opts?: ApplyResumeOptions
): Promise<void> {
    opts?.onProgress?.('Restoring project files…');

    const allOps = [...(payload.workspace_ops || []), ...(payload.startup_ops || [])];
    if (allOps.length) {
        window.dispatchEvent(
            new CustomEvent('applyBrainWorkspaceOps', { detail: { ops: allOps } })
        );
    }
    window.dispatchEvent(new CustomEvent('refreshBrainFiles'));

    if (payload.build_complete) {
        opts?.onProgress?.('Starting dev servers (npm install → npm run dev)…');
    }
}

export function normalizeTodosForResume(
    todos: BuildTodoItem[],
    payload: ResumeBrainPayload
): BuildTodoItem[] {
    if (payload.build_complete) {
        return markAllTodosComplete(todos);
    }
    if (todos.some(t => t.status === 'completed' || t.status === 'executing')) {
        return todos;
    }
    return mergeTodosFromPlan(todos, payload.current_task_index, 'building');
}

export function shouldStreamResumeBuild(todos: BuildTodoItem[], payload: ResumeBrainPayload): boolean {
    if (payload.build_complete) return false;
    return !isBuildTodosComplete(todos);
}
