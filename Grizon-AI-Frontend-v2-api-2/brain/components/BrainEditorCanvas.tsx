'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import {
    X, File, Folder, FolderOpen, ChevronRight, ChevronDown,
    Terminal, Monitor, Code, Settings, Share, Download,
    Play, Save, Search, Maximize2, Minimize2, Split,
    Eye, Layout, Database, ChevronLeft, RotateCcw,
    PlusSquare, FolderPlus, MoreHorizontal, History,
    ChevronUp, Globe, Cpu, Zap, ArrowLeft, ArrowRight,
    RotateCw, ExternalLink, Copy, Shield, Loader2, CheckCircle2, Circle
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
    getBrainWebContainer,
    listWebContainerFiles,
    readWebContainerFile,
    onBrainTerminalOutput,
    isFrontendPreviewPort,
    type FileNode,
} from '../lib/brainWebContainer';
import { bootstrapDefaultTemplates, applyFrontendTemplate } from '../lib/templateBootstrap';
import { brainApiFetch } from '../lib/brainApiBase';
import { sortFileTreeNodes, getFileTreeIcon } from '../lib/fileTreeUtils';
import { DEFAULT_BRAIN_FRAMEWORK, normalizeBrainFramework, type BrainFrameworkId } from '../constants/frameworks';

const BRAIN_URL = process.env.NEXT_PUBLIC_BRAIN_URL || 'http://localhost:8001';

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
    const { previewUrl: wcPreviewUrl, previewPort: wcPreviewPort, isReady: wcReady, setWorkspace } = useBrainWebContainer();
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
    const [fileTree, setFileTree] = useState<FileNode[]>([]);
    const [isFullScreen, setIsFullScreen] = useState(false);
    const [isSidebarVisible, setIsSidebarVisible] = useState(true);
    const [sidebarWidth, setSidebarWidth] = useState(240);
    const [viewMode, setViewMode] = useState<'preview' | 'code' | 'terminal'>(embedded ? 'code' : 'code');
    const [previewUrl, setPreviewUrl] = useState('');
    const [syncUrl, setSyncUrl] = useState<string | null>(null);
    const [runtime, setRuntime] = useState<'webcontainer' | 'legacy'>('webcontainer');
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

    const { getAccessToken } = useAuth();
    const [showPublish, setShowPublish] = useState(false);

    const collectWorkspaceFiles = async (): Promise<{ path: string; content: string }[]> => {
        const files: { path: string; content: string }[] = [];
        const walk = async (nodes: FileNode[]) => {
            for (const node of nodes) {
                if (node.type === 'file' && node.path) {
                    let content = node.content || '';
                    if (!content && wcReady) {
                        try {
                            const wc = await getBrainWebContainer();
                            content = await readWebContainerFile(wc, node.path);
                        } catch { /* ignore */ }
                    }
                    if (content) {
                        files.push({ path: node.path, content });
                    }
                }
                if (node.children) {
                    await walk(node.children);
                }
            }
        };
        await walk(fileTree);
        return files;
    };

    const handlePublish = async (name: string, description: string, isPrivate: boolean) => {
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
                    body: JSON.stringify({ name, description, private: isPrivate, files }),
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
    }, [jobId]);

    const activeFilePathRef = useRef<string | null>(null);
    useEffect(() => {
        activeFilePathRef.current = activeFile?.path || null;
    }, [activeFile?.path]);

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

    const effectivePreviewUrl = previewUrl || wcPreviewUrl || '';
    const isSandboxTunnel = !!effectivePreviewUrl && /trycloudflare\.com|\.l\.trycloudflare\.com/.test(effectivePreviewUrl);
    const hasLiveFrontendPreview =
        !!effectivePreviewUrl &&
        (!!previewUrl || isSandboxTunnel || (wcPreviewPort ? isFrontendPreviewPort(wcPreviewPort) : /5173|5174|:3000/.test(effectivePreviewUrl)));

    const showBuildingOverlay = embedded
        ? (forceBuilding || !buildComplete) && !hasLiveFrontendPreview
        : forceBuilding || isBuilding || !buildComplete;

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
        if (!wcPreviewUrl) return;
        const isTunnel = /trycloudflare\.com/.test(wcPreviewUrl);
        const portOk = isTunnel || (wcPreviewPort ? isFrontendPreviewPort(wcPreviewPort) : /5173|5174/.test(wcPreviewUrl));
        if (embeddedRef.current && !buildCompleteRef.current && !portOk) return;
        setPreviewUrl(wcPreviewUrl);
        if (portOk) setViewMode('preview');
    }, [wcPreviewUrl, wcPreviewPort]);

    useEffect(() => {
        const onPreview = (e: Event) => {
            const detail = (e as CustomEvent).detail || {};
            const url = detail.url || detail.streamUrl;
            const port = detail.port as number | undefined;
            if (!url) return;
            const isTunnel = /trycloudflare\.com/.test(url);
            const portOk = isTunnel || (port ? isFrontendPreviewPort(port) : /5173|5174/.test(url));
            if (embeddedRef.current && !buildCompleteRef.current && !portOk) return;
            setPreviewUrl(url);
            if (portOk) setViewMode('preview');
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
            if (runtime === 'webcontainer' && wcReady) {
                try {
                    const wc = await getBrainWebContainer();
                    const content = await readWebContainerFile(wc, file.path);
                    return { ...file, content };
                } catch {
                    /* fall back to API */
                }
            }
            if (!wid) return file;
            const res = await brainApiFetch(
                `sandbox/read-file?workspace_id=${encodeURIComponent(wid)}&path=${encodeURIComponent(file.path)}`
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

    const fetchProjectFiles = useCallback(async (targetJobId: string, pickActive = false) => {
        if (!targetJobId && !wcReady) return;
        try {
            let wcFiles: FileNode[] = [];
            let apiFiles: FileNode[] = [];

            if (runtime === 'webcontainer' && wcReady) {
                try {
                    const wc = await getBrainWebContainer();
                    wcFiles = await listWebContainerFiles(wc);
                } catch (err) {
                    console.warn('[BrainEditor] WebContainer unavailable, using API file tree:', err);
                }
            }
            if (targetJobId && wcFiles.length === 0) {
                apiFiles = await fetchApiFileTree(targetJobId);
            }

            const files = wcFiles.length > 0 ? wcFiles : apiFiles;
            if (!files.length) return;

            const expanded = openDefaultFolders(sortFileTreeNodes(files));
            const sig = treeSignature(expanded);

            fileTreeSigRef.current = sig;
            setFileTree(expanded);

            if (activeFilePathRef.current) {
                const node: FileNode = { type: 'file', name: activeFilePathRef.current.split('/').pop() || '', path: activeFilePathRef.current };
                const loaded = await loadFileContent(node, targetJobId);
                setActiveFile(prev => prev?.path === loaded.path ? loaded : prev);
                setOpenFiles(prev => prev.map(f => f.path === loaded.path ? loaded : f));
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
        } catch (err) {
            console.error('Error fetching project files:', err);
        }
    }, [wcReady, runtime, framework]);

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
        if (!isOpen || !wcReady || templatesBootstrappedRef.current) return;
        if (embedded && buildJobId) {
            templatesBootstrappedRef.current = true;
            if (jobIdRef.current) scheduleFileRefresh(jobIdRef.current, true);
            return;
        }
        templatesBootstrappedRef.current = true;
        bootstrapDefaultTemplates(framework).then(() => {
            if (jobIdRef.current) scheduleFileRefresh(jobIdRef.current, true);
        }).catch(() => { });
    }, [isOpen, wcReady, framework, embedded, buildJobId, scheduleFileRefresh]);

    useEffect(() => {
        const onRefresh = () => {
            const id = jobIdRef.current || jobId;
            if (id || wcReady) scheduleFileRefresh(id || '', false);
        };
        window.addEventListener('refreshBrainFiles', onRefresh);
        return () => window.removeEventListener('refreshBrainFiles', onRefresh);
    }, [wcReady, jobId, scheduleFileRefresh]);

    useEffect(() => {
        const id = jobIdRef.current || jobId;
        if (!id) return;
        scheduleFileRefresh(id, !filesLoadedRef.current);
    }, [jobId, wcReady, scheduleFileRefresh]);

    useEffect(() => {
        if (!buildComplete) return;
        setIsBuilding(false);
        if (wcPreviewUrl) setPreviewUrl(wcPreviewUrl);
        const id = jobIdRef.current || jobId;
        if (id) scheduleFileRefresh(id, true);
        setViewMode('preview');
    }, [buildComplete, wcPreviewUrl, jobId, scheduleFileRefresh]);

    useEffect(() => {
        const onFw = (e: Event) => {
            const fw = normalizeBrainFramework((e as CustomEvent).detail?.framework);
            setFramework(fw);
            if (wcReady && jobIdRef.current) {
                applyFrontendTemplate(fw).then(() => scheduleFileRefresh(jobIdRef.current!, true));
            }
        };
        window.addEventListener('brainFrameworkChange', onFw);
        return () => window.removeEventListener('brainFrameworkChange', onFw);
    }, [wcReady, scheduleFileRefresh]);

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
            if (data.runtime) {
                setRuntime(data.runtime === 'webcontainer' ? 'webcontainer' : 'legacy');
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

        window.addEventListener('openBrainEditor', handleOpen);
        window.addEventListener('openSandboxCanvas', handleOpen);
        window.addEventListener('updateSandboxProgress', handleProgress);
        window.addEventListener('refreshBrainFiles', handleRefresh);
        window.addEventListener('closeBrainEditor', handleClose);

        return () => {
            window.removeEventListener('openBrainEditor', handleOpen);
            window.removeEventListener('openSandboxCanvas', handleOpen);
            window.removeEventListener('updateSandboxProgress', handleProgress);
            window.removeEventListener('refreshBrainFiles', handleRefresh);
            window.removeEventListener('closeBrainEditor', handleClose);
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
        ? 'relative flex flex-1 h-full min-h-0 w-full flex-col bg-[#0a0a0a] overflow-hidden font-sans'
        : `fixed z-[9999] transition-all duration-300 ease-out flex flex-col bg-[#0a0a0a] border border-white/10 shadow-2xl overflow-hidden font-sans
            ${isFullScreen ? 'inset-4 rounded-xl' : 'right-4 top-4 bottom-4 w-[calc(100vw-450px)] max-w-[1400px] rounded-xl'}`;

    const globalBuildingOverlay = (!buildComplete) && (
        <div className="absolute inset-0 z-[100] flex flex-col bg-[#0a0a0a] overflow-hidden">
            {/* Header */}
            <div className="flex items-center gap-3 px-6 py-4 border-b border-white/5 shrink-0">
                <Loader2 size={20} className="text-[#976df8] animate-spin" />
                <h2 className="text-[16px] font-bold text-white">Brain Build Mode</h2>
                {activeTodos.length > 0 && (
                    <div className="ml-auto flex items-center gap-3 text-[13px] font-mono text-white/50">
                        <span className="text-white">{completedTodoCount} / {activeTodos.length}</span>
                        <span>Tasks Complete</span>
                        <div className="w-32 h-1.5 bg-white/10 rounded-full overflow-hidden">
                            <div
                                className="h-full bg-[#976df8] transition-all duration-500 ease-out"
                                style={{ width: `${(completedTodoCount / activeTodos.length) * 100}%` }}
                            />
                        </div>
                    </div>
                )}
            </div>

            {/* Activity Feed */}
            <div className="flex-1 overflow-y-auto p-6">
                {activities.length > 0 || activeTodos.length > 0 ? (
                    <BrainBuildActivityFeed
                        activities={activities}
                        todos={activeTodos}
                        isSyncing={isSyncing || forceBuilding}
                    />
                ) : (
                    <div className="flex flex-col items-center justify-center h-full gap-4">
                        <p className="text-[15px] text-[#c4b5fd] font-medium">
                            {forceBuilding ? 'Syncing project files...' : 'Analyzing your request...'}
                        </p>
                        <div className="flex items-center gap-3 text-[13px] font-mono text-white/50">
                            <Loader2 size={14} className="animate-spin" />
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
            <header className="h-[48px] border-b border-white/5 flex items-center justify-between px-3 bg-[#0a0a0a] shrink-0 gap-4">
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
                            className={`p-1.5 px-2 rounded-md flex items-center gap-2 text-[12px] font-medium transition-all ${viewMode === 'preview' ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/60'}`}
                        >
                            <Eye size={14} />
                        </button>
                        <button
                            onClick={() => setViewMode('code')}
                            className={`p-1.5 px-2 rounded-md flex items-center gap-2 text-[12px] font-medium transition-all ${viewMode === 'code' ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/60'}`}
                        >
                            <Code size={14} />
                        </button>
                        <button
                            onClick={() => setViewMode('terminal')}
                            className={`p-1.5 px-2 rounded-md flex items-center gap-2 text-[12px] font-medium transition-all ${viewMode === 'terminal' ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/60'}`}
                        >
                            <Database size={14} />
                        </button>
                    </div>
                </div>

                <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-white/[0.03] border border-white/5 min-w-0 max-w-[400px]">
                    <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse shrink-0" />
                    <span className="text-[12px] font-medium text-white/60 tracking-tight truncate">
                        {jobId ? `sandbox / ${jobId.slice(0, 8)}` : 'grizon-brain / initializing'}
                    </span>
                    <ChevronDown size={14} className="text-white/20 shrink-0" />
                </div>

                <div className="flex items-center gap-2 flex-1 justify-end min-w-0">
                    <div className="flex items-center bg-white/[0.03] border border-white/5 p-0.5 rounded-lg mr-1 shrink-0">
                        <button className="p-1.5 px-3 rounded-md text-[11px] font-bold text-white/60 hover:text-white transition-all flex items-center gap-2">
                            <span>Latest</span>
                            <ChevronDown size={12} />
                        </button>
                    </div>

                    <div className="flex items-center gap-1 mr-1 shrink-0">
                        <button className="p-1.5 text-white/40 hover:text-white hover:bg-white/5 rounded-md transition-all"><ChevronLeft size={16} /></button>
                        <button className="p-1.5 text-white/40 hover:text-white hover:bg-white/5 rounded-md transition-all"><ChevronRight size={16} /></button>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                        <button className="p-1.5 text-white/40 hover:text-white hover:bg-white/5 rounded-md transition-all">
                            <Settings size={18} />
                        </button>
                        <button className="p-1.5 text-white/40 hover:text-white hover:bg-white/5 rounded-md transition-all">
                            <Share size={18} />
                        </button>
                    </div>

                    <button
                        onClick={() => setShowPublish(true)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white text-black text-[12px] font-bold hover:bg-white/90 transition-all ml-1 shadow-[0_0_15px_rgba(255,255,255,0.1)] shrink-0"
                    >
                        <Globe size={14} />
                        <span>Publish</span>
                    </button>

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
                <aside className={`border-r border-white/5 bg-[#0a0a0a] flex flex-col shrink-0 transition-all duration-300 ease-in-out overflow-hidden`} style={{ width: isSidebarVisible ? sidebarWidth : 0, opacity: isSidebarVisible ? 1 : 0 }}>
                    <div className="p-3 pb-2 flex flex-col gap-3 min-w-[240px]">
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

                    <div className="flex-1 overflow-y-auto py-1 custom-scrollbar">
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
                                    <Editor
                                        height="100%"
                                        defaultLanguage={activeFile.language || 'typescript'}
                                        path={activeFile.path}
                                        value={activeFile.content}
                                        theme="vs-dark"
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
                            <div className="flex-1 bg-[#121212] flex flex-col min-h-0 overflow-hidden">
                                {/* BROWSER ADDRESS BAR */}
                                <div className="h-[40px] border-b border-white/5 flex items-center px-3 bg-[#0a0a0a] shrink-0 gap-3">
                                    <div className="flex items-center gap-1">
                                        <button className="p-1 text-white/30 hover:text-white transition-colors"><ArrowLeft size={14} /></button>
                                        <button className="p-1 text-white/30 hover:text-white transition-colors"><ArrowRight size={14} /></button>
                                        <button className="p-1 text-white/30 hover:text-white transition-colors"><RotateCw size={14} /></button>
                                    </div>

                                    <div className="flex-1 max-w-[600px] h-7 bg-white/[0.03] border border-white/5 rounded-md flex items-center px-3 gap-2 group focus-within:border-white/20 transition-all">
                                        <Shield size={12} className="text-white/20 group-hover:text-white/40" />
                                        <span className="text-[12px] text-white/60 select-none truncate">
                                            {previewUrl ? previewUrl.replace(/^https?:\/\//, '').slice(0, 48) : 'Waiting for Sandbox (port 9999)…'}
                                        </span>
                                    </div>

                                    <div className="flex items-center gap-1">
                                        <button className="p-1 text-white/30 hover:text-white transition-colors"><ExternalLink size={14} /></button>
                                        <button className="p-1 text-white/30 hover:text-white transition-colors"><Copy size={14} /></button>
                                    </div>
                                </div>

                                {/* BROWSER CONTENT */}
                                <div className="flex-1 bg-[#0a0a0a] relative">
                                    {showPreviewIframe ? (
                                        <iframe
                                            key={previewUrl}
                                            src={previewUrl}
                                            className="w-full h-full border-none animate-in fade-in duration-500"
                                            title="Grizon Preview"
                                            allow="cross-origin-isolated"
                                        />
                                    ) : buildComplete && !hasLiveFrontendPreview ? (
                                        <div className="flex h-full flex-col items-center justify-center gap-3 text-white/50 p-8 text-center">
                                            <Loader2 size={32} className="text-[#976df8] animate-spin" />
                                            <p className="text-sm font-medium text-white/80">Starting frontend dev server on port 9999…</p>
                                            <p className="text-xs text-white/40 max-w-md">The remote sandbox is installing dependencies and starting the server. This may take a moment.</p>

                                            <div className="mt-6 bg-black/40 rounded-lg p-3 w-full max-w-lg text-left text-[11px] font-mono text-white/50 border border-white/5 shadow-inner">
                                                {recentTerminalLines.length > 0 ? recentTerminalLines.map((line, i) => (
                                                    <div key={i} className="truncate">{line.replace(/\x1b\[[0-9;]*m/g, '')}</div>
                                                )) : (
                                                    <div className="animate-pulse">Waiting for terminal output...</div>
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

                    {/* STATUS BAR (V0 STYLE - VERY MINIMAL) */}
                    <footer className="h-10 border-t border-white/5 bg-[#0a0a0a] flex items-center justify-between px-4 text-[11px] font-medium text-white/30 shrink-0">
                        <div className="flex items-center gap-4">
                            <div className="flex items-center gap-2">
                                <History size={14} />
                                <span>Saved just now</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <Cpu size={14} />
                                <span>Remote Sandbox Environment</span>
                            </div>
                        </div>
                        <div className="flex items-center gap-4">
                            <div className="flex items-center gap-2">
                                <Zap size={14} className="text-yellow-500/50" />
                                <span>Fast Refresh active</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="uppercase tracking-widest">{activeFile?.language || 'typescript'}</span>
                            </div>
                        </div>
                    </footer>
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
                onPublish={handlePublish}
            />
        </div>
    );
}
