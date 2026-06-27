'use client';

import type { WorkspaceOp } from './brainWebContainer';
import { brainApiFetch } from './brainApiBase';
import { type BrainFrameworkId } from '../constants/frameworks';

export async function fetchTemplateOps(
    framework: BrainFrameworkId,
    options?: { frontendOnly?: boolean }
): Promise<WorkspaceOp[]> {
    try {
        const params = new URLSearchParams({
            framework,
            ...(options?.frontendOnly ? { frontend_only: 'true' } : {}),
        });
        const res = await brainApiFetch(`sandbox/template-ops?${params}`);
        if (!res?.ok) return [];
        const data = await res.json();
        return (data.ops || []) as WorkspaceOp[];
    } catch {
        return [];
    }
}

export async function bootstrapDefaultTemplates(framework: BrainFrameworkId) {
    try {
        const ops = await fetchTemplateOps(framework, { frontendOnly: false });
        if (!ops.length) return ops;
        window.dispatchEvent(
            new CustomEvent('applyBrainWorkspaceOps', { detail: { ops } })
        );
        window.dispatchEvent(new CustomEvent('refreshBrainFiles'));
        return ops;
    } catch (err) {
        console.warn('[templateBootstrap] skipped:', err);
        return [];
    }
}

export async function applyFrontendTemplate(framework: BrainFrameworkId) {
    try {
        const ops = await fetchTemplateOps(framework, { frontendOnly: true });
        if (ops.length) {
            window.dispatchEvent(
                new CustomEvent('applyBrainWorkspaceOps', { detail: { ops } })
            );
            window.dispatchEvent(new CustomEvent('refreshBrainFiles'));
        }
        return ops;
    } catch {
        return [];
    }
}
