'use client';

import type { WorkspaceOp } from './brainWebContainer';
import { applyWorkspaceOps, isWebContainerBooted, getBrainWebContainer } from './brainWebContainer';
import { normalizeBrainFramework, type BrainFrameworkId } from '../constants/frameworks';
import { brainApiFetch } from './brainApiBase';

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

/** Skip when backend already bootstrapped via workspace_ops during init_sandbox */
export async function bootstrapDefaultTemplates(framework: BrainFrameworkId) {
    try {
        const ops = await fetchTemplateOps(framework, { frontendOnly: false });
        if (!ops.length) return ops;
        if (!isWebContainerBooted()) {
            await getBrainWebContainer();
        }
        await applyWorkspaceOps(ops);
        window.dispatchEvent(new CustomEvent('refreshBrainFiles'));
        return ops;
    } catch (err) {
        console.warn('[templateBootstrap] skipped — WebContainer not available:', err);
        return [];
    }
}

export async function applyFrontendTemplate(framework: BrainFrameworkId) {
    try {
        const ops = await fetchTemplateOps(framework, { frontendOnly: true });
        if (ops.length) {
            await applyWorkspaceOps(ops);
            window.dispatchEvent(new CustomEvent('refreshBrainFiles'));
        }
        return ops;
    } catch {
        return [];
    }
}
