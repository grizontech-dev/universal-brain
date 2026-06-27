'use client';

import { brainApiFetch } from './brainApiBase';

export type WorkspaceOp =
    | { op: 'write_file'; path: string; content: string }
    | { op: 'delete_file'; path: string }
    | { op: 'mkdir'; path: string }
    | { op: 'install_packages'; packages: string[]; cwd?: string; dev?: boolean }
    | { op: 'run'; command: string; cwd?: string; background?: boolean };

export interface FileNode {
    name: string;
    type: 'file' | 'folder';
    path: string;
    content?: string;
    language?: string;
    children?: FileNode[];
    isOpen?: boolean;
}

const outputListeners = new Set<(line: string) => void>();
const outputBuffer: string[] = [];

export function onBrainTerminalOutput(cb: (line: string) => void) {
    outputListeners.add(cb);
    outputBuffer.forEach(line => cb(line));
    return () => outputListeners.delete(cb);
}

export function emitOutput(line: string) {
    outputBuffer.push(line);
    if (outputBuffer.length > 500) outputBuffer.shift();
    outputListeners.forEach(fn => fn(line));
}

export function sortWorkspaceOps(ops: WorkspaceOp[]): WorkspaceOp[] {
    const mkdirs: WorkspaceOp[] = [];
    const writes: WorkspaceOp[] = [];
    const installs: WorkspaceOp[] = [];
    const runs: WorkspaceOp[] = [];
    const deletes: WorkspaceOp[] = [];
    for (const op of ops) {
        if (op.op === 'mkdir') mkdirs.push(op);
        else if (op.op === 'write_file') writes.push(op);
        else if (op.op === 'install_packages') installs.push(op);
        else if (op.op === 'delete_file') deletes.push(op);
        else runs.push(op);
    }
    return [...mkdirs, ...writes, ...installs, ...runs, ...deletes];
}

export async function applyWorkspaceOp(
    _wc: null,
    op: WorkspaceOp,
    jobId: string | null,
    onOutput?: (line: string) => void
): Promise<{ exitCode?: number }> {
    const handler = onOutput || emitOutput;

    switch (op.op) {
        case 'write_file':
            return {};
        case 'mkdir':
            return {};
        case 'delete_file':
            return {};
        case 'install_packages': {
            const cmd = `npm install --no-audit --no-fund --legacy-peer-deps ${op.packages.join(' ')}`;
            handler(`[sandbox] ${cmd}\n`);
            return {};
        }
        case 'run': {
            const cmd = op.command.trim();
            if (!cmd || cmd === 'true' || cmd === ':') return {};
            handler(`[sandbox] ${cmd}\n`);
            return {};
        }
        default:
            return {};
    }
}

export async function applyWorkspaceOps(
    ops: WorkspaceOp[],
    onOutput?: (line: string) => void,
    jobId?: string | null
): Promise<null> {
    const sorted = sortWorkspaceOps(ops);
    for (const op of sorted) {
        await applyWorkspaceOp(null, op, jobId ?? null, onOutput);
    }
    return null;
}

export async function listWebContainerFiles(
    _wc: null,
    dirPath = '.',
    jobId?: string
): Promise<FileNode[]> {
    if (!jobId) return [];
    try {
        const q = new URLSearchParams({ workspace_id: jobId, path: dirPath });
        const res = await brainApiFetch(`sandbox/list-files?${q}`);
        if (!res?.ok) return [];
        const data = await res.json();
        return (data.files || []) as FileNode[];
    } catch {
        return [];
    }
}

export async function readWebContainerFile(_wc: null, path: string, jobId?: string): Promise<string> {
    if (!jobId) return '';
    try {
        const q = new URLSearchParams({ workspace_id: jobId, path });
        const res = await brainApiFetch(`sandbox/read-file?${q}`);
        if (!res?.ok) return '';
        const data = await res.json();
        return data.content || '';
    } catch {
        return '';
    }
}

export async function mcpSaveFiles(
    sessionId: string,
    files: { filename: string; code: string }[]
): Promise<{ ok: boolean; saved?: number; error?: string }> {
    try {
        const res = await brainApiFetch('sandbox/mcp/save-files', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ session_id: sessionId, files }),
        });
        if (!res?.ok) {
            const err = await res?.json().catch(() => ({}));
            return { ok: false, error: err.detail || 'Save failed' };
        }
        return await res.json();
    } catch (e) {
        return { ok: false, error: String(e) };
    }
}

export async function mcpExecute(
    sessionId: string,
    entrypoint: string,
    archiveB64: string
): Promise<{ ok: boolean; tunnel_url?: string; status?: string; execution_output?: string; error?: string }> {
    try {
        const res = await brainApiFetch('sandbox/mcp/execute', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                session_id: sessionId,
                entrypoint,
                archive_b64: archiveB64,
            }),
        });
        if (!res?.ok) {
            const err = await res?.json().catch(() => ({}));
            return { ok: false, error: err.detail || 'Execute failed' };
        }
        return await res.json();
    } catch (e) {
        return { ok: false, error: String(e) };
    }
}

export async function mcpSaveAndExecute(
    sessionId: string,
    entrypoint: string,
    files: { filename: string; code: string }[]
): Promise<{ ok: boolean; tunnel_url?: string; status?: string; execution_output?: string; saved?: number; error?: string }> {
    try {
        const res = await brainApiFetch('sandbox/mcp/save-and-execute', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ session_id: sessionId, entrypoint, files }),
        });
        if (!res?.ok) {
            const err = await res?.json().catch(() => ({}));
            return { ok: false, error: err.detail || 'Save and execute failed' };
        }
        return await res.json();
    } catch (e) {
        return { ok: false, error: String(e) };
    }
}

export async function mcpGetStatus(sessionId: string): Promise<{ ok: boolean; result?: string; error?: string }> {
    try {
        const q = new URLSearchParams({ session_id: sessionId });
        const res = await brainApiFetch(`sandbox/mcp/status?${q}`);
        if (!res?.ok) {
            const err = await res?.json().catch(() => ({}));
            return { ok: false, error: err.detail || 'Status check failed' };
        }
        return await res.json();
    } catch (e) {
        return { ok: false, error: String(e) };
    }
}

export async function mcpDeleteSandbox(sessionId: string): Promise<{ ok: boolean; result?: string; error?: string }> {
    try {
        const res = await brainApiFetch('sandbox/mcp/sandbox', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ session_id: sessionId }),
        });
        if (!res?.ok) {
            const err = await res?.json().catch(() => ({}));
            return { ok: false, error: err.detail || 'Delete failed' };
        }
        return await res.json();
    } catch (e) {
        return { ok: false, error: String(e) };
    }
}
