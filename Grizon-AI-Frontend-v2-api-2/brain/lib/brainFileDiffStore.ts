export interface FileDiffInfo {
    diff?: string;
    isNew?: boolean;
    linesAdded?: number;
    linesRemoved?: number;
    label?: string;
}

const store = new Map<string, FileDiffInfo>();

let notifyScheduled = false;

function notify() {
    if (typeof window !== 'undefined' && !notifyScheduled) {
        notifyScheduled = true;
        queueMicrotask(() => {
            notifyScheduled = false;
            window.dispatchEvent(new CustomEvent('brainFileDiffUpdated'));
        });
    }
}

export function setFileDiff(path: string, info: FileDiffInfo) {
    if (!path) return;
    const key = normalizeDiffKey(path);
    const prev = store.get(key);
    if (!info.diff && !info.isNew) return;
    if (prev && !info.diff && prev.diff) info = { ...info, diff: prev.diff };
    store.set(key, info);
    notify();
}

export function getFileDiff(path?: string): FileDiffInfo | undefined {
    if (!path) return undefined;
    return store.get(normalizeDiffKey(path));
}

export function hasFileDiff(path?: string): boolean {
    if (!path) return false;
    const info = store.get(normalizeDiffKey(path));
    return !!info && (!!info.diff || !!info.isNew);
}

function normalizeDiffKey(path: string): string {
    return path.replace(/^\.\//, '').replace(/^\/+/, '');
}
