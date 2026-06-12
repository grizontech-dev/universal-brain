'use client';

import type { WebContainer } from '@webcontainer/api';
import {
    devServerKey,
    isBareNpmInstall,
    isLongRunningDevCommand,
    parseSpawnSpec,
    shouldSkipWebContainerCommand,
} from './commandPolicy';

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

const WC_GLOBAL_KEY = '__grizonBrainWebContainer';
const WC_BOOT_KEY = '__grizonBrainWebContainerBoot';

type GrizonWindow = Window & {
    [WC_GLOBAL_KEY]?: WebContainer;
    [WC_BOOT_KEY]?: Promise<WebContainer>;
};

let webcontainerInstance: WebContainer | null = null;
let bootPromise: Promise<WebContainer> | null = null;
let activePreviewPort = 0;

function getGrizonWindow(): GrizonWindow | null {
    return typeof window !== 'undefined' ? (window as GrizonWindow) : null;
}

function isSingleWebContainerError(err: unknown): boolean {
    const msg = err instanceof Error ? err.message : String(err);
    return msg.includes('Only a single WebContainer instance');
}

export function isWebContainerBooted(): boolean {
    if (webcontainerInstance) return true;
    const w = getGrizonWindow();
    return !!w?.[WC_GLOBAL_KEY];
}
const previewListeners = new Set<(url: string, port: number) => void>();
const outputListeners = new Set<(line: string) => void>();

/** Prefer Vite (5173) over Express API (3001) for the iframe preview */
function previewPortPriority(port: number): number {
    if (port === 5173) return 100;
    if (port >= 5174 && port <= 5180) return 99;
    if (port === 3000 || port === 4173) return 90;
    if (port === 3001 || port === 8080 || port === 8000) return 10;
    return 50;
}

export function isFrontendPreviewPort(port: number): boolean {
    return previewPortPriority(port) >= 90;
}

function shouldEmitPreview(port: number): boolean {
    if (activePreviewPort === 0) return true;
    return previewPortPriority(port) >= previewPortPriority(activePreviewPort);
}

function emitBuildRunnerComplete(port: number, url: string) {
    if (typeof window === 'undefined') return;
    if (!isFrontendPreviewPort(port)) return;
    window.dispatchEvent(
        new CustomEvent('brainBuildRunnerComplete', {
            detail: { port, url },
        })
    );
}

function emitPreviewIfPreferred(url: string, port: number) {
    if (!shouldEmitPreview(port)) {
        console.log(`[WebContainer] ignoring server-ready on port ${port} (keeping preview on ${activePreviewPort})`);
        return;
    }
    activePreviewPort = port;
    emitPreview(url, port);
    emitBuildRunnerComplete(port, url);
}

export function onBrainPreviewReady(cb: (url: string, port: number) => void) {
    previewListeners.add(cb);
    return () => previewListeners.delete(cb);
}

const outputBuffer: string[] = [];

export function onBrainTerminalOutput(cb: (line: string) => void) {
    outputListeners.add(cb);
    outputBuffer.forEach(line => cb(line));
    return () => outputListeners.delete(cb);
}

function emitPreview(url: string, port: number) {
    previewListeners.forEach((cb) => cb(url, port));
    if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('brainPreviewReady', { detail: { url, streamUrl: url, port } }));
    }
}

export function emitOutput(line: string) {
    outputBuffer.push(line);
    if (outputBuffer.length > 500) outputBuffer.shift();
    outputListeners.forEach(fn => fn(line));

    // Automatically trigger preview refresh when Vite/Next.js finishes starting
    if (
        line.includes('Local:') ||
        line.includes('ready in') ||
        line.includes('listening on') ||
        line.includes('Network:') ||
        line.includes('VITE v') ||
        line.includes('ready started server on')
    ) {
        if (!devServersStarted.has('preview_ready')) {
            devServersStarted.add('preview_ready');
            window.dispatchEvent(new CustomEvent('brainPreviewReady'));
        }
    }
}

function cacheWebContainer(wc: WebContainer) {
    webcontainerInstance = wc;
    const w = getGrizonWindow();
    if (w) w[WC_GLOBAL_KEY] = wc;
}

async function bootWebContainer(): Promise<WebContainer> {
    const { WebContainer } = await import('@webcontainer/api');
    const wc = await WebContainer.boot({ coep: 'credentialless' });
    wc.on('server-ready', (port, url) => {
        console.log('[WebContainer] server-ready', port, url);
        emitPreviewIfPreferred(url, port);
    });
    cacheWebContainer(wc);
    return wc;
}

export async function getBrainWebContainer(): Promise<WebContainer> {
    const w = getGrizonWindow();
    if (webcontainerInstance) return webcontainerInstance;
    if (w?.[WC_GLOBAL_KEY]) {
        webcontainerInstance = w[WC_GLOBAL_KEY];
        return webcontainerInstance;
    }

    const existingBoot = bootPromise || w?.[WC_BOOT_KEY];
    if (existingBoot) {
        try {
            return await existingBoot;
        } catch (err) {
            if (isSingleWebContainerError(err) && w?.[WC_GLOBAL_KEY]) {
                webcontainerInstance = w[WC_GLOBAL_KEY];
                return webcontainerInstance;
            }
            bootPromise = null;
            if (w) delete w[WC_BOOT_KEY];
            throw err;
        }
    }

    bootPromise = (async () => {
        try {
            return await bootWebContainer();
        } catch (err) {
            if (isSingleWebContainerError(err) && w?.[WC_GLOBAL_KEY]) {
                webcontainerInstance = w[WC_GLOBAL_KEY];
                return webcontainerInstance;
            }
            throw err;
        }
    })();

    if (w) w[WC_BOOT_KEY] = bootPromise;

    try {
        return await bootPromise;
    } catch (err) {
        bootPromise = null;
        if (w) delete w[WC_BOOT_KEY];
        if (isSingleWebContainerError(err) && w?.[WC_GLOBAL_KEY]) {
            webcontainerInstance = w[WC_GLOBAL_KEY];
            return webcontainerInstance;
        }
        throw err;
    }
}

const bareNpmInstalledDirs = new Set<string>();
const devServersStarted = new Set<string>();

export async function resetBrainWebContainer() {
    if (webcontainerInstance) {
        try {
            webcontainerInstance.teardown();
        } catch (e) {
            // ignore
        }
    }
    webcontainerInstance = null;
    bootPromise = null;
    activePreviewPort = 0;
    bareNpmInstalledDirs.clear();
    devServersStarted.clear();
    const w = getGrizonWindow();
    if (w) {
        delete w[WC_GLOBAL_KEY];
        delete w[WC_BOOT_KEY];
    }
}

function normalizePath(path: string): string {
    return path.replace(/^\/+/, '').replace(/\/+$/, '');
}

function normalizeCwd(cwd?: string): string | undefined {
    if (!cwd) return undefined;
    const p = normalizePath(cwd.trim().replace(/^["']|["']$/g, ''));
    if (!p || p === '.') return undefined;
    return p;
}

/** mkdir → write_file → install_packages → run → delete_file */
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

async function ensureDir(wc: WebContainer, filePath: string) {
    const parts = normalizePath(filePath).split('/');
    if (parts.length <= 1) return;
    const dir = parts.slice(0, -1).join('/');
    try {
        await wc.fs.mkdir(dir, { recursive: true });
    } catch {
        /* exists */
    }
}

async function ensureCwdExists(wc: WebContainer, cwd: string): Promise<boolean> {
    const p = normalizeCwd(cwd);
    if (!p) return false;
    try {
        await wc.fs.mkdir(p, { recursive: true });
        await wc.fs.readdir(p);
        return true;
    } catch {
        return false;
    }
}

async function hasPackageJson(wc: WebContainer, cwd: string): Promise<boolean> {
    const p = normalizeCwd(cwd) || '.';
    try {
        await wc.fs.readFile(`${p}/package.json`, 'utf-8');
        return true;
    } catch {
        return false;
    }
}

async function hasNodeModules(wc: WebContainer, cwd: string): Promise<boolean> {
    return false; // Force re-install to fix WebContainer IndexedDB .bin corruption
}

let runOpChain: Promise<void> = Promise.resolve();

function enqueueRunOp(fn: () => Promise<{ exitCode?: number }>): Promise<{ exitCode?: number }> {
    const next = runOpChain.then(fn);
    runOpChain = next.then(
        () => undefined,
        () => undefined
    );
    return next;
}

async function spawnWithOutput(
    wc: WebContainer,
    program: string,
    args: string[],
    cwd: string | undefined,
    onOutput?: (line: string) => void,
    background = false
): Promise<{ exitCode?: number }> {
    const spawnOpts = cwd ? { cwd } : undefined;
    const process = await wc.spawn(program, args, spawnOpts);
    const writeChunk = (chunk: string) => {
        const handler = onOutput || emitOutput;
        handler(chunk);
    };
    process.output.pipeTo(
        new WritableStream({
            write(data) {
                writeChunk(typeof data === 'string' ? data : new TextDecoder().decode(data));
            },
        })
    );
    if (!background) {
        const exitCode = await process.exit;
        return { exitCode };
    }
    return {};
}

export async function applyWorkspaceOp(
    wc: WebContainer,
    op: WorkspaceOp,
    onOutput?: (line: string) => void
): Promise<{ exitCode?: number }> {
    switch (op.op) {
        case 'mkdir': {
            const p = normalizePath(op.path);
            if (p) await wc.fs.mkdir(p, { recursive: true });
            return {};
        }
        case 'write_file': {
            const p = normalizePath(op.path);
            await ensureDir(wc, p);
            await wc.fs.writeFile(p, op.content);
            return {};
        }
        case 'delete_file': {
            const p = normalizePath(op.path);
            if (!p) return {};
            try {
                await wc.fs.rm(p);
            } catch {
                /* already gone */
            }
            return {};
        }
        case 'install_packages': {
            enqueueRunOp(async () => {
                const cwd = normalizeCwd(op.cwd);
                const cwdKey = cwd || '.';
                if (cwd) {
                    const ok = await ensureCwdExists(wc, cwd);
                    if (!ok) {
                        console.warn(`[WebContainer] skipping install_packages — cwd missing: ${cwd}`);
                        return { exitCode: 1 };
                    }
                }
                if (!(await hasPackageJson(wc, cwdKey))) {
                    console.warn(`[WebContainer] skipping install_packages — no package.json in ${cwdKey}`);
                    return { exitCode: 0 };
                }
                const args = ['install', '--no-audit', '--no-fund', '--legacy-peer-deps', ...op.packages];
                if (op.dev) args.push('--save-dev');
                console.log(`[WebContainer] npm install packages in ${cwdKey}:`, op.packages.join(', '));
                return spawnWithOutput(wc, 'npm', args, cwd, onOutput, false);
            });
            return {};
        }
        case 'run': {
            enqueueRunOp(async () => {
                const cmd = op.command.trim();
                if (!cmd || cmd === 'true' || cmd === ':') {
                    return {};
                }
                if (shouldSkipWebContainerCommand(cmd)) {
                    console.log(`[WebContainer] skipped instruction (not executed): ${cmd.slice(0, 120)}…`);
                    return { exitCode: 0 };
                }

                const cwd = normalizeCwd(op.cwd);
                const cwdKey = cwd || '.';

                if (cwd) {
                    const ok = await ensureCwdExists(wc, cwd);
                    if (!ok) {
                        console.warn(`[WebContainer] skipping run — cwd does not exist: ${cwd}`);
                        return { exitCode: 1 };
                    }
                }

                let finalCmd = cmd;
                if (isBareNpmInstall(cmd)) {
                    if (bareNpmInstalledDirs.has(cwdKey)) {
                        return { exitCode: 0 };
                    }
                    if (!(await hasPackageJson(wc, cwdKey))) {
                        console.warn(`[WebContainer] skipping npm install — no package.json in ${cwdKey}`);
                        return { exitCode: 0 };
                    }
                    if (await hasNodeModules(wc, cwdKey)) {
                        bareNpmInstalledDirs.add(cwdKey);
                        return { exitCode: 0 };
                    }
                    finalCmd = 'npm install --no-audit --no-fund --legacy-peer-deps';
                }

                if (isLongRunningDevCommand(cmd)) {
                    const key = devServerKey(cwdKey, cmd);
                    if (devServersStarted.has(key)) {
                        console.log(`[WebContainer] dev server already running: ${key}`);
                        return {};
                    }
                    devServersStarted.add(key);
                }

                const runInBackground = op.background || isLongRunningDevCommand(cmd);
                const spec = parseSpawnSpec(finalCmd);
                const result = await spawnWithOutput(
                    wc,
                    spec.program,
                    spec.args,
                    cwd,
                    onOutput,
                    runInBackground
                );
                if (!runInBackground && isBareNpmInstall(cmd) && result.exitCode === 0) {
                    bareNpmInstalledDirs.add(cwdKey);
                }
                return result;
            });
            return {};
        }
        default:
            return {};
    }
}

export async function applyWorkspaceOps(
    ops: WorkspaceOp[],
    onOutput?: (line: string) => void
): Promise<WebContainer> {
    const wc = await getBrainWebContainer();
    const sorted = sortWorkspaceOps(ops);
    for (const op of sorted) {
        await applyWorkspaceOp(wc, op, onOutput);
    }
    return wc;
}

async function isDirectory(wc: WebContainer, fullPath: string): Promise<boolean> {
    try {
        await wc.fs.readdir(fullPath);
        return true;
    } catch {
        return false;
    }
}

export async function listWebContainerFiles(
    wc: WebContainer,
    dirPath = '.',
    base = ''
): Promise<FileNode[]> {
    const nodes: FileNode[] = [];
    let entries: string[] = [];
    try {
        entries = await wc.fs.readdir(dirPath);
    } catch {
        return nodes;
    }

    for (const name of entries) {
        if (['node_modules', '.git', 'dist', 'build', '.next'].includes(name)) continue;
        const rel = base ? `${base}/${name}` : name;
        const full = dirPath === '.' ? name : `${dirPath}/${name}`;
        if (await isDirectory(wc, full)) {
            nodes.push({
                name,
                type: 'folder',
                path: rel,
                isOpen: false,
                children: await listWebContainerFiles(wc, full, rel),
            });
        } else {
            nodes.push({ name, type: 'file', path: rel });
        }
    }
    return nodes.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
        return a.name.localeCompare(b.name);
    });
}

export async function readWebContainerFile(wc: WebContainer, path: string): Promise<string> {
    const data = await wc.fs.readFile(normalizePath(path), 'utf-8');
    return typeof data === 'string' ? data : new TextDecoder().decode(data as Uint8Array);
}
