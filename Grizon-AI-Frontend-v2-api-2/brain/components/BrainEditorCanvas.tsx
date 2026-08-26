'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import {
    X, File, Folder, FolderOpen, ChevronRight, ChevronDown,
    Terminal, Monitor, Code, Settings, Share, Download, Github,
    Play, Save, Search, Maximize2, Minimize2, Split,
    Eye, Layout, Database, ChevronLeft, RotateCcw,
    PlusSquare, FolderPlus, MoreHorizontal, History,
    ChevronUp, Globe, Cpu, Zap, ArrowLeft, ArrowRight,
    RotateCw, ExternalLink, Copy, Shield, Loader2, CheckCircle2, Circle, Square
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import BrainPublishModal from './BrainPublishModal';
import Editor from '@monaco-editor/react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import BrainBuildActivityFeed from './BrainBuildActivityFeed';
import '@xterm/xterm/css/xterm.css';
import { useBrainWebContainer } from '../context/BrainWebContainerContext';
import {
    onBrainTerminalOutput,
    type FileNode,
} from '../lib/brainWebContainer';
import { bootstrapDefaultTemplates, applyFrontendTemplate } from '../lib/templateBootstrap';
import { brainApiFetch } from '../lib/brainApiBase';
import { sortFileTreeNodes, getFileTreeIcon } from '../lib/fileTreeUtils';
import { DEFAULT_BRAIN_FRAMEWORK, normalizeBrainFramework, type BrainFrameworkId } from '../constants/frameworks';
import BrainDiffViewer from './BrainDiffViewer';
import { getFileDiff } from '../lib/brainFileDiffStore';
import { useExecutionStore } from '../store/execution-store';

const BRAIN_URL = process.env.NEXT_PUBLIC_BRAIN_API_URL || 'http://localhost:8001';

function PreviewIframe({ url, sessionId }: { url: string; sessionId?: string }) {
    const [loadIframe, setLoadIframe] = useState(false);
    const [elapsed, setElapsed] = useState(0);
    const [iframeKey, setIframeKey] = useState(0);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const iframeSrc = url;

    useEffect(() => {
        setLoadIframe(false);
        setElapsed(0);
        setIframeKey(0);

        if (!url) return;

        timerRef.current = setInterval(() => {
            setElapsed((prev) => {
                const next = prev + 1;
                if (next >= 10) {
                    if (timerRef.current) clearInterval(timerRef.current);
                    setLoadIframe(true);
                }
                return next;
            });
        }, 1000);

        return () => {
            if (timerRef.current) clearInterval(timerRef.current);
        };
    }, [url]);

    const handleRefresh = useCallback(() => {
        if (timerRef.current) clearInterval(timerRef.current);
        setLoadIframe(false);
        setElapsed(0);
        setIframeKey((k) => k + 1);
        timerRef.current = setInterval(() => {
            setElapsed((prev) => {
                const next = prev + 1;
                if (next >= 10) {
                    if (timerRef.current) clearInterval(timerRef.current);
                    setLoadIframe(true);
                }
                return next;
            });
        }, 1000);
    }, []);

    if (!url) {
        return (
            <div className="w-full h-full flex items-center justify-center bg-[#0a0a0a]">
                <div className="text-center text-white/50 text-xs">
                    <Loader2 size={24} className="text-white/20 animate-spin mx-auto mb-3" />
                    <div className="animate-pulse">Waiting for tunnel URL...</div>
                </div>
            </div>
        );
    }

    if (!loadIframe) {
        return (
            <div className="w-full h-full flex items-center justify-center bg-[#0a0a0a]">
                <div className="text-center text-white/50 text-xs">
                    <Loader2 size={24} className="text-[#976df8] animate-spin mx-auto mb-3" />
                    <div>Starting preview server...</div>
                    <div className="text-white/30 mt-1 text-[10px]">{elapsed}s / 10s</div>
                    <div className="mt-3 w-48 h-1 bg-white/10 rounded-full overflow-hidden mx-auto">
                        <div
                            className="h-full bg-[#976df8] rounded-full transition-all duration-1000"
                            style={{ width: `${(elapsed / 10) * 100}%` }}
                        />
                    </div>
                </div>
            </div>
        );
    }

    const cacheBustUrl = iframeSrc.includes('?') ? `${iframeSrc}&_t=${iframeKey}` : `${iframeSrc}?_t=${iframeKey}`;

    return (
        <div className="w-full h-full relative">
            <iframe
                key={iframeKey}
                src={cacheBustUrl}
                className="w-full h-full border-none"
                title="Grizon Preview"
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            />
            <button
                onClick={handleRefresh}
                className="absolute top-2 right-2 px-2 py-1 bg-black/60 text-white/70 text-[10px] rounded hover:bg-black/80 hover:text-white transition-colors z-10"
            >
                Refresh
            </button>
            <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="absolute top-2 right-[72px] px-2 py-1 bg-black/60 text-white/70 text-[10px] rounded hover:bg-black/80 hover:text-white transition-colors z-10 no-underline"
            >
                Open in Tab
            </a>
        </div>
    );
}

export interface BrainEditorBuildJob {
    jobId: string;
    syncUrl?: string;
    streamUrl?: string;
    framework?: string;
}

interface BrainEditorCanvasProps {
    isOpen?: boolean;
    onClose?: () => void;
    embedded?: boolean;
    buildJob?: BrainEditorBuildJob | null;
    buildComplete?: boolean;
    forceBuilding?: boolean;
    todoList?: { id?: string; title?: string; task?: string; status?: string }[];
    activities?: any[];
    isSyncing?: boolean;
}

export default function BrainEditorCanvas({
    isOpen: propsIsOpen,
    onClose: propsOnClose,
    embedded = false,
    buildJob,
    buildComplete = false,
    forceBuilding = false,
    todoList: propsTodoList = [],
    activities = [],
    isSyncing = false,
}: BrainEditorCanvasProps) {
    const { setWorkspace } = useBrainWebContainer();
    const isStopped = useExecutionStore((s) => s.isStopped);
    const [internalIsOpen, setInternalIsOpen] = useState(false);
    const isOpen = embedded ? true : (propsIsOpen !== undefined ? propsIsOpen : internalIsOpen);

    // Bridge internal setter to call props if available
    const setIsOpen = (val: boolean) => {
        if (!val && propsOnClose) {
            propsOnClose();
        }
        setInternalIsOpen(val);
    };

    const [activeFile, setActiveFile] = useState<FileNode | null>(null);
    const [openFiles, setOpenFiles] = useState<FileNode[]>([]);
    const [showFileDiff, setShowFileDiff] = useState(false);
    const [activeFileDiff, setActiveFileDiff] = useState<{ diff?: string; isNew?: boolean; linesRemoved?: number } | undefined>(undefined);
    const [fileTree, setFileTree] = useState<FileNode[]>([]);
    const [isFullScreen, setIsFullScreen] = useState(false);
    const [isSidebarVisible, setIsSidebarVisible] = useState(true);
    const [sidebarWidth, setSidebarWidth] = useState(240);
    const [viewMode, setViewMode] = useState<'preview' | 'code' | 'terminal'>(embedded ? 'code' : 'code');
    const [previewUrl, setPreviewUrl] = useState('');
    const [syncUrl, setSyncUrl] = useState<string | null>(null);
    const [runtime] = useState<'sandbox'>('sandbox');
    const [framework, setFramework] = useState<BrainFrameworkId>(DEFAULT_BRAIN_FRAMEWORK);
    const templatesBootstrappedRef = useRef(false);
    const workspaceInitKeyRef = useRef<string | null>(null);
    const fileTreeSigRef = useRef('');
    const filesLoadedRef = useRef(false);
    const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const [todoList, setTodoList] = useState<any[]>([]);
    const [jobId, setJobId] = useState<string | null>(null);
    const [isBuilding, setIsBuilding] = useState(false);
    const [lastProgressMsg, setLastProgressMsg] = useState("");
    const [currentTaskIndex, setCurrentTaskIndex] = useState(0);
    const [recentTerminalLines, setRecentTerminalLines] = useState<string[]>([]);

    const { getAccessToken, user } = useAuth();
    const [showPublish, setShowPublish] = useState(false);
    const [showPublishMenu, setShowPublishMenu] = useState(false);
    const publishMenuRef = useRef<HTMLDivElement>(null);

    const collectWorkspaceFiles = async (): Promise<{ path: string; content: string }[]> => {
        const files: { path: string; content: string }[] = [];
        const wid = jobIdRef.current || jobId || '';
        const collect = async (nodes: FileNode[]) => {
            for (const node of nodes) {
                if (node.type === 'file' && node.path) {
                    let content = node.content || '';
                    if (!content && wid) {
                        try {
                            const res = await brainApiFetch(
                                `sandbox/read-file?workspace_id=${encodeURIComponent(wid)}&path=${encodeURIComponent(node.path)}`
                            );
                            if (res?.ok) {
                                const result = await res.json();
                                content = result.content || '';
                            }
                        } catch {}
                    }
                    if (content) {
                        files.push({ path: node.path, content });
                    }
                }
                if (node.children) {
                    await collect(node.children);
                }
            }
        };
        await collect(fileTree);
        return files;
    };

    const fileCount = (() => {
        let count = 0;
        const walk = (nodes: FileNode[]) => {
            for (const node of nodes) {
                if (node.type === 'file') count++;
                if (node.children) walk(node.children);
            }
        };
        walk(fileTree);
        return count;
    })();

    const handlePushChanges = async (files: { path: string; content: string }[]) => {
        const token = getAccessToken?.() ?? '';
        const wid = jobIdRef.current || jobId || '';
        try {
            const res = await fetch(
                `${BRAIN_URL}/connect-github/push-changes${token ? `?token=${encodeURIComponent(token)}` : ''}`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...(token ? { Authorization: `Bearer ${token}` } : {}),
                    },
                    body: JSON.stringify({ files, workspace_id: wid }),
                },
            );
            const data = await res.json();
            if (!res.ok) {
                return { success: false, error: data.detail || 'Push failed' };
            }
            return { success: true, files_pushed: data.files_pushed };
        } catch (e: any) {
            return { success: false, error: e.message || 'Network error' };
        }
    };

    const handlePublish = async (name: string, description: string, isPrivate: boolean, githubToken?: string) => {
        const token = getAccessToken?.() ?? '';
        try {
            const files = await collectWorkspaceFiles();
            const res = await fetch(
                `${BRAIN_URL}/connect-github/repositories/create${token ? `?token=${encodeURIComponent(token)}` : ''}`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...(token ? { Authorization: `Bearer ${token}` } : {}),
                    },
                    body: JSON.stringify({ name, description, private: isPrivate, files, github_token: githubToken, workspace_id: jobIdRef.current || jobId || '' }),
                },
            );
            const data = await res.json();
            if (!res.ok) {
                return { success: false, error: data.detail || 'Failed to create repository' };
            }
            return { success: true, repository: data.repository };
        } catch (e: any) {
            return { success: false, error: e.message || 'Network error' };
        }
    };

    const handleDownloadZip = async () => {
        setShowPublishMenu(false);
        const JSZip = (await import('jszip')).default;
        const zip = new JSZip();
        const wid = jobIdRef.current || jobId || '';

        const allFiles: FileNode[] = [];
        const collectNodes = (nodes: FileNode[]) => {
            for (const node of nodes) {
                if (node.type === 'file' && node.path) allFiles.push(node);
                if (node.children) collectNodes(node.children);
            }
        };
        collectNodes(fileTree);

        const fetchOne = async (node: FileNode): Promise<{ path: string; content: string } | null> => {
            let content = node.content || '';
            if (!content && wid) {
                try {
                    const uid = user?.id ? `&user_id=${encodeURIComponent(user.id)}` : '';
                    const res = await brainApiFetch(
                        `sandbox/read-file?workspace_id=${encodeURIComponent(wid)}&path=${encodeURIComponent(node.path)}${uid}`
                    );
                    if (res?.ok) {
                        const r = await res.json();
                        content = r.content || '';
                    }
                } catch {}
            }
            return content ? { path: node.path, content } : null;
        };

        const results = await Promise.all(allFiles.map(fetchOne));
        for (const r of results) {
            if (r) zip.file(r.path, r.content);
        }

        const blob = await zip.generateAsync({ type: 'blob' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'project.zip';
        a.click();
        URL.revokeObjectURL(url);
    };

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (publishMenuRef.current && !publishMenuRef.current.contains(e.target as Node)) {
                setShowPublishMenu(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    useEffect(() => {
        const unsub = onBrainTerminalOutput((line) => {
            setRecentTerminalLines((prev) => {
                const next = [...prev, line].slice(-8); // Keep last 8 lines
                return next;
            });
        });
        return () => { unsub(); };
    }, []);

    const jobIdRef = useRef<string | null>(null);
    useEffect(() => {
        jobIdRef.current = jobId;
        if (jobId) {
            (window as any).__brainJobId = jobId;
        }
    }, [jobId]);

    useEffect(() => {
        if (user?.id) {
            (window as any).__brainUserId = user.id;
        }
    }, [user?.id]);

    const activeFilePathRef = useRef<string | null>(null);
    useEffect(() => {
        activeFilePathRef.current = activeFile?.path || null;
    }, [activeFile?.path]);

    const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const editorRef = useRef<any>(null);
    const activeFileKeyRef = useRef<string>('');

    const persistToFile = useCallback((filePath: string, content: string) => {
        const wid = jobIdRef.current || jobId || '';
        if (!wid || !filePath) return;
        const uid = user?.id ? `&user_id=${encodeURIComponent(user.id)}` : '';
        brainApiFetch(`sandbox/write-file?workspace_id=${encodeURIComponent(wid)}${uid}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: filePath, content }),
        }).catch(() => {});
    }, [jobId, user?.id]);

    const handleEditorChange = useCallback((value: string | undefined) => {
        if (value === undefined) return;
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(() => {
            const filePath = activeFilePathRef.current || '';
            if (filePath) persistToFile(filePath, value);
        }, 800);
    }, [persistToFile]);

    useEffect(() => () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); }, []);

    const buildJobId = buildJob?.jobId;
    const buildJobSyncUrl = buildJob?.syncUrl;
    const buildJobFramework = buildJob?.framework;

    // Handle new job initialization (reset UI state only once per job)
    useEffect(() => {
        if (!buildJobId) return;
        if (workspaceInitKeyRef.current === buildJobId) return;

        workspaceInitKeyRef.current = buildJobId;
        setJobId(buildJobId);
        setIsBuilding(true);
        setPreviewUrl('');
        setViewMode('code');
        filesLoadedRef.current = false;
        fileTreeSigRef.current = '';
    }, [buildJobId]);

    // Handle syncUrl/framework updates for the current job without resetting UI
    useEffect(() => {
        if (!buildJobId) return;
        if (buildJobSyncUrl) setSyncUrl(buildJobSyncUrl);
        if (buildJobFramework) setFramework(normalizeBrainFramework(buildJobFramework));
        setWorkspace(buildJobId, buildJobSyncUrl ?? null);
    }, [buildJobId, buildJobSyncUrl, buildJobFramework, setWorkspace]);

    const effectivePreviewUrl = previewUrl || '';
    const isSandboxTunnel = !!effectivePreviewUrl && /trycloudflare\.com/.test(effectivePreviewUrl);
    const hasLiveFrontendPreview = !!effectivePreviewUrl && isSandboxTunnel;

    const showBuildingOverlay = isStopped ? false : (embedded
        ? (forceBuilding || !buildComplete) && !hasLiveFrontendPreview
        : (forceBuilding || isBuilding || !buildComplete) && !hasLiveFrontendPreview);

    const showPreviewIframe = !!previewUrl && hasLiveFrontendPreview && !showBuildingOverlay;

    const activeTodos = propsTodoList.length > 0 ? propsTodoList : todoList;
    const completedTodoCount = activeTodos.filter((t) => {
        const s = (t.status || '').toLowerCase();
        return s === 'completed' || s === 'success' || s === 'done';
    }).length;

    const buildCompleteRef = useRef(buildComplete);
    const embeddedRef = useRef(embedded);
    useEffect(() => {
        buildCompleteRef.current = buildComplete;
        embeddedRef.current = embedded;
    }, [buildComplete, embedded]);

    useEffect(() => {
        const onPreview = (e: Event) => {
            const detail = (e as CustomEvent).detail || {};
            const url = detail.url || detail.streamUrl;
            if (!url) return;
            const isTunnel = /trycloudflare\.com/.test(url);
            if (!isTunnel) return;
            setPreviewUrl(url);
            setViewMode('preview');
        };
        window.addEventListener('brainPreviewReady', onPreview);
        return () => window.removeEventListener('brainPreviewReady', onPreview);
    }, []);

    const findFirstFile = (nodes: FileNode[]): FileNode | null => {
        for (const node of nodes) {
            if (node.type === 'file') return node;
            if (node.children) {
                const found = findFirstFile(node.children);
                if (found) return found;
            }
        }
        return null;
    };

    const loadFileContent = async (file: FileNode, targetJobId?: string): Promise<FileNode> => {
        if (file.type !== 'file') return file;
        const wid = targetJobId || jobIdRef.current || jobId || '';
        try {
            if (!wid) return file;
            const uid = user?.id ? `&user_id=${encodeURIComponent(user.id)}` : '';
            const res = await brainApiFetch(
                `sandbox/read-file?workspace_id=${encodeURIComponent(wid)}&path=${encodeURIComponent(file.path)}${uid}`
            );
            if (!res?.ok) return file;
            const result = await res.json();
            if (result.content === undefined) return file;
            return { ...file, content: result.content };
        } catch (err) {
            console.error('Error reading file:', err);
            return file;
        }
    };

    const treeSignature = (nodes: FileNode[]): string => {
        const paths: string[] = [];
        const walk = (list: FileNode[]) => {
            for (const n of list) {
                paths.push(n.path);
                if (n.children?.length) walk(n.children);
            }
        };
        walk(nodes);
        return paths.sort().join('\n');
    };

    const fetchApiFileTree = async (targetJobId: string): Promise<FileNode[]> => {
        if (!targetJobId) return [];
        try {
            const q = new URLSearchParams({
                workspace_id: targetJobId,
                sandbox_id: targetJobId,
            });
            if (user?.id) {
                q.set('user_id', user.id);
            }
            const response = await brainApiFetch(`sandbox/list-files?${q}`);
            if (!response?.ok) return [];
            const result = await response.json();
            return result.files || [];
        } catch {
            return [];
        }
    };

    const openDefaultFolders = (nodes: FileNode[]): FileNode[] =>
        nodes.map((n) =>
            n.type === 'folder'
                ? { ...n, isOpen: ['frontend', 'backend', 'src', 'app', 'public'].includes(n.name) || n.isOpen, children: n.children ? openDefaultFolders(n.children) : n.children }
                : n
        );

    const fetchProjectFiles = useCallback(async (targetJobId: string, pickActive = false, retries = 5, delayMs = 1500) => {
        if (!targetJobId) return;
        for (let attempt = 0; attempt < retries; attempt++) {
            try {
                const apiFiles = await fetchApiFileTree(targetJobId);
                if (apiFiles.length > 0) {
                    const expanded = openDefaultFolders(sortFileTreeNodes(apiFiles));
                    const sig = treeSignature(expanded);
                    fileTreeSigRef.current = sig;
                    setFileTree(expanded);

                    if (activeFilePathRef.current) {
                        const node: FileNode = { type: 'file', name: activeFilePathRef.current.split('/').pop() || '', path: activeFilePathRef.current };
                        const loaded = await loadFileContent(node, targetJobId);
                        setActiveFile(prev => prev?.path === loaded.path ? loaded : prev);
                        setOpenFiles(prev => prev.map(f => f.path === loaded.path ? { ...f, content: loaded.content } : f));
                        filesLoadedRef.current = true;
                    } else if (!filesLoadedRef.current || pickActive) {
                        const first = findFirstFile(expanded);
                        if (first) {
                            const loaded = await loadFileContent(first, targetJobId);
                            setActiveFile(loaded);
                            setOpenFiles([loaded]);
                            filesLoadedRef.current = true;
                        }
                    }
                    return;
                }
                if (attempt < retries - 1) {
                    await new Promise(r => setTimeout(r, delayMs));
                }
            } catch (err) {
                console.error('Error fetching project files:', err);
                if (attempt < retries - 1) {
                    await new Promise(r => setTimeout(r, delayMs));
                }
            }
        }
    }, [runtime, framework]);

    const scheduleFileRefresh = useCallback(
        (targetJobId: string, pickActive = false) => {
            if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
            refreshTimerRef.current = setTimeout(() => {
                fetchProjectFiles(targetJobId, pickActive);
            }, 250);
        },
        [fetchProjectFiles]
    );

    useEffect(() => {
        if (!isOpen) templatesBootstrappedRef.current = false;
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen || templatesBootstrappedRef.current) return;
        if (embedded && buildJobId) {
            templatesBootstrappedRef.current = true;
            if (jobIdRef.current) scheduleFileRefresh(jobIdRef.current, true);
            return;
        }
        templatesBootstrappedRef.current = true;
        bootstrapDefaultTemplates(framework).then(() => {
            if (jobIdRef.current) scheduleFileRefresh(jobIdRef.current, true);
        }).catch(() => { });
    }, [isOpen, framework, embedded, buildJobId, scheduleFileRefresh]);

    useEffect(() => {
        const onRefresh = () => {
            const id = jobIdRef.current || jobId;
            if (id) {
                fetchApiFileTree(id).then((apiFiles) => {
                    if (apiFiles.length > 0) {
                        const expanded = openDefaultFolders(sortFileTreeNodes(apiFiles));
                        const sig = treeSignature(expanded);
                        fileTreeSigRef.current = sig;
                        setFileTree(expanded);
                    }
                });
            }
        };
        window.addEventListener('refreshBrainFiles', onRefresh);
        return () => window.removeEventListener('refreshBrainFiles', onRefresh);
    }, [jobId]);

    useEffect(() => {
        const onOpenFile = async (e: Event) => {
            const detail = (e as CustomEvent).detail;
            const filePath = detail?.path;
            if (!filePath) return;
            const name = filePath.split('/').pop() || filePath;
            const loaded = await loadFileContent({ type: 'file', name, path: filePath } as FileNode);
            setActiveFile(loaded);
            setOpenFiles(prev => {
                if (prev.find(f => f.path === loaded.path)) return prev;
                return [...prev, loaded];
            });
        };
        window.addEventListener('openBrainFile', onOpenFile);
        return () => window.removeEventListener('openBrainFile', onOpenFile);
    }, []);

    useEffect(() => {
        const syncDiff = () => {
            if (!activeFile?.path) {
                setActiveFileDiff(undefined);
                return;
            }
            const diff = getFileDiff(activeFile.path);
            queueMicrotask(() => {
                setActiveFileDiff(diff);
            });
        };
        syncDiff();
        window.addEventListener('brainFileDiffUpdated', syncDiff);
        return () => window.removeEventListener('brainFileDiffUpdated', syncDiff);
    }, [activeFile]);

    // Always open a file in Code view so its text is visible.
    // The user can click "Changes" later to see the green/red diff.
    useEffect(() => {
        setShowFileDiff(false);
    }, [activeFile?.path]);

    useEffect(() => {
        const id = jobIdRef.current || jobId;
        if (!id) return;
        scheduleFileRefresh(id, !filesLoadedRef.current);
    }, [jobId, scheduleFileRefresh]);

    useEffect(() => {
        if (embedded && buildJobId && !buildComplete && fileTree.length === 0) {
            const id = jobIdRef.current || jobId;
            if (!id) return;
            const poll = setInterval(() => {
                const cur = jobIdRef.current || jobId;
                if (cur && fileTree.length === 0) {
                    fetchApiFileTree(cur).then((apiFiles) => {
                        if (apiFiles.length > 0) {
                            const expanded = openDefaultFolders(sortFileTreeNodes(apiFiles));
                            const sig = treeSignature(expanded);
                            fileTreeSigRef.current = sig;
                            setFileTree(expanded);
                        }
                    });
                }
            }, 1500);
            return () => clearInterval(poll);
        }
    }, [embedded, buildJobId, buildComplete, fileTree.length, jobId]);

    useEffect(() => {
        if (!buildComplete) return;
        setIsBuilding(false);
        const id = jobIdRef.current || jobId;
        if (id) scheduleFileRefresh(id, true);
        setViewMode('preview');
    }, [buildComplete, jobId, scheduleFileRefresh]);

    useEffect(() => {
        const onFw = (e: Event) => {
            const fw = normalizeBrainFramework((e as CustomEvent).detail?.framework);
            setFramework(fw);
            if (jobIdRef.current) {
                applyFrontendTemplate(fw).then(() => scheduleFileRefresh(jobIdRef.current!, true));
            }
        };
        window.addEventListener('brainFrameworkChange', onFw);
        return () => window.removeEventListener('brainFrameworkChange', onFw);
    }, [scheduleFileRefresh]);

    const handleRefresh = () => {
        fileTreeSigRef.current = '';
        if (jobIdRef.current) scheduleFileRefresh(jobIdRef.current, true);
    };

    useEffect(() => () => {
        if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    }, []);

    useEffect(() => {
        const handleOpen = (e: any) => {
            const data = e.detail || {};
            const targetJobId = data.jobId || jobIdRef.current;
            if (data.jobId) {
                setJobId(data.jobId);
                setWorkspace(data.jobId, data.syncUrl ?? null);
            }
            if (data.framework) {
                setFramework(normalizeBrainFramework(data.framework));
            }
            if (targetJobId) {
                setIsBuilding(true);
                scheduleFileRefresh(targetJobId, true);
                if (data.jobId && data.jobId !== jobIdRef.current) {
                    setViewMode('code');
                }
            }
            if (data.streamUrl && !embedded) {
                setPreviewUrl(data.streamUrl);
                setIsBuilding(false);
                if (data.jobId && data.jobId !== jobIdRef.current) {
                    setViewMode('preview');
                }
            }
            if (data.syncUrl) {
                setSyncUrl(data.syncUrl);
            }
            if (data.todoList) {
                setTodoList(data.todoList);
                // If todoList already exists and all are completed or failed, we are not building
                const allDone = data.todoList.length > 0 && data.todoList.every((t: any) => t.status === 'completed' || t.status === 'failed');
                if (allDone) {
                    setIsBuilding(false);
                }
            }
            setIsOpen(true);
        };
        const handleClose = () => setIsOpen(false);

        const handleProgress = (e: any) => {
            const data = e.detail || {};
            if (data.todoList) {
                setTodoList(data.todoList);
                const allDone = data.todoList.length > 0 && data.todoList.every((t: any) => t.status === 'completed' || t.status === 'failed');
                if (allDone) {
                    setTimeout(() => setIsBuilding(false), 1500);
                }
            }
            if (data.progressMsg) {
                setLastProgressMsg(data.progressMsg);
                setIsBuilding(true);
                // Extract task index if available (e.g. "🔄 Built 2/5")
                const match = data.progressMsg.match(/(\d+)\/(\d+)/);
                if (match) {
                    const parsedIndex = parseInt(match[1]);
                    setCurrentTaskIndex(parsedIndex);
                    if (data.todoList && parsedIndex >= data.todoList.length) {
                        setTimeout(() => setIsBuilding(false), 1500);
                    }
                }
                if (
                    data.progressMsg.includes('✅') ||
                    data.progressMsg.includes('completed') ||
                    data.progressMsg.includes('Success') ||
                    data.progressMsg.includes('finished') ||
                    data.progressMsg.includes('Live')
                ) {
                    // Give it a small delay before hiding building status
                    setTimeout(() => setIsBuilding(false), 1500);
                }
            }
        };

        const handlePreviewReady = (e: Event) => {
            const d = (e as CustomEvent).detail || {};
            const url = d.streamUrl || d.url;
            if (url && typeof url === 'string') {
                console.log('[BrainEditor] brainPreviewReady received:', url);
                setPreviewUrl(url);
                setIsBuilding(false);
                setViewMode('preview');
            }
        };

        window.addEventListener('openBrainEditor', handleOpen);
        window.addEventListener('openSandboxCanvas', handleOpen);
        window.addEventListener('updateSandboxProgress', handleProgress);
        window.addEventListener('refreshBrainFiles', handleRefresh);
        window.addEventListener('closeBrainEditor', handleClose);
        window.addEventListener('brainPreviewReady', handlePreviewReady);

        return () => {
            window.removeEventListener('openBrainEditor', handleOpen);
            window.removeEventListener('openSandboxCanvas', handleOpen);
            window.removeEventListener('updateSandboxProgress', handleProgress);
            window.removeEventListener('refreshBrainFiles', handleRefresh);
            window.removeEventListener('closeBrainEditor', handleClose);
            window.removeEventListener('brainPreviewReady', handlePreviewReady);
        };
    }, []);

    const toggleFolder = (path: string) => {
        const updateTree = (nodes: FileNode[]): FileNode[] => {
            return nodes.map(node => {
                if (node.path === path) {
                    return { ...node, isOpen: !node.isOpen };
                }
                if (node.children) {
                    return { ...node, children: updateTree(node.children) };
                }
                return node;
            });
        };
        setFileTree(updateTree(fileTree));
    };

    const handleFileClick = async (file: FileNode) => {
        if (file.type === 'folder') {
            toggleFolder(file.path);
        } else {
            const loadedFile = await loadFileContent(file);
            setActiveFile(loadedFile);
            setOpenFiles(prev => {
                if (prev.find(f => f.path === loadedFile.path)) {
                    return prev.map(f => f.path === loadedFile.path ? { ...f, content: loadedFile.content } : f);
                }
                return [...prev, loadedFile];
            });
        }
    };

    const closeFile = (e: React.MouseEvent, path: string) => {
        e.stopPropagation();
        const newOpenFiles = openFiles.filter(f => f.path !== path);
        setOpenFiles(newOpenFiles);
        if (activeFile?.path === path) {
            setActiveFile(newOpenFiles.length > 0 ? newOpenFiles[newOpenFiles.length - 1] : null);
        }
    };

    const terminalRef = useRef<HTMLDivElement>(null);
    const xtermRef = useRef<XTerm | null>(null);

    useEffect(() => {
        if (viewMode !== 'terminal' || !terminalRef.current || xtermRef.current) return;

        const term = new XTerm({
            theme: {
                background: '#0a0a0a',
                foreground: '#ffffff',
                cursor: '#976df8',
                selectionBackground: 'rgba(151, 109, 248, 0.3)',
            },
            fontFamily: 'JetBrains Mono, Menlo, Monaco, Courier New, monospace',
            fontSize: 13,
            allowProposedApi: true,
        });

        const fitAddon = new FitAddon();
        term.loadAddon(fitAddon);
        term.open(terminalRef.current);
        fitAddon.fit();
        xtermRef.current = term;
        term.write('\r\n\x1b[35m[GRIZON]\x1b[0m Sandbox shell output...\r\n');

        const unsub = onBrainTerminalOutput((line) => {
            term.write(line.replace(/\n/g, '\r\n'));
        });

        const handleResize = () => fitAddon.fit();
        window.addEventListener('resize', handleResize);

        return () => {
            window.removeEventListener('resize', handleResize);
            unsub();
            term.dispose();
            xtermRef.current = null;
        };
    }, [viewMode]);

    if (!isOpen && !embedded) return null;

    const FileTreeItem = ({ node, level = 0 }: { node: FileNode, level?: number }) => {
        const { Icon: NodeIcon, className: iconClass } = getFileTreeIcon(
            node.name,
            node.type,
            node.isOpen
        );
        return (
            <div className="select-none">
                <div
                    className={`flex items-center py-[2px] px-2 cursor-pointer transition-colors group relative ${activeFile?.path === node.path ? 'bg-white/5 text-white' : 'text-white/50 hover:text-white/80 hover:bg-white/[0.02]'}`}
                    style={{ paddingLeft: `${level * 12 + 12}px` }}
                    onClick={() => handleFileClick(node)}
                >
                    <div className="w-3.5 h-3.5 mr-0.5 flex items-center justify-center shrink-0">
                        {node.type === 'folder' ? (
                            node.isOpen ? (
                                <ChevronDown size={12} className="text-white/30" />
                            ) : (
                                <ChevronRight size={12} className="text-white/30" />
                            )
                        ) : (
                            <span className="w-3.5" />
                        )}
                    </div>
                    <NodeIcon
                        size={15}
                        className={`mr-1.5 shrink-0 ${iconClass} ${activeFile?.path === node.path ? 'opacity-100' : 'opacity-90'}`}
                    />
                    <span className={`text-[13px] font-normal truncate ${activeFile?.path === node.path ? 'text-white font-medium' : ''}`}>{node.name}</span>
                </div>
                {node.type === 'folder' && node.isOpen && node.children && (
                    <div>
                        {node.children.map(child => (
                            <FileTreeItem key={child.path} node={child} level={level + 1} />
                        ))}
                    </div>
                )}
            </div>
        );
    };

    const shellClass = embedded
        ? 'relative flex flex-1 h-full min-h-0 w-full flex-col bg-app text-text-primary overflow-hidden font-sans'
        : `fixed z-[9999] transition-all duration-300 ease-out flex flex-col bg-app text-text-primary border border-border-default shadow-2xl overflow-hidden font-sans
            ${isFullScreen ? 'inset-4 rounded-xl' : 'right-4 top-4 bottom-4 w-[calc(100vw-450px)] max-w-[1400px] rounded-xl'}`;

    const globalBuildingOverlay = (!embedded && !buildComplete && !hasLiveFrontendPreview) && (
        <div className="absolute inset-0 z-[100] flex flex-col bg-app text-text-primary overflow-hidden">
            {/* Header */}
            <div className="flex items-center gap-3 px-6 py-4 border-b border-border-subtle shrink-0 bg-sidebar">
                {isStopped ? (
                    <>
                        <div className="w-5 h-5 rounded-full bg-red-500/20 flex items-center justify-center">
                            <div className="w-2 h-2 rounded-full bg-red-500" />
                        </div>
                        <h2 className="text-[16px] font-bold text-red-400 font-display">Stopped</h2>
                    </>
                ) : (
                    <>
                        <Loader2 size={20} className="text-accent animate-spin" />
                        <h2 className="text-[16px] font-bold text-text-primary font-display">Brain Build Mode</h2>
                    </>
                )}
                {activeTodos.length > 0 && (
                    <div className="ml-auto flex items-center gap-3 text-[13px] font-sans text-text-muted">
                        <span className="text-text-primary font-bold">{completedTodoCount} / {activeTodos.length}</span>
                        <span>Tasks Complete</span>
                        <div className="w-32 h-1.5 bg-surface-3 rounded-full overflow-hidden border border-border-subtle">
                            <div
                                className="h-full bg-accent transition-all duration-500 ease-out"
                                style={{ width: `${(completedTodoCount / activeTodos.length) * 100}%` }}
                            />
                        </div>
                    </div>
                )}
            </div>

            {/* Activity Feed */}
            <div className="flex-1 overflow-y-auto p-6 bg-app">
                {isStopped ? (
                    <div className="flex flex-col items-center justify-center h-full gap-4">
                        <div className="w-12 h-12 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center">
                            <Square size={20} className="text-red-400" />
                        </div>
                        <p className="text-[15px] text-red-400 font-medium">
                            Execution interrupted
                        </p>
                        <p className="text-[13px] text-text-muted">
                            The build process was interrupted.
                        </p>
                    </div>
                ) : activities.length > 0 || activeTodos.length > 0 ? (
                    <BrainBuildActivityFeed
                        activities={activities}
                        todos={activeTodos}
                        isSyncing={isSyncing || forceBuilding}
                    />
                ) : (
                    <div className="flex flex-col items-center justify-center h-full gap-4">
                        <p className="text-[15px] text-accent font-medium">
                            {forceBuilding ? 'Syncing project files...' : 'Analyzing your request...'}
                        </p>
                        <div className="flex items-center gap-3 text-[13px] font-sans text-text-muted">
                            <Loader2 size={14} className="animate-spin text-accent" />
                            <span>Setting up tasks...</span>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );


    return (
        <div className={`${shellClass} relative`}>

            {/* GRIZON-STYLE HEADER */}
            <header className="h-[48px] border-b border-border-subtle flex items-center justify-between px-3 bg-sidebar shrink-0 gap-4">

                <div className="flex items-center gap-1.5 flex-1 min-w-0">
                    <button
                        onClick={() => setIsSidebarVisible(!isSidebarVisible)}
                        className="p-1.5 text-white/40 hover:text-white hover:bg-white/5 rounded-md transition-all shrink-0"
                    >
                        <ChevronLeft size={16} className={`transition-transform duration-300 ${isSidebarVisible ? '' : 'rotate-180'}`} />
                    </button>

                    <div className="flex items-center bg-white/[0.03] border border-white/5 p-0.5 rounded-lg ml-1 shrink-0">
                        <button
                            onClick={() => setViewMode('preview')}
                            className={`p-1.5 px-2.5 rounded-md flex items-center gap-2 text-[12px] font-medium transition-all ${viewMode === 'preview' ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/60'}`}
                        >
                            <Eye size={14} />
                            <span className="hidden md:inline">Preview</span>
                        </button>
                        <button
                            onClick={() => setViewMode('code')}
                            className={`p-1.5 px-2.5 rounded-md flex items-center gap-2 text-[12px] font-medium transition-all ${viewMode === 'code' ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/60'}`}
                        >
                            <Code size={14} />
                            <span className="hidden md:inline">Code</span>
                        </button>
                        <button
                            onClick={() => setViewMode('terminal')}
                            className={`p-1.5 px-2.5 rounded-md flex items-center gap-2 text-[12px] font-medium transition-all ${viewMode === 'terminal' ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/60'}`}
                        >
                            <Database size={14} />
                            <span className="hidden md:inline">Terminal</span>
                        </button>
                    </div>
                </div>

                <div className="flex items-center gap-2 flex-1 justify-end min-w-0">
                    <div className="relative ml-1 shrink-0" ref={publishMenuRef}>
                        <button
                            onClick={() => setShowPublishMenu(!showPublishMenu)}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white text-black text-[12px] font-bold hover:bg-white/90 transition-all shadow-[0_0_15px_rgba(255,255,255,0.1)]"
                        >
                            <Download size={14} />
                            <span>Download</span>
                            <ChevronDown size={12} />
                        </button>
                        {showPublishMenu && (
                            <div className="absolute right-0 top-full mt-1 w-48 bg-[#1a1a1a] border border-white/10 rounded-lg shadow-xl z-50 overflow-hidden">
                                <button
                                    onClick={handleDownloadZip}
                                    className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-white hover:bg-white/10 transition-colors"
                                >
                                    <Download size={14} />
                                    Download as ZIP
                                </button>
                                <div className="border-t border-white/10" />
                                <button
                                    onClick={() => { setShowPublishMenu(false); setShowPublish(true); }}
                                    className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-white hover:bg-white/10 transition-colors"
                                >
                                    <Github size={14} />
                                    Export to GitHub
                                </button>
                            </div>
                        )}
                    </div>

                    {!embedded && (
                        <button
                            onClick={() => setIsOpen(false)}
                            className="p-1.5 text-white/40 hover:text-white hover:bg-white/10 rounded-md transition-all ml-2 border border-white/5"
                            title="Close Canvas"
                        >
                            <X size={20} />
                        </button>
                    )}
                </div>
            </header>

            <div className="flex-1 flex overflow-hidden">
                {/* FILE EXPLORER SIDEBAR */}
                <aside className={`border-r border-white/5 bg-[#0a0a0a] flex flex-col shrink-0 transition-all duration-300 ease-in-out overflow-hidden h-full`} style={{ width: isSidebarVisible ? sidebarWidth : 0, opacity: isSidebarVisible ? 1 : 0 }}>
                    <div className="p-3 pb-2 flex flex-col gap-3 min-w-[240px] shrink-0">
                        <div className="flex items-center justify-between">
                            <span className="text-[11px] font-bold text-white/30 uppercase tracking-[0.1em]">
                                Explorer
                            </span>
                            <div className="flex items-center gap-0.5">
                                <button className="p-1 text-white/30 hover:text-white transition-colors"><PlusSquare size={14} /></button>
                                <button className="p-1 text-white/30 hover:text-white transition-colors"><FolderPlus size={14} /></button>
                                <button
                                    onClick={() => handleRefresh()}
                                    className="p-1 text-white/30 hover:text-white transition-colors"
                                    title="Refresh Workspace"
                                >
                                    <RotateCcw size={14} />
                                </button>
                                <button className="p-1 text-white/30 hover:text-white transition-colors"><MoreHorizontal size={14} /></button>
                            </div>
                        </div>
                    </div>

                    <div className="flex-1 min-h-0 overflow-y-auto py-1 custom-scrollbar">
                        {fileTree.length === 0 ? (
                            <p className="px-3 py-4 text-[11px] text-white/30 leading-relaxed">
                                {jobId || buildJobId ? 'Loading project files…' : 'Waiting for workspace…'}
                            </p>
                        ) : (
                            fileTree.map(node => (
                                <FileTreeItem key={node.path} node={node} />
                            ))
                        )}
                    </div>
                </aside>

                {/* EDITOR CONTENT AREA */}
                <main className="flex-1 flex flex-col min-w-0 bg-[#0d0d0d]">
                    {/* TABS */}
                    <div className="h-[40px] border-b border-white/5 flex items-center bg-[#0a0a0a] overflow-x-auto no-scrollbar shrink-0">
                        {openFiles.map(file => (
                            <div
                                key={file.path}
                                onClick={() => setActiveFile(file)}
                                className={`h-full px-4 flex items-center gap-2 border-r border-white/5 cursor-pointer transition-all relative group
                                    ${activeFile?.path === file.path ? 'bg-[#0d0d0d] text-white' : 'text-white/30 hover:text-white/60 bg-transparent'}`}
                            >
                                <File size={14} className={activeFile?.path === file.path ? 'text-white/80' : 'text-white/20'} />
                                <span className="text-[13px] font-normal whitespace-nowrap">{file.name}</span>
                                <button
                                    onClick={(e) => closeFile(e, file.path)}
                                    className="p-0.5 rounded hover:bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity ml-1"
                                >
                                    <X size={12} />
                                </button>
                            </div>
                        ))}
                    </div>

                    {/* MAIN CONTENT AREA */}
                    <div className="flex-1 flex min-h-0 relative">
                        {globalBuildingOverlay}
                        {viewMode === 'code' ? (
                            <div className="flex-1 flex flex-col relative overflow-hidden">
                                {activeFile ? (
                                    <>
                                        {showFileDiff && activeFileDiff?.diff ? (
                                            <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-3">
                                                <BrainDiffViewer diff={activeFileDiff.diff} fileName={activeFile.name} />
                                            </div>
                                        ) : (
                                            <Editor
                                                key={activeFile.path}
                                                height="100%"
                                                defaultLanguage={activeFile.language || 'typescript'}
                                                value={activeFile.content || ''}
                                                theme="vs-dark"
                                                onChange={handleEditorChange}
                                                options={{
                                                    fontSize: 13,
                                                    fontFamily: "'Geist Mono', 'Fira Code', monospace",
                                                    minimap: { enabled: false },
                                                    scrollBeyondLastLine: false,
                                                    automaticLayout: true,
                                                    padding: { top: 16, bottom: 16 },
                                                    lineNumbers: 'on',
                                                    glyphMargin: false,
                                                    folding: true,
                                                    lineDecorationsWidth: 10,
                                                    lineNumbersMinChars: 3,
                                                    renderLineHighlight: 'all',
                                                    scrollbar: {
                                                        vertical: 'hidden',
                                                        horizontal: 'hidden'
                                                    }
                                                }}
                                                onMount={(editor, monaco) => {
                                                    monaco.editor.defineTheme('grizon-dark-editor', {
                                                        base: 'vs-dark',
                                                        inherit: true,
                                                        rules: [
                                                            { token: 'comment', foreground: '666666' },
                                                            { token: 'keyword', foreground: 'ffffff', fontStyle: 'bold' },
                                                            { token: 'string', foreground: 'a1a1a1' },
                                                            { token: 'number', foreground: 'ffffff' },
                                                        ],
                                                        colors: {
                                                            'editor.background': '#0d0d0d',
                                                            'editor.foreground': '#d4d4d4',
                                                            'editor.lineHighlightBackground': '#ffffff05',
                                                            'editorLineNumber.foreground': '#333333',
                                                            'editorLineNumber.activeForeground': '#888888',
                                                            'editorIndentGuide.background': '#1a1a1a',
                                                            'editorIndentGuide.activeBackground': '#333333',
                                                        }
                                                    });
                                                    monaco.editor.setTheme('grizon-dark-editor');
                                                }}
                                            />
                                        )}
                                    </>
                                ) : (
                                    <div className="flex-1 flex flex-col items-center justify-center text-white/10 space-y-4">
                                        <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center">
                                            <Code size={32} />
                                        </div>
                                        <div className="text-center">
                                            <p className="text-[13px] font-bold uppercase tracking-widest">No active file</p>
                                        </div>
                                    </div>
                                )}
                            </div>
                        ) : viewMode === 'preview' ? (
                            <div className="flex-1 bg-white flex flex-col min-h-0 overflow-hidden">
                                {/* BROWSER ADDRESS BAR */}
                                <div className="h-[40px] border-b border-gray-200 flex items-center px-3 bg-gray-50 shrink-0 gap-3">
                                    <div className="flex items-center gap-1">
                                        <button className="p-1 text-gray-400 hover:text-gray-600 transition-colors"><ArrowLeft size={14} /></button>
                                        <button className="p-1 text-gray-400 hover:text-gray-600 transition-colors"><ArrowRight size={14} /></button>
                                        <button className="p-1 text-gray-400 hover:text-gray-600 transition-colors"><RotateCw size={14} /></button>
                                    </div>

                                    <div className="flex-1 max-w-[600px] h-7 bg-white border border-gray-200 rounded-md flex items-center px-3 gap-2 group transition-all">
                                        <Shield size={12} className="text-gray-400" />
                                        <span className="text-[12px] text-gray-500 select-none truncate">
                                            {previewUrl ? previewUrl.replace(/^https?:\/\//, '').slice(0, 48) : 'Waiting for Sandbox (port 9999)…'}
                                        </span>
                                    </div>

                                    <div className="flex items-center gap-1">
                                        <button className="p-1 text-white/30 hover:text-white transition-colors"><ExternalLink size={14} /></button>
                                        <button className="p-1 text-white/30 hover:text-white transition-colors"><Copy size={14} /></button>
                                    </div>
                                </div>

                                {/* BROWSER CONTENT */}
                                <div className="flex-1 bg-white relative">
                                    {showPreviewIframe ? (
                                        <PreviewIframe url={previewUrl} sessionId={buildJobId || jobId || undefined} />
                                    ) : buildComplete && !hasLiveFrontendPreview ? (
                                        <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
                                            <Loader2 size={32} className="text-[#976df8] animate-spin" />
                                            <p className="text-sm font-medium text-gray-700">Starting frontend dev server on port 9999…</p>
                                            <p className="text-xs text-gray-400 max-w-md">The remote sandbox is installing dependencies and starting the server. This may take a moment.</p>

                                            <div className="mt-6 bg-gray-100 rounded-lg p-3 w-full max-w-lg text-left text-[11px] font-mono text-gray-500 border border-gray-200">
                                                {recentTerminalLines.length > 0 ? recentTerminalLines.map((line, i) => (
                                                    <div key={i} className="truncate">{line.replace(/\x1b\[[0-9;]*m/g, '')}</div>
                                                )) : (
                                                    <div className="animate-pulse text-gray-400">Waiting for terminal output...</div>
                                                )}
                                            </div>
                                        </div>
                                    ) : null}
                                </div>
                            </div>
                        ) : (
                            <div className="flex-1 bg-[#0a0a0a] p-2 relative overflow-hidden">
                                <div ref={terminalRef} className="absolute inset-0 m-2" />
                            </div>
                        )}
                    </div>
                </main>
            </div>

            {/* WINDOW CONTROLS (IF NOT FULL SCREEN) */}
            {!isFullScreen && (
                <div className="absolute top-4 right-4 flex items-center gap-2">
                    {/* These are just visual fillers to match the feel */}
                </div>
            )}

            <BrainPublishModal
                isOpen={showPublish}
                onClose={() => setShowPublish(false)}
                fileCount={fileCount}
                onPublish={handlePublish}
                onPushChanges={handlePushChanges}
            />
        </div>
    );
}
