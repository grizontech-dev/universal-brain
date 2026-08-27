'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Brain, Send, Loader2, Sparkles, Zap, Terminal, Activity, Menu, Plus, Search, User, ArrowRight, Database, Coins, X, Code, Square, TrendingUp, Users, Cpu, Layers, Mic } from 'lucide-react';

import { Logo } from '@/components/ui/Logo';
import { AmbientBackground } from '@/components/chat/AmbientBackground';

import { brainApi, conversationsApi } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useConversations } from '@/context/ConversationContext';
import { useModels } from '@/context/ModelContext';
import { useCredits } from '@/context/CreditContext';
import { useThreadList } from '@/context/ThreadListContext';
import BrainUserMessage from './BrainUserMessage';
import BrainAgentMessage from './BrainAgentMessage';
import BrainClarificationCard from './BrainClarificationCard';
import BrainAgentStatus, { type AgentStep } from './BrainAgentStatus';
import BrainPlanCanvas from './BrainPlanCanvas';
import { useExecutionStore } from '../store/execution-store';
import { useStream } from '../lib/streaming/useStream';
import { fetchSession, type SessionState, workflowPhaseLabel, workflowPhaseColor, updateSessionField } from '../lib/brainSession';
import { createProject, getProject, appendRequirement, updateProjectStack } from '../lib/projectMemory';
import BrainEditorCanvas from './BrainEditorCanvas';
import BrainFrameworkSelector from './BrainFrameworkSelector';
import BrainWorkspaceBoot from './BrainWorkspaceBoot';
import BrainBuildPlan from './BrainBuildPlan';

import { DEFAULT_BRAIN_FRAMEWORK, type BrainFrameworkId } from '../constants/frameworks';
import {
    type BuildActivity,
    type BuildTodoItem,
    parseProgressToActivity,
    workspaceOpToActivity,
    mapBackendActivity,
    isBuildTodosComplete,
    mergeTodosFromPlan,
    markAllTodosComplete,
    markRunningActivitiesDone,
    applyActivitiesToTodos,
    currentTaskIndexFromTodos,
    dedupeReloadActivities,
    markReloadPreviewDone,
    isReloadPreviewActivity,
} from '../lib/buildActivity';
import { saveBuildSession, resolveBuildSessionForReload } from '../lib/buildSession';
import { setFileDiff } from '../lib/brainFileDiffStore';
import {
    fetchResumePayload,
    normalizeTodosForResume,
    shouldStreamResumeBuild,
} from '../lib/resumeBrainBuild';

interface ClarificationQuestion {
    id: string;
    text: string;
    options: string[];
    type?: 'single' | 'multi';
    allowAll?: boolean;
}

interface Message {
    id: string;
    role: 'user' | 'agent' | 'clarification';
    content: string;
    timestamp: string;
    clarificationData?: ClarificationQuestion[];
    planContent?: string;
    planVersions?: string[];
    sandboxJob?: any;
    todoList?: {
        task: string;
        description: string;
        status: 'pending' | 'executing' | 'completed' | 'failed';
    }[];
    planApproved?: boolean;
    thoughts?: string;
    timeline?: any[];
    exploreGroups?: any[];
    durationSeconds?: number;
    metadata?: any;
}

interface BrainMessagesProps {
    onToggleSidebarAction?: () => void;
}

const normalizeClarificationQuestions = (raw: any) => {
    const questions = Array.isArray(raw) ? raw : (raw?.questions || []);

    if (!Array.isArray(questions)) return [];

    return questions.map((q: any, index: number) => {
        const text = q?.text || q?.question || '';
        const rawOptions = q?.options || [];
        const options = Array.isArray(rawOptions)
            ? rawOptions.map((opt: any) => (typeof opt === 'string' ? opt : opt?.label)).filter(Boolean)
            : [];

        return {
            id: q?.id || `q${index}`,
            text,
            options,
            type: q?.type || q?.mode || 'single',
            allowAll: q?.allowAll ?? true,
        };
    }).filter((q: any) => q.text);
};

// Safe storage wrapper to prevent Tracking Prevention / privacy mode DOMExceptions in Edge/Brave/Safari
const safeStorage = {
    getItem: (key: string): string | null => {
        try {
            if (typeof window === 'undefined') return null;
            return sessionStorage.getItem(key);
        } catch {
            return null;
        }
    },
    setItem: (key: string, value: string): void => {
        try {
            if (typeof window === 'undefined') return;
            sessionStorage.setItem(key, value);
        } catch {}
    },
    removeItem: (key: string): void => {
        try {
            if (typeof window === 'undefined') return;
            sessionStorage.removeItem(key);
        } catch {}
    }
};

export default function BrainMessages({ onToggleSidebarAction }: BrainMessagesProps) {
    const router = useRouter();
    const pathname = usePathname();
    const { isAuthenticated, openAuthModal, user, isLoading: isAuthLoading, getAccessToken } = useAuth();
    const BRAIN_URL = process.env.NEXT_PUBLIC_BRAIN_API_URL || 'http://localhost:8001';
    const { currentConversationId, conversations, addConversation, touchConversation, fetchConversations, setConversationId, selectConversation } = useConversations();
    const { selectedModel } = useModels();
    const { balance, refreshBalance } = useCredits();
    const { setThreadListOpen } = useThreadList();
    const [messages, setMessages] = useState<Message[]>([]);
    const messagesRef = useRef(messages);
    messagesRef.current = messages;

    const userCredits = balance?.available || balance?.total || 0;
    const activeConversation = conversations.find(c => c.id === currentConversationId);
    const [input, setInput] = useState('');
    const [isEditorOpen, setIsEditorOpen] = useState(false);
    const [questionRounds, setQuestionRounds] = useState(0);
    const [activeEditorFile, setActiveEditorFile] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [agentStep, setAgentStep] = useState<AgentStep>('idle');
    const currentPlanContentRef = useRef<string>("");

    // Live store hooks for instant reactive UI
    const liveThoughts = useExecutionStore((s) => s.streamingMessage);
    const liveTimeline = useExecutionStore((s) => s.timeline);
    const [tokenEstimate, setTokenEstimate] = useState<number | null>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [brainAttachments, setBrainAttachments] = useState<Array<{ id: string; name: string; status: 'uploading' | 'ready' }>>([]);
    const activeConvIdRef = useRef<string | null>(null);
    const abortControllerRef = useRef<AbortController | null>(null);
    const sendingRef = useRef(false);
    const userScrolledUpRef = useRef(false);
    const pollTaskIndexRef = useRef(-1);
    const maxSeenTaskIndexRef = useRef(-1);

    const handleBrainFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files || files.length === 0) return;
        const fileList = Array.from(files);
        for (const file of fileList) {
            const tempId = crypto.randomUUID();
            setBrainAttachments(prev => [...prev, { id: tempId, name: file.name, status: 'uploading' }]);
            try {
                const base64 = await new Promise<string>((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve((reader.result as string).split(',')[1] || '');
                    reader.onerror = reject;
                    reader.readAsDataURL(file);
                });

                const token = (typeof getAccessToken === 'function' ? getAccessToken() : null) || 
                    (typeof window !== 'undefined' ? localStorage.getItem('auth_token') || localStorage.getItem('access_token') || localStorage.getItem('grizon_access_token') : null);

                const reqHeaders: Record<string, string> = {
                    'Content-Type': 'application/json',
                    ...(token ? { 'Authorization': `Bearer ${token}` } : {})
                };

                let res = await fetch('/api/v1/files/upload', {
                    method: 'POST',
                    headers: reqHeaders,
                    credentials: 'include',
                    body: JSON.stringify({
                        fileName: file.name,
                        fileType: file.type || 'application/pdf',
                        fileSize: file.size,
                        contentBase64: base64,
                    }),
                }).catch(() => null);

                if (!res || !res.ok) {
                    res = await fetch('http://localhost:4000/api/v1/files/upload', {
                        method: 'POST',
                        headers: reqHeaders,
                        credentials: 'include',
                        body: JSON.stringify({
                            fileName: file.name,
                            fileType: file.type || 'application/pdf',
                            fileSize: file.size,
                            contentBase64: base64,
                        }),
                    }).catch(() => null);
                }

                if (res && res.ok) {
                    const data = await res.json();
                    const uploadedId = data.data?.file?.id || tempId;
                    setBrainAttachments(prev => prev.map(item => item.id === tempId ? { ...item, id: uploadedId, status: 'ready' } : item));
                } else {
                    setBrainAttachments(prev => prev.filter(item => item.id !== tempId));
                }
            } catch {
                setBrainAttachments(prev => prev.filter(item => item.id !== tempId));
            }
        }
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    // Reset sending lock when conversation changes (prevents stale lock from blocking new conversations)
    useEffect(() => {
        sendingRef.current = false;
        pollTaskIndexRef.current = -1;
        maxSeenTaskIndexRef.current = -1;
        // CRITICAL FIX: Reset pendingMessageHandledRef when conversation changes
        // Without this, client-side navigation (no remount) keeps the ref as 'true'
        // from the previous conversation, causing pending messages to be silently skipped
        pendingMessageHandledRef.current = false;
    }, [currentConversationId]);

    // Sync ref with URL param
    useEffect(() => {
        if (currentConversationId) {
            activeConvIdRef.current = currentConversationId;
        }
    }, [currentConversationId]);

    // Use sessionStorage to track navigation state across component instances
    const isNavigatingToNewRef = useRef(false);
    const getNavigatingFlag = () => {
        return safeStorage.getItem('brainNavigatingToNew') === 'true';
    };
    const setNavigatingFlag = (value: boolean) => {
        if (value) safeStorage.setItem('brainNavigatingToNew', 'true');
        else safeStorage.removeItem('brainNavigatingToNew');
        isNavigatingToNewRef.current = value;
    };
    const pendingMessageHandledRef = useRef(false);
    const projectIdRef = useRef<string | null>(null);
    const latestJobRef = useRef<{ streamUrl: string, jobId: string, todoList?: any[], syncUrl?: string } | null>(null);
    const pendingAutoClarifyRef = useRef<string | null>(null);
    const autoClarifyRoundsRef = useRef(0);
    const autoClarifyEnabled = false;

    const [activeSandboxJob, setActiveSandboxJob] = useState<{ streamUrl: string, jobId: string, todoList?: any[], syncUrl?: string } | null>(null);
    const [selectedFramework, setSelectedFramework] = useState<BrainFrameworkId>(DEFAULT_BRAIN_FRAMEWORK);

    const handleFrameworkChange = (fw: BrainFrameworkId) => {
        setSelectedFramework(fw);
        window.dispatchEvent(new CustomEvent('brainFrameworkChange', { detail: { framework: fw } }));
    };

    const [isBuildMode, setIsBuildMode] = useState(false);
    const [buildActivities, setBuildActivities] = useState<BuildActivity[]>([]);
    const [buildTodos, setBuildTodos] = useState<BuildTodoItem[]>([]);
    const [buildJob, setBuildJob] = useState<{ jobId: string, syncUrl?: string, streamUrl?: string, framework?: string } | null>(null);
    const [buildStartedAt, setBuildStartedAt] = useState<number | null>(null);
    const [buildFinishedAt, setBuildFinishedAt] = useState<number | null>(null);
    const [isBuildSyncing, setIsBuildSyncing] = useState(false);
    const [buildTick, setBuildTick] = useState(0);
    const buildSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const resumeAfterReloadRef = useRef(false);
    const stoppedByUserRef = useRef(false);
    const interruptedMsgRef = useRef<{ id: string; role: 'agent'; content: string; timestamp: string } | null>(null);
    const stoppedAtRef = useRef<number | null>(null);
    const frozenWorkedSeconds = useRef<number | null>(null);
    const isStopped = useExecutionStore((s) => s.isStopped);

    // Capture exact worked seconds when stop happens — computed during render for instant freeze
    if (isStopped && frozenWorkedSeconds.current === null && buildStartedAt) {
        frozenWorkedSeconds.current = Math.floor((Date.now() - buildStartedAt) / 1000);
    }


    const [sessionState, setSessionState] = useState<SessionState | null>(null);

    // Close the chat history sidebar when build mode starts
    useEffect(() => {
        if (isBuildMode) {
            setThreadListOpen(false);
        }
    }, [isBuildMode, setThreadListOpen]);

    // Force canvas open when buildJob becomes available (handles timing gap before component mounts)
    const buildJobRef = useRef(buildJob);
    useEffect(() => {
        if (buildJob && buildJob !== buildJobRef.current) {
            setTimeout(() => {
                window.dispatchEvent(new CustomEvent('openBrainEditor', { detail: buildJob }));
                window.dispatchEvent(new CustomEvent('openSandboxCanvas', { detail: buildJob }));
            }, 0);
        }
        buildJobRef.current = buildJob;
    }, [buildJob]);

    // Poll conversation state periodically so UI updates even if SSE events are missed
    const buildPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
    useEffect(() => {
        if (!isBuildMode || !currentConversationId) {
            if (buildPollRef.current) {
                clearInterval(buildPollRef.current);
                buildPollRef.current = null;
            }
            return;
        }
        buildPollRef.current = setInterval(async () => {
            try {
                const res = await conversationsApi.get(currentConversationId);
                const data = res.data?.conversation || res.data;
                if (res.success && data?.messages) {
                    const lastAssistant = [...data.messages].reverse().find((m: any) => {
                        const r = (m.role || '').toUpperCase();
                        return r === 'ASSISTANT' || r === 'AGENT';
                    });
                    if (lastAssistant) {
                        let metadata: any = lastAssistant.metadata || {};
                        if (typeof metadata === 'string') {
                            try { metadata = JSON.parse(metadata); } catch { metadata = {}; }
                        }
                        const todoData = lastAssistant.todoList || metadata.todoList || metadata.plan || [];
                        if (Array.isArray(todoData) && todoData.length > 0) {
                            const currentTaskIndex = metadata.current_task_index;
                            const shouldRecalcStatus = typeof currentTaskIndex === 'number' && currentTaskIndex >= 0;

                            // Only update if this poll has a higher task index than the max ever seen
                            // (from either SSE or previous polling), so that SSE-driven updates
                            // (which are more current) aren't overwritten by stale polling data.
                            const taskIndex = shouldRecalcStatus ? currentTaskIndex : -1;

                            if (taskIndex > maxSeenTaskIndexRef.current) {
                                maxSeenTaskIndexRef.current = taskIndex;
                                pollTaskIndexRef.current = taskIndex;

                                const normalized = shouldRecalcStatus
                                    ? mergeTodosFromPlan(
                                        todoData.map((t: BuildTodoItem) => ({
                                            ...t,
                                            status: t.status === 'completed' || t.status === 'failed' ? t.status : 'pending',
                                        })),
                                        currentTaskIndex,
                                        'building',
                                    )
                                    : todoData.map((t: any) => ({
                                        ...t,
                                        task: t.task || t.title || t.label || 'Unnamed Task',
                                        status: t.status || 'pending',
                                    }));
                                setBuildTodos(prev => {
                                    if (prev.length === 0 || JSON.stringify(prev) !== JSON.stringify(normalized)) {
                                        return normalized;
                                    }
                                    return prev;
                                });
                            }

                            // Sync messages state so left-side conversation list
                            // shows per-task progress entries (saved by backend BG-TASK).
                            setMessages((prev) => {
                                const prevIds = new Set(prev.map((m: any) => m.id));
                                const newMsgs = (data.messages || []).filter((m: any) => !prevIds.has(m.id));
                                if (newMsgs.length > 0) {
                                    return [...prev, ...newMsgs.map((m: any) => ({
                                        id: m.id,
                                        role: m.role,
                                        content: m.content || '',
                                        timestamp: m.createdAt,
                                        todoList: m.todoList,
                                        sandboxJob: m.sandboxJob,
                                        metadata: m.metadata,
                                    }))];
                                }
                                return prev;
                            });
                        }
                        const actData = metadata.activities || metadata.buildActivities;
                        if (Array.isArray(actData) && actData.length > 0) {
                            for (const a of actData) {
                                if (a.path && (a.diff || a.isNew)) {
                                    setFileDiff(a.path, {
                                        diff: a.diff,
                                        isNew: a.isNew,
                                        linesAdded: a.linesAdded,
                                        linesRemoved: a.linesRemoved,
                                        label: a.label,
                                    });
                                }
                            }
                            setBuildActivities(prev => {
                                if (prev.length === 0 || prev.length < actData.length) {
                                    return actData.map((a: any, i: number) => ({
                                        id: a.id || `poll-act-${i}`,
                                        type: a.type || 'narration',
                                        label: a.label || a.text || '',
                                        timestamp: a.timestamp || Date.now(),
                                        status: a.status || 'running',
                                    }));
                                }
                                return prev;
                            });
                        }
                        const sj = lastAssistant.sandboxJob || metadata.sandboxJob || metadata.sandbox_job;
                        if (sj) {
                            const jobData = {
                                jobId: sj.job_id || sj.jobId,
                                syncUrl: sj.sync_url || sj.syncUrl,
                                streamUrl: sj.stream_url || sj.streamUrl,
                                framework: sj.framework || selectedFramework,
                            };
                            if (jobData.streamUrl) {
                                window.dispatchEvent(
                                    new CustomEvent('brainPreviewReady', { detail: { url: jobData.streamUrl, streamUrl: jobData.streamUrl } })
                                );
                            }
                            if (jobData.jobId) {
                                setBuildJob(prev => {
                                    if (!prev || prev.jobId !== jobData.jobId) return jobData;
                                    return prev;
                                });
                                setIsEditorOpen(true);
                            }
                        }
                    }
                }
            } catch { }
        }, 5000);
        return () => {
            if (buildPollRef.current) clearInterval(buildPollRef.current);
        };
    }, [isBuildMode, currentConversationId, selectedFramework]);

    // Persist project_id to sessionStorage whenever currentConversationId is known
    useEffect(() => {
        if (projectIdRef.current && currentConversationId) {
            sessionStorage.setItem(`brain_project_${currentConversationId}`, projectIdRef.current);
        }
    }, [currentConversationId]);

    const ensureProjectForConversation = useCallback(async (convId: string, title: string): Promise<string | null> => {
        try {
            const project = await createProject({
                name: title,
                description: `Brain project for conversation: ${convId}`,
                owner_id: user?.id || 'anonymous',
            });
            projectIdRef.current = project.id;
            sessionStorage.setItem(`brain_project_${convId}`, project.id);
            await updateSessionField(convId, 'project_id', project.id);
            return project.id;
        } catch (err) {
            console.warn('Failed to create project memory:', err);
            return null;
        }
    }, [user]);

    useEffect(() => {
        if (!isBuildMode || !buildStartedAt || buildFinishedAt) return;
        const id = setInterval(() => setBuildTick((t) => t + 1), 1000);
        return () => clearInterval(id);
    }, [isBuildMode, buildStartedAt, buildFinishedAt]);

    useEffect(() => {
        window.dispatchEvent(
            new CustomEvent('brainBuildModeChange', { detail: { active: isBuildMode } })
        );
    }, [isBuildMode]);

    const applyPlanToTodos = useCallback(
        (
            plan: BuildTodoItem[],
            opts?: { activeIndex?: number; buildPhase?: 'building' | 'runner' | 'complete' }
        ) => {
            if (!plan.length) return;
            const activeIndex = opts?.activeIndex;
            const taskIndex = typeof activeIndex === 'number' ? activeIndex : -1;

            // Only apply if this is a forward progression (or no specific index),
            // so that faster SSE events don't regress the UI when a slower duplicate arrives.
            if (taskIndex > maxSeenTaskIndexRef.current || taskIndex < 0) {
                if (taskIndex > maxSeenTaskIndexRef.current) {
                    maxSeenTaskIndexRef.current = taskIndex;
                }
                const effectiveIndex = opts?.activeIndex !== undefined 
                    ? opts.activeIndex 
                    : (maxSeenTaskIndexRef.current >= 0 ? maxSeenTaskIndexRef.current : undefined);
                setBuildTodos(mergeTodosFromPlan(plan, effectiveIndex, opts?.buildPhase));
            }
        },
        []
    );

    const syncTodosFromActivities = useCallback((items: BuildActivity[]) => {
        if (!items.length) return;
        setBuildTodos((prev) => {
            if (!prev.length) return prev;
            return applyActivitiesToTodos(prev, items);
        });
    }, []);

    const appendBuildActivities = useCallback((items: BuildActivity[]) => {
        if (!items.length) return;
        syncTodosFromActivities(items);
        setBuildActivities((prev) => {
            const ids = new Set(prev.map((a) => a.id));
            const recentLabels = prev.slice(-12).map((a) => a.label);
            const next = [...prev];
            for (const item of items) {
                if (ids.has(item.id)) continue;
                if (isReloadPreviewActivity(item)) {
                    const reloadIdx = next.findIndex(isReloadPreviewActivity);
                    if (reloadIdx >= 0) {
                        next[reloadIdx] = item;
                        continue;
                    }
                }
                if (
                    item.type === 'run_command' &&
                    recentLabels.includes(item.label)
                ) {
                    continue;
                }
                // Dedup file operations by path — keep the latest version of each file
                if (
                    (item.type === 'write_file' || item.type === 'edit_file' || item.type === 'mkdir') &&
                    item.path
                ) {
                    const existingIdx = next.findIndex(
                        (a) =>
                            a.path === item.path &&
                            (a.type === 'write_file' || a.type === 'edit_file' || a.type === 'mkdir')
                    );
                    if (existingIdx >= 0) {
                        const prev = next[existingIdx];
                        const merged = { ...prev, ...item, id: prev.id };
                        if (!merged.diff && prev.diff) merged.diff = prev.diff;
                        if (!merged.linesAdded && prev.linesAdded) merged.linesAdded = prev.linesAdded;
                        if (!merged.linesRemoved && prev.linesRemoved) merged.linesRemoved = prev.linesRemoved;
                        if (merged.isNew === undefined && prev.isNew !== undefined) merged.isNew = prev.isNew;
                        if (!merged.path && prev.path) merged.path = prev.path;
                        next[existingIdx] = merged;
                        ids.add(item.id);
                        continue;
                    }
                }
                next.push(item);
                ids.add(item.id);
                recentLabels.push(item.label);
                if (item.path && (item.diff || item.isNew)) {
                    setFileDiff(item.path, {
                        diff: item.diff,
                        isNew: item.isNew,
                        linesAdded: item.linesAdded,
                        linesRemoved: item.linesRemoved,
                        label: item.label,
                    });
                }
            }
            return dedupeReloadActivities(next.slice(-200));
        });
    }, [syncTodosFromActivities]);

    const ingestBuildPayload = useCallback((exe: Record<string, unknown>) => {
        const acts = exe.activities as Record<string, unknown>[] | undefined;
        if (acts?.length) {
            appendBuildActivities(
                acts.map((a) => mapBackendActivity(a)).filter((a): a is BuildActivity => !!a)
            );
        }
        const ops = exe.workspace_ops as { op: string; path?: string; command?: string }[] | undefined;
        if (ops?.length) {
            appendBuildActivities(
                ops.map((o) => workspaceOpToActivity(o)).filter((a): a is BuildActivity => !!a)
            );
        }
        const progressMsg = exe.progress_msg as string | undefined;
        if (progressMsg) {
            const parsed = parseProgressToActivity(progressMsg);
            if (parsed) appendBuildActivities([parsed]);
            if (progressMsg.includes('[TEMPLATE]') || progressMsg.includes('[FILE]')) {
                setIsBuildSyncing(true);
                if (buildSyncTimerRef.current) clearTimeout(buildSyncTimerRef.current);
                buildSyncTimerRef.current = setTimeout(() => setIsBuildSyncing(false), 800);
            }
        }
    }, [appendBuildActivities]);

    const completeRunnerBuild = useCallback(() => {
        setIsBuildSyncing(false);
        setBuildFinishedAt((prev) => prev ?? Date.now());
        setBuildTodos((prev) => (prev.length ? markAllTodosComplete(prev) : prev));
        setBuildActivities((prev) => markReloadPreviewDone(markRunningActivitiesDone(prev)));
        appendBuildActivities([
            {
                id: `act-runner-ready-${Date.now()}`,
                type: 'milestone',
                label: 'Dev server ready — preview is live',
                timestamp: Date.now(),
                status: 'done',
            },
        ]);
    }, [appendBuildActivities]);

    const projectComplete =
        !!buildFinishedAt || (buildTodos.length > 0 && isBuildTodosComplete(buildTodos));

    const handleNewChat = useCallback(() => {
        window.dispatchEvent(new CustomEvent('clear-chat-state'));
        setMessages([]);
        setInput('');
        setIsBuildMode(false);
        setBuildActivities([]);
        setBuildTodos([]);
        setBuildJob(null);
        setBuildStartedAt(null);
        setBuildFinishedAt(null);
        setIsBuildSyncing(false);
        setIsLoading(false);
        setAgentStep('idle');
        setActiveSandboxJob(null);
        setIsEditorOpen(false);
        useExecutionStore.getState().resetExecution();
        interruptedMsgRef.current = null;
        selectConversation(null);
        if (pathname !== '/brain') {
            router.push('/brain');
        }
    }, [selectConversation, pathname, router]);

    const ingestSandboxStreamEvent = useCallback(
        (event: Record<string, unknown>) => {
            // Update thinking message based on event type
            const execStore = useExecutionStore.getState();
            if (event.strategic_plan) {
                execStore.setPhase('PLANNING');
                execStore.updateAgent('leader', { status: 'THINKING', currentTask: 'Creating project plan' });
                execStore.setStreamingMessage('Creating project plan...');
            } else if (event.recursive_clarify || event.questions) {
                execStore.setPhase('CLARIFYING');
                execStore.updateAgent('leader', { status: 'THINKING', currentTask: 'Preparing questions' });
                execStore.setStreamingMessage('Preparing questions...');
            } else if (event.create_tasks) {
                execStore.setPhase('BUILDING');
                execStore.updateAgent('leader', { status: 'THINKING', currentTask: 'Setting up build tasks' });
                execStore.setStreamingMessage('Setting up build tasks...');
            } else if (event.init_sandbox || event.execute_sandbox) {
                execStore.setPhase('EXECUTING');
                execStore.updateAgent('builder', { status: 'THINKING', currentTask: 'Building project' });
                execStore.setStreamingMessage('Building project...');
            }

            if (event.status === 'stopped' || event.stopped) {
                stoppedByUserRef.current = true;
                stoppedAtRef.current = Date.now();
                useExecutionStore.getState().setStopped();
                setIsLoading(false);
                setAgentStep('idle');
                setIsBuildSyncing(false);
                // Keep isBuildMode=true so Continue button remains visible
                useExecutionStore.getState().setStreamingMessage(null);
                sendingRef.current = false;
                appendBuildActivities([
                    {
                        id: `act-stopped-${Date.now()}`,
                        type: 'narration',
                        label: 'Project generation interrupted.',
                        timestamp: Date.now(),
                        status: 'done',
                    },
                ]);
                // Show interrupted message in chat
                setMessages(prev => {
                    if (prev.some(m => m.id.startsWith('interrupted-'))) return prev;
                    if (prev.some(m => m.content?.includes('nterrupted') && m.role === 'agent')) return prev;
                    const lastMsg = prev[prev.length - 1];
                    if (lastMsg?.role === 'user') return prev;
                    const cleaned = prev.filter(m =>
                        !(m.role === 'agent' && m.id.startsWith('brain_') && !m.content && !m.planContent && !m.clarificationData)
                    );
                    return [...cleaned, {
                        id: `interrupted-sse-${Date.now()}`,
                        role: 'agent',
                        content: 'Build was interrupted. Press Continue to resume from where it stopped.',
                        timestamp: new Date().toLocaleTimeString(),
                    }];
                });
                return;
            }

            if (event.create_tasks) {
                const tasks = ((event.create_tasks as Record<string, unknown>).plan || []) as BuildTodoItem[];
                if (tasks.length) {
                    applyPlanToTodos(tasks, { activeIndex: 0, buildPhase: 'building' });
                    setIsBuildMode(true);
                }
            }

            // Resume returned plan review — store plan content so UI shows plan card
            if (event.strategic_plan) {
                const planData = (event.strategic_plan as Record<string, unknown>).project_plan
                    || (event.strategic_plan as Record<string, unknown>).plan;
                const planStr = planData
                    ? (typeof planData === 'string' ? planData : JSON.stringify(planData))
                    : ((event.strategic_plan as Record<string, unknown>).report as string || "");
                if (planStr) {
                    currentPlanContentRef.current = planStr;
                }
            }

            if (event.init_sandbox || event.execute_sandbox) {
                const nodeData = (event.init_sandbox || event.execute_sandbox) as Record<string, unknown>;
                const inner = (nodeData.execute_sandbox || nodeData) as Record<string, unknown>;
                setIsBuildMode(true);

                const planFromNode = (nodeData.plan || inner.plan) as BuildTodoItem[] | undefined;
                const taskIndex =
                    typeof nodeData.current_task_index === 'number'
                        ? nodeData.current_task_index
                        : typeof inner.current_task_index === 'number'
                            ? inner.current_task_index
                            : undefined;
                const nodeStatus = String(nodeData.status || inner.status || '');

                if (Array.isArray(planFromNode) && planFromNode.length > 0) {
                    if (nodeStatus === 'building_complete') {
                        const runnerIdx = planFromNode.findIndex(
                            (t) => (t.category || '').toLowerCase() === 'runner'
                        );
                        applyPlanToTodos(planFromNode, {
                            activeIndex: runnerIdx >= 0 ? runnerIdx : planFromNode.length,
                            buildPhase: 'runner',
                        });
                    } else {
                        applyPlanToTodos(planFromNode, {
                            activeIndex: taskIndex,
                            buildPhase: 'building',
                        });
                    }
                }

                ingestBuildPayload(inner);

                const ops = inner.workspace_ops as unknown[] | undefined;
                if (ops?.length) {
                    setIsBuildSyncing(true);
                    if (buildSyncTimerRef.current) clearTimeout(buildSyncTimerRef.current);
                    buildSyncTimerRef.current = setTimeout(() => setIsBuildSyncing(false), 800);
                    window.dispatchEvent(
                        new CustomEvent('applyBrainWorkspaceOps', { detail: { ops } })
                    );
                    window.dispatchEvent(new CustomEvent('refreshBrainFiles'));
                }

                const sandboxJob = (inner.sandbox_job || nodeData.sandbox_job) as
                    | Record<string, unknown>
                    | undefined;
                if (sandboxJob?.job_id) {
                    const job = {
                        jobId: String(sandboxJob.job_id),
                        syncUrl: sandboxJob.sync_url as string | undefined,
                        streamUrl: sandboxJob.stream_url as string | undefined,
                        framework: (sandboxJob.framework as string) || selectedFramework,
                    };
                    setBuildJob(job);
                    setIsEditorOpen(true);
                    setTimeout(() => {
                        window.dispatchEvent(new CustomEvent('openBrainEditor', { detail: job }));
                    }, 0);
                }

                const progressMsg = inner.progress_msg || nodeData.progress_msg;
                if (progressMsg) {
                    window.dispatchEvent(
                        new CustomEvent('updateSandboxProgress', {
                            detail: { progressMsg, todoList: planFromNode },
                        })
                    );
                }
            }

            if (event.task_orchestrator) {
                const orch = event.task_orchestrator as Record<string, unknown>;
                if (Array.isArray(orch.plan)) {
                    setBuildTodos(orch.plan as BuildTodoItem[]);
                }
                if (orch.status === 'all_tasks_completed') {
                    setIsBuildSyncing(false);
                }
            }

            if (event.final_report) {
                setIsBuildSyncing(false);
                const frInner = ((event.final_report as Record<string, unknown>).execute_sandbox ||
                    {}) as Record<string, unknown>;
                if (frInner.workspace_ops) {
                    ingestBuildPayload(frInner);
                }

                const frSandboxJob = frInner.sandbox_job as Record<string, unknown> | undefined;
                const tunnelUrl = (frSandboxJob?.tunnel_url || frSandboxJob?.stream_url) as string | undefined;
                if (tunnelUrl) {
                    window.dispatchEvent(new CustomEvent('brainPreviewReady', {
                        detail: { url: tunnelUrl, streamUrl: tunnelUrl }
                    }));
                    const frJob = {
                        jobId: String(frSandboxJob?.job_id || currentConversationId || ''),
                        syncUrl: frSandboxJob?.sync_url as string | undefined,
                        streamUrl: tunnelUrl,
                        framework: (frSandboxJob?.framework as string) || selectedFramework,
                    };
                    setBuildJob(frJob);
                    window.dispatchEvent(new CustomEvent('openBrainEditor', { detail: frJob }));
                    window.dispatchEvent(new CustomEvent('openSandboxCanvas', { detail: frJob }));
                }

                completeRunnerBuild();
            }
        },
        [
            applyPlanToTodos,
            ingestBuildPayload,
            completeRunnerBuild,
            selectedFramework,
        ]
    );

    const startResumeStream = useCallback(
        async (conversationId: string, framework: string, todos: BuildTodoItem[]) => {
            // Reset the stop ref FIRST — this function IS the resume action
            stoppedByUserRef.current = false;

            // Clear stopped state — but DON'T set isBuildMode yet
            // Backend will decide: plan review OR build mode
            useExecutionStore.getState().clearStopped();
            frozenWorkedSeconds.current = null;
            setIsLoading(true);
            setAgentStep('executing');
            sendingRef.current = true;

            // Create a thinking message so BrainAgentStatus has a container to render in
            const resumeMsgId = `resume-msg-${Date.now()}`;
            setMessages(prev => [...prev, {
                id: resumeMsgId,
                role: 'agent',
                content: '',
                timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                metadata: { agentStep: 'executing' },
            }]);

            // Show thinking indicator immediately in chat
            const execStore = useExecutionStore.getState();
            execStore.setPhase('RESUMING');
            execStore.updateAgent('leader', { status: 'THINKING', currentTask: 'Resuming project...' });
            execStore.setStreamingMessage('Resuming project...');

            if (abortControllerRef.current) {
                abortControllerRef.current.abort();
            }
            abortControllerRef.current = new AbortController();

            appendBuildActivities([
                {
                    id: `act-resume-stream-${Date.now()}`,
                    type: 'narration',
                    label: 'Resuming project generation...',
                    timestamp: Date.now(),
                    status: 'running',
                },
            ]);

            try {
                await brainApi.streamChat(
                    {
                        user_id: user?.id || 'anonymous',
                        conversation_id: conversationId,
                        content: '__RESUME_BUILD__',
                        model_id: selectedModel?.id || 'deepseek-chat',
                        plan_approved: false,
                        resume_build: true,
                        framework,
                        temperature: 0.3,
                        question_rounds: questionRounds,
                    },
                    (event) => { 
                        if (!event || typeof event !== 'object') return;
                        ingestSandboxStreamEvent(event as Record<string, unknown>);
                    },
                    abortControllerRef.current?.signal
                );
            } catch (e) {
                console.error('[Brain] resume stream failed:', e);
                setMessages(prev => [...prev, {
                    id: `resume-stream-error-${Date.now()}`,
                    role: 'agent',
                    content: 'Build resume stream failed. The backend may be unavailable. Please try starting a new build.',
                    timestamp: new Date().toLocaleTimeString()
                }]);
            } finally {
                // Remove the resume thinking message (replace with plan if needed)
                setMessages(prev => {
                    const filtered = prev.filter(m => m.id !== resumeMsgId);
                    // If resume returned a plan (not build tasks), save it as a message for plan review
                    if (!isBuildMode && currentPlanContentRef.current) {
                        if (filtered.some(m => m.id.startsWith('brain_plan_') && m.planContent)) return filtered;
                        return [...filtered, {
                            id: `brain_plan_${Date.now()}`,
                            role: 'agent' as const,
                            content: '',
                            planContent: currentPlanContentRef.current,
                            timestamp: new Date().toLocaleTimeString(),
                            metadata: { agentStep: 'strategic_plan' },
                        }];
                    }
                    return filtered;
                });
                if (!isBuildMode && currentPlanContentRef.current) {
                    setAgentStep('planning');
                }
                // Clear thinking indicator
                useExecutionStore.getState().setStreamingMessage(null);
                setIsLoading(false);
                sendingRef.current = false;
            }
        },
        [
            user?.id,
            selectedModel?.id,
            questionRounds,
            ingestSandboxStreamEvent,
            setMessages,
            appendBuildActivities,
            isLoading,
        ]
    );

    const handleResumeBuild = useCallback(async () => {
        const convId = activeConvIdRef.current || currentConversationId;
        if (!convId || isLoading) return;
        stoppedByUserRef.current = false;
        stoppedAtRef.current = null;
        interruptedMsgRef.current = null;
        // Remove "Build was interrupted" message immediately
        setMessages(prev => prev.filter(m => !m.content?.includes('nterrupted') || m.role !== 'agent'));
        await startResumeStream(convId, selectedFramework, buildTodos);
    }, [currentConversationId, selectedFramework, buildTodos, startResumeStream, isLoading]);

    const resumeBrainAfterReload = useCallback(
        async (conversationId: string, framework: string, todos: BuildTodoItem[], autoStartStream = false) => {
            if (!conversationId || resumeAfterReloadRef.current) return;
            resumeAfterReloadRef.current = true;

            const payload = await fetchResumePayload(conversationId, framework, user?.id);
            if (!payload) {
                console.warn('[Brain] No resume payload — workspace not found or backend unreachable');
                setMessages(prev => [...prev, {
                    id: `resume-error-${Date.now()}`,
                    role: 'agent',
                    content: 'Build state could not be restored on reload. The backend workspace may have been cleaned up. Please start a new build.',
                    timestamp: new Date().toLocaleTimeString()
                }]);
                resumeAfterReloadRef.current = false;
                return;
            }

            const normalized = normalizeTodosForResume(todos, payload);
            setIsBuildMode(true);
            setIsBuildSyncing(true);
            setBuildTodos(normalized);

            if (payload.build_complete) {
                appendBuildActivities([
                    {
                        id: 'act-reload-preview',
                        type: 'narration',
                        label: 'Reloaded — restoring preview (npm run dev)…',
                        timestamp: Date.now(),
                        status: 'running',
                    },
                ]);
            } else {
                appendBuildActivities([
                    {
                        id: `act-resume-${payload.current_task_index}`,
                        type: 'narration',
                        label: `Restoring build state from task ${payload.current_task_index + 1}…`,
                        timestamp: Date.now(),
                        status: 'done',
                    },
                ]);
            }

            window.dispatchEvent(
                new CustomEvent('openBrainEditor', {
                    detail: {
                        jobId: conversationId,
                        syncUrl: payload.sync_url,
                        streamUrl: payload.tunnel_url,
                        framework: payload.framework,
                        runtime: 'sandbox_mcp',
                        todoList: normalized,
                    },
                })
            );
            if (payload.tunnel_url) {
                window.dispatchEvent(
                    new CustomEvent('brainPreviewReady', { detail: { url: payload.tunnel_url, streamUrl: payload.tunnel_url } })
                );
            }

            const allOps = [...(payload.workspace_ops || []), ...(payload.startup_ops || [])];
            if (allOps.length) {
                window.dispatchEvent(
                    new CustomEvent('applyBrainWorkspaceOps', { detail: { ops: allOps } })
                );
            }
            window.dispatchEvent(new CustomEvent('refreshBrainFiles'));

            setIsBuildSyncing(false);
            resumeAfterReloadRef.current = false;

            if (payload.build_complete) {
                completeRunnerBuild();
                return;
            }

            // If build was stopped by user, show message but don't auto-resume
            if (payload.was_stopped_by_user) {
                setMessages(prev => {
                    if (prev.some(m => m.content?.includes('nterrupted') && m.role === 'agent')) return prev;
                    return [...prev, {
                        id: `stopped-notice-${Date.now()}`,
                        role: 'agent',
                        content: 'Build was interrupted. Press Continue to resume from where it stopped.',
                        timestamp: new Date().toLocaleTimeString()
                    }];
                });
                return;
            }

            // If the backend is STILL building this conversation (background task
            // survived the reload), don't start a second build — the 5s poll picks
            // up progress. Only auto-resume the build stream when nothing is running
            // server-side, so the project continues from the exact task it stopped at.
            const canAutoResume =
                autoStartStream &&
                !payload.build_active &&
                !stoppedByUserRef.current &&
                shouldStreamResumeBuild(todos, payload);

            if (canAutoResume) {
                void startResumeStream(conversationId, framework, normalized);
            }
        },
        [
            appendBuildActivities,
            completeRunnerBuild,
            setMessages,
            startResumeStream,
        ]
    );

    useEffect(() => {
        // If we are currently sending or streaming a prompt, do NOT wipe messages or reset loading state!
        if (sendingRef.current || isLoading) return;

        // Don't clear messages on initial load — fetchHistory will set them from DB
        // Only clear when user explicitly switches conversations (messages already exist)
        if (messagesRef.current.length === 0) {
            // Initial load — fetchHistory will populate messages
            return;
        }

        resumeAfterReloadRef.current = false;

        // Reset conversation and build specific states immediately to avoid stale closures and visual leaks
        setMessages([]);
        setIsBuildMode(false);
        setBuildActivities([]);
        setBuildTodos([]);
        setBuildJob(null);
        setBuildStartedAt(null);
        setBuildFinishedAt(null);
        setIsBuildSyncing(false);
        setIsLoading(false);
        setAgentStep('idle');
        setActiveSandboxJob(null);
        setIsEditorOpen(false);
    }, [currentConversationId]);

    useEffect(() => {
        const prevConvId = activeConvIdRef.current;
        if (prevConvId && prevConvId !== currentConversationId) {
            if (sendingRef.current) {
                if (abortControllerRef.current) {
                    abortControllerRef.current.abort();
                    abortControllerRef.current = null;
                }
                useExecutionStore.getState().setStopped();
                void brainApi.stopChat(prevConvId).catch(err => {
                    console.error('[Brain] Failed to stop chat for prev conv:', err);
                });
                sendingRef.current = false;
                setIsLoading(false);
            }
        }
        activeConvIdRef.current = currentConversationId;
    }, [currentConversationId]);

    useEffect(() => {
        const handleUnload = () => {
            // NOTE: Do NOT stop the build on reload/close. The builder runs as a
            // background task that survives client disconnect, so the project keeps
            // running and resumes from where it was on the next load. Stopping here
            // kills the build on refresh, which is the opposite of the desired UX.
        };

        window.addEventListener('beforeunload', handleUnload);
        return () => {
            window.removeEventListener('beforeunload', handleUnload);
            if (sendingRef.current) {
                useExecutionStore.getState().setStopped();
                const convId = activeConvIdRef.current;
                if (convId && convId !== 'new') {
                    void brainApi.stopChat(convId).catch(err => {
                        console.error('[Brain] Failed to stop chat during unmount:', err);
                    });
                }
            }
        };
    }, []);

    useEffect(() => {
        if (isBuildMode && buildTodos.length > 0 && isBuildTodosComplete(buildTodos)) {
            setIsBuildSyncing(false);
            setBuildFinishedAt((prev) => prev ?? Date.now());
            setBuildActivities((prev) => markReloadPreviewDone(markRunningActivitiesDone(prev)));
        }
    }, [isBuildMode, buildTodos]);

    useEffect(() => {
        if (!currentConversationId || !isBuildMode) return;
        saveBuildSession(currentConversationId, {
            todos: buildTodos,
            activities: buildActivities,
            buildStartedAt,
            isBuildMode: true,
            currentTaskIndex: currentTaskIndexFromTodos(buildTodos),
        });
    }, [currentConversationId, isBuildMode, buildTodos, buildActivities, buildStartedAt]);

    // Fetch session state from brain backend when conversation loads
    useEffect(() => {
        if (!currentConversationId || currentConversationId === 'new') {
            setSessionState(null);
            return;
        }
        let cancelled = false;
        fetchSession(currentConversationId).then((res) => {
            if (!cancelled && res?.exists) {
                setSessionState(res.data);
                if (res.data?.project_id) {
                    projectIdRef.current = res.data.project_id as string;
                }
            }
            if (!cancelled && !projectIdRef.current) {
                const stored = sessionStorage.getItem(`brain_project_${currentConversationId}`);
                if (stored) {
                    projectIdRef.current = stored;
                }
            }
        });
        return () => { cancelled = true; };
    }, [currentConversationId]);

    useEffect(() => {
        if (!isBuildMode) return;
        const onRunnerComplete = () => completeRunnerBuild();
        const onPreview = (e: Event) => {
            const port = (e as CustomEvent).detail?.port;
            if (typeof port === 'number' && port >= 5173 && port <= 5180) {
                completeRunnerBuild();
            }
        };
        window.addEventListener('brainBuildRunnerComplete', onRunnerComplete);
        window.addEventListener('brainPreviewReady', onPreview);
        return () => {
            window.removeEventListener('brainBuildRunnerComplete', onRunnerComplete);
            window.removeEventListener('brainPreviewReady', onPreview);
        };
    }, [isBuildMode, completeRunnerBuild]);

    // Listen for WebSocket "stopped" event from builder background task
    useEffect(() => {
        const onBuildStopped = (e: Event) => {
            stoppedByUserRef.current = true;
            stoppedAtRef.current = Date.now();
            useExecutionStore.getState().setStopped();
            setIsLoading(false);
            setAgentStep('idle');
            setIsBuildSyncing(false);
            // Keep isBuildMode=true so Continue button remains visible
            useExecutionStore.getState().setStreamingMessage(null);
            sendingRef.current = false;
            appendBuildActivities([{
                id: `act-stopped-ws-${Date.now()}`,
                type: 'narration',
                label: 'Project generation interrupted.',
                timestamp: Date.now(),
                status: 'done',
            }]);
            // Show interrupted message in chat
            setMessages(prev => {
                if (prev.some(m => m.id.startsWith('interrupted-'))) return prev;
                if (prev.some(m => m.content?.includes('nterrupted') && m.role === 'agent')) return prev;
                const lastMsg = prev[prev.length - 1];
                if (lastMsg?.role === 'user') return prev;
                const cleaned = prev.filter(m =>
                    !(m.role === 'agent' && m.id.startsWith('brain_') && !m.content && !m.planContent && !m.clarificationData)
                );
                return [...cleaned, {
                    id: `interrupted-ws-${Date.now()}`,
                    role: 'agent',
                    content: 'Build was interrupted. Press Continue to resume from where it stopped.',
                    timestamp: new Date().toLocaleTimeString(),
                }];
            });
        };
        window.addEventListener('brainBuildStopped', onBuildStopped);
        return () => window.removeEventListener('brainBuildStopped', onBuildStopped);
    }, [appendBuildActivities]);

    useEffect(() => {
        const onProgress = (e: Event) => {
            const d = (e as CustomEvent).detail || {};
            let activeIndex: number | undefined = undefined;
            if (d.progressMsg) {
                try {
                    const pm = typeof d.progressMsg === 'string' ? JSON.parse(d.progressMsg) : d.progressMsg;
                    if (pm && pm.taskId !== undefined) {
                        activeIndex = parseInt(pm.taskId);
                    }
                } catch {
                    const match = String(d.progressMsg).match(/taskId["']?\s*:\s*["']?(\d+)/);
                    if (match) activeIndex = parseInt(match[1]);
                }
            }

            if (d.todoList?.length) {
                setBuildTodos((prev) => {
                    if (prev.length && isBuildTodosComplete(prev)) {
                        return prev;
                    }
                    // Only count actually completed/failed tasks from backend to avoid synthetic executing status causing false regressions
                    const prevDone = prev.filter(t => t.status === 'completed' || t.status === 'failed').length;
                    const newDone = (d.todoList as BuildTodoItem[]).filter(t => t.status === 'completed' || t.status === 'failed').length;
                    if (prev.length && prevDone > newDone) {
                        return prev; // don't regress — incoming payload is older than current state
                    }

                    if (activeIndex === undefined) {
                        const executingIndex = prev.findIndex(t => t.status === 'executing');
                        if (executingIndex >= 0) activeIndex = executingIndex;
                    }

                    return mergeTodosFromPlan(d.todoList as BuildTodoItem[], activeIndex, 'building');
                });
            }
            if (d.progressMsg) {
                const parsed = parseProgressToActivity(String(d.progressMsg));
                if (parsed) {
                    appendBuildActivities([parsed]);
                    if (parsed.label.toLowerCase().includes('dev server is ready')) {
                        completeRunnerBuild();
                    }
                }
            }
        };
        const onBuildActivity = (e: Event) => {
            const acts = (e as CustomEvent).detail?.activities as Record<string, unknown>[] | undefined;
            if (acts?.length) {
                appendBuildActivities(
                    acts.map((a) => mapBackendActivity(a)).filter((a): a is BuildActivity => !!a)
                );
            }
        };
        window.addEventListener('updateSandboxProgress', onProgress);
        window.addEventListener('brainBuildActivity', onBuildActivity);
        return () => {
            window.removeEventListener('updateSandboxProgress', onProgress);
            window.removeEventListener('brainBuildActivity', onBuildActivity);
        };
    }, [appendBuildActivities, completeRunnerBuild]);

    useEffect(() => {
        if (input.trim()) {
            setTokenEstimate(Math.ceil(input.length / 3.8));
        } else {
            setTokenEstimate(null);
        }
    }, [input]);

    const scrollToBottom = (force = false) => {
        if (!scrollContainerRef.current) return;

        const container = scrollContainerRef.current;
        if (!force && userScrolledUpRef.current) return;

        const isAtBottom = container.scrollHeight - container.scrollTop <= container.clientHeight + 50;

        if (force || isAtBottom) {
            userScrolledUpRef.current = false;
            container.scrollTop = container.scrollHeight;
        }
    };

    useEffect(() => {
        const container = scrollContainerRef.current;
        if (!container) return;

        const onScroll = () => {
            const isAtBottom = container.scrollHeight - container.scrollTop <= container.clientHeight + 50;
            userScrolledUpRef.current = !isAtBottom;
        };

        container.addEventListener('scroll', onScroll, { passive: true });
        return () => container.removeEventListener('scroll', onScroll);
    }, []);

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    // Load initial messages if we have a conversation ID
    useEffect(() => {
        const navigating = getNavigatingFlag();
        const hasPendingMessage = !!safeStorage.getItem('brainPendingMessage');
        if (pathname === '/brain' && !navigating && !hasPendingMessage && !sendingRef.current && !isLoading) {
            // Auto-stop any running tasks only when landing on the New Chat screen
            if (abortControllerRef.current) {
                abortControllerRef.current.abort();
                abortControllerRef.current = null;
            }
            useExecutionStore.getState().setStreamingMessage(null);

            setMessages([]);
            setIsLoading(false);
            setAgentStep('idle');
            setActiveSandboxJob(null);
            setIsBuildMode(false);
            setBuildJob(null);
            setBuildActivities([]);
            setBuildTodos([]);
            setIsEditorOpen(false);
            // Close canvas when starting new chat
            window.dispatchEvent(new CustomEvent('closeBrainCanvas'));
            window.dispatchEvent(new CustomEvent('closeBrainEditor'));
            return;
        }

        const fetchHistory = async () => {
            if (!currentConversationId || !pathname.startsWith('/brain/')) return;

            // If build was stopped and messages already exist locally, don't overwrite
            if (stoppedByUserRef.current && messagesRef.current.length > 0) return;

            if (isAuthLoading) {
                return;
            }

            if (!isAuthenticated) {
                if (currentConversationId && currentConversationId !== 'new') {
                    openAuthModal('signin-email');
                }
                return;
            }

            // If we are currently loading or sending, don't fetch history to avoid interrupting the active stream/state.
            if (isLoading || sendingRef.current) {
                return;
            }

            // If there's a pending message, the new component instance will handle it via the pending message effect.
            // Skip history fetch to avoid overwriting the user message that handleSendMessage will add.
            const pendingMsg = safeStorage.getItem('brainPendingMessage');
            if (pendingMsg) {
                return;
            }

            // Always clear nav flag when we arrive and have no pending message
            setNavigatingFlag(false);

            try {
                const res = await conversationsApi.get(currentConversationId);
                const data = res.data?.conversation || res.data;
                if (res.success && data?.messages) {
                    const mappedMessages = data.messages.map((m: any) => {
                        // Check if it's a clarification payload
                        if (m.role?.toUpperCase() === 'ASSISTANT' && m.content.startsWith('__CLARIFY__:')) {
                            try {
                                const jsonStr = m.content.replace('__CLARIFY__:', '');
                                const data = JSON.parse(jsonStr);

                                let metadata = m.metadata || {};
                                if (typeof metadata === 'string') {
                                    try { metadata = JSON.parse(metadata); } catch (e) { metadata = {}; }
                                }

                                return {
                                    id: m.id,
                                    role: 'clarification' as const,
                                    content: data.preamble || 'I need a few more details to create the perfect plan.',
                                    timestamp: m.createdAt ? new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '',
                                    clarificationData: normalizeClarificationQuestions(data.questions),
                                    thoughts: metadata.thoughts || undefined
                                } as Message;
                            } catch (e) {
                                return {
                                    id: m.id,
                                    role: 'agent' as const,
                                    content: m.content,
                                    timestamp: m.createdAt ? new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''
                                } as Message;
                            }
                        }

                        const isJSONPlan = m.role?.toUpperCase() === 'ASSISTANT' && (m.content.trim().startsWith('{') || m.content.trim().startsWith('["{'));
                        const isMDPlan = m.role?.toUpperCase() === 'ASSISTANT' && m.content.includes('## Strategic Plan');
                        const isPlan = isJSONPlan || isMDPlan;
                        const hasTodo = m.content.includes('### ✅ Project Roadmap');

                        let displayContent = m.content;
                        // Aggressive check: If content is JSON or a plan report, replace with status msg
                        if (isPlan || m.content.trim().startsWith('{')) {
                            displayContent = "I've architected a strategic roadmap for your project. Please review the Technical Strategy in the Brain Canvas below.";
                            if (hasTodo && isMDPlan) {
                                // If it has a todo list in Markdown, extract it to show in chat
                                const todoPart = m.content.split('### ✅ Project Roadmap')[1];
                                displayContent += '\n\n### ✅ Project Roadmap\n' + todoPart;
                            }
                        }

                        let metadata = m.metadata || {};
                        if (typeof metadata === 'string') {
                            try { metadata = JSON.parse(metadata); } catch (e) { metadata = {}; }
                        }
                        const todoData = m.todoList || metadata.todoList || metadata.plan || [];
                        const normalizedTodo = Array.isArray(todoData) ? todoData.map((t: any) => ({
                            ...t,
                            task: t.task || t.title || t.label || 'Unnamed Task',
                            status: t.status || 'pending'
                        })) : [];

                        const rawPlanContent = isPlan
                            ? m.content
                            : (metadata.planContent
                                ? (typeof metadata.planContent === 'string'
                                    ? metadata.planContent
                                    : JSON.stringify(metadata.planContent))
                                : undefined);
                        const planContent = rawPlanContent && rawPlanContent !== "{}" ? rawPlanContent : undefined;

                        return {
                            id: m.id,
                            role: (m.role?.toUpperCase() === 'USER' ? 'user' : 'agent') as 'user' | 'agent',
                            content: displayContent,
                            timestamp: m.createdAt ? new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '',
                            planContent,
                            todoList: normalizedTodo.length > 0 ? normalizedTodo : undefined,
                            sandboxJob: m.sandboxJob || metadata.sandboxJob || metadata.sandbox_job,
                            planApproved: !!(metadata.planApproved || normalizedTodo.length > 0),
                            clarificationData: (m.role?.toUpperCase() === 'ASSISTANT' && metadata.questions_data) ? normalizeClarificationQuestions(metadata.questions_data) : undefined,
                            thoughts: metadata.thoughts || undefined,
                            exploreGroups: metadata.exploreGroups || undefined,
                            durationSeconds: typeof metadata.durationSeconds === 'number' ? metadata.durationSeconds : undefined,
                        } as Message;
                    });

                    // Convert past clarification messages into regular agent messages (preserve preamble text)
                    // Only show the active clarification card if it's the LAST message (still awaiting answers)
                    const isLastIdx = mappedMessages.length - 1;
                    const filteredMessages = mappedMessages.map((msg: any, index: number) => {
                        if (msg.clarificationData && msg.clarificationData.length > 0) {
                            if (index === isLastIdx) {
                                // Last message — keep as interactive clarification card
                                return msg;
                            }
                            // Past clarification — convert to a regular agent message showing the preamble as a thought
                            return {
                                ...msg,
                                role: 'agent' as const,
                                thoughts: msg.content || msg.thoughts, // Show preamble as the thought block!
                                content: '', // Clear main text so it doesn't show as raw markdown
                                clarificationData: undefined, // Remove the card UI (already answered)
                                // Keep content as preamble, add a timeline marker showing it was answered
                                timeline: [
                                    ...(msg.timeline || []),
                                    { id: 'clarified', text: 'Clarified requirements', type: 'SUCCESS' }
                                ]
                            };
                        }
                        return msg;
                    });

                    // Only set messages if we actually got some, or if we aren't in a "new conversation" transition
                    // Also set if there's a pending message (new conversation with stream about to run)
                    const hasPendingMessage = sessionStorage.getItem('brainPendingMessage');
                    // Filter out auto-generated "request changes" / "reject plan" messages — they are internal feedback,
                    // not real user messages, and should not reappear on reload.
                    const autoFeedbackPatterns = [
                        /^I would like to request changes to this plan:.*Please review and update the strategy\.$/i,
                        /^I reject this plan\.\s*Let'?s rethink the strategy\.$/i,
                    ];
                    const cleanedMessages = filteredMessages.filter((msg: any) => {
                        if (msg.role !== 'user') return true;
                        const text = (msg.content || '').trim();
                        return !autoFeedbackPatterns.some(pat => pat.test(text));
                    });
                    if (cleanedMessages.length > 0 || !getNavigatingFlag() || hasPendingMessage) {
                        setMessages(cleanedMessages);
                        userScrolledUpRef.current = false;
                        requestAnimationFrame(() => requestAnimationFrame(() => scrollToBottom(true)));

                        // Auto-hydrate active sandbox if found in recent messages
                        const latestSandboxMsg = [...mappedMessages].reverse().find(m => m.sandboxJob);
                        if (latestSandboxMsg) {
                            const jobData = {
                                jobId: latestSandboxMsg.sandboxJob.job_id || latestSandboxMsg.sandboxJob.jobId,
                                syncUrl: latestSandboxMsg.sandboxJob.sync_url || latestSandboxMsg.sandboxJob.syncUrl,
                                streamUrl: latestSandboxMsg.sandboxJob.stream_url || latestSandboxMsg.sandboxJob.streamUrl,
                                framework: latestSandboxMsg.sandboxJob.framework || selectedFramework,
                                todoList: latestSandboxMsg.todoList,
                                runtime: latestSandboxMsg.sandboxJob.runtime || 'sandbox',
                            };
                            setActiveSandboxJob(jobData);
                            latestJobRef.current = jobData;

                            const restored = resolveBuildSessionForReload(
                                currentConversationId,
                                latestSandboxMsg.todoList
                            );
                            if (restored) {
                                setBuildTodos(restored.todos);
                                const restoredActs = dedupeReloadActivities(restored.activities);
                                setBuildActivities(restoredActs);
                                for (const a of restoredActs) {
                                    if (a.path && (a.diff || a.isNew)) {
                                        setFileDiff(a.path, {
                                            diff: a.diff,
                                            isNew: a.isNew,
                                            linesAdded: a.linesAdded,
                                            linesRemoved: a.linesRemoved,
                                            label: a.label,
                                        });
                                    }
                                }
                                if (restored.buildStartedAt) {
                                    setBuildStartedAt(restored.buildStartedAt);
                                } else if (isBuildTodosComplete(restored.todos)) {
                                    setBuildStartedAt(Date.now() - 60_000);
                                    setBuildFinishedAt(Date.now());
                                } else if (typeof latestSandboxMsg.durationSeconds === 'number' && latestSandboxMsg.durationSeconds > 0) {
                                    // Restore buildStartedAt from stored duration on reload
                                    setBuildStartedAt(Date.now() - (latestSandboxMsg.durationSeconds * 1000));
                                }
                                setIsBuildMode(true);
                                setBuildJob({
                                    jobId: String(jobData.jobId),
                                    syncUrl: jobData.syncUrl,
                                    streamUrl: jobData.streamUrl,
                                    framework: jobData.framework,
                                });
                            } else if (latestSandboxMsg.todoList?.length) {
                                setBuildTodos(
                                    mergeTodosFromPlan(latestSandboxMsg.todoList as BuildTodoItem[])
                                );
                                setIsBuildMode(true);
                                // Restore buildStartedAt from stored duration on reload
                                if (typeof latestSandboxMsg.durationSeconds === 'number' && latestSandboxMsg.durationSeconds > 0) {
                                    setBuildStartedAt(Date.now() - (latestSandboxMsg.durationSeconds * 1000));
                                }
                                setBuildJob({
                                    jobId: String(jobData.jobId),
                                    syncUrl: jobData.syncUrl,
                                    streamUrl: jobData.streamUrl,
                                    framework: jobData.framework,
                                });
                            }

                            setIsEditorOpen(true);
                            setTimeout(() => {
                                window.dispatchEvent(new CustomEvent('openSandboxCanvas', { detail: jobData }));
                                window.dispatchEvent(new CustomEvent('openBrainEditor', { detail: jobData }));
                            }, 500);

                            const hasApprovedPlan = mappedMessages.some(
                                (m: Message) => m.planApproved || (m.todoList && m.todoList.length > 0)
                            );
                            if (hasApprovedPlan) {
                                // Check if build was stopped BEFORE resuming
                                let wasStoppedOnReload = false;
                                try {
                                    const stopCheckRes = await fetchResumePayload(
                                        currentConversationId,
                                        jobData.framework || selectedFramework,
                                        user?.id
                                    );
                                    wasStoppedOnReload = !!stopCheckRes?.was_stopped_by_user;
                                } catch {
                                    // Ignore — workspace may not exist
                                }

                                if (wasStoppedOnReload) {
                                    // Build was interrupted — show message, don't resume
                                    useExecutionStore.getState().setStopped();
                                    setMessages(prev => {
                                        // Remove orphaned user message (never got AI response)
                                        // Must run BEFORE dedup check since DB may already have "Build interrupted"
                                        const hasOrphanedUser = prev[prev.length - 1]?.role === 'user'
                                            && !prev.slice(0, -1).some(m => m.role === 'agent' && m.timestamp > prev[prev.length - 1].timestamp);
                                        const cleaned = hasOrphanedUser ? prev.slice(0, -1) : prev;
                                        if (cleaned.some(m => m.content?.includes('nterrupted') && m.role === 'agent')) return cleaned;
                                        return [...cleaned, {
                                            id: `stopped-notice-${Date.now()}`,
                                            role: 'agent',
                                            content: 'Build was interrupted. Press Continue to resume from where it stopped.',
                                            timestamp: new Date().toLocaleTimeString(),
                                        }];
                                    });
                                } else {
                                    const todosForResume =
                                        restored?.todos?.length
                                            ? restored.todos
                                            : (latestSandboxMsg.todoList as BuildTodoItem[]) || [];
                                    void resumeBrainAfterReload(
                                        currentConversationId,
                                        jobData.framework || selectedFramework,
                                        todosForResume,
                                        true
                                    );
                                }
                            } else {
                                // Even without approved plan, check if build was stopped
                                // so we can show the "Build was interrupted" message
                                try {
                                    const resumeRes = await fetchResumePayload(
                                        currentConversationId,
                                        jobData.framework || selectedFramework,
                                        user?.id
                                    );
                                    if (resumeRes?.was_stopped_by_user) {
                                        setMessages(prev => {
                                            // Remove orphaned user message (never got AI response)
                                            const hasOrphanedUser = prev[prev.length - 1]?.role === 'user'
                                                && !prev.slice(0, -1).some(m => m.role === 'agent' && m.timestamp > prev[prev.length - 1].timestamp);
                                            const cleaned = hasOrphanedUser ? prev.slice(0, -1) : prev;
                                            if (cleaned.some(m => m.content?.includes('nterrupted') && m.role === 'agent')) return cleaned;
                                            return [...cleaned, {
                                                id: `stopped-notice-${Date.now()}`,
                                                role: 'agent',
                                                content: 'Build was interrupted. Press Continue to resume from where it stopped.',
                                                timestamp: new Date().toLocaleTimeString(),
                                            }];
                                        });
                                    }
                                } catch {
                                    // Ignore — not critical
                                }
                            }
                        }
                        // If no sandbox job exists, still check if build was stopped
                        if (!latestSandboxMsg) {
                            // Check if last message has agentStep=stopped (backend saved it)
                            const lastMsg = mappedMessages[mappedMessages.length - 1];
                            const lastMeta = lastMsg?.metadata || {};
                            const hasStoppedInDB = lastMeta.agentStep === 'stopped';

                            // Also check via sandbox resume endpoint (covers race condition)
                            let wasStopped = hasStoppedInDB;
                            if (!wasStopped) {
                                try {
                                    const resumeRes = await fetchResumePayload(
                                        currentConversationId,
                                        selectedFramework,
                                        user?.id
                                    );
                                    wasStopped = !!resumeRes?.was_stopped_by_user;
                                } catch {
                                    // Ignore — workspace may not exist
                                }
                            }

                            if (wasStopped) {
                                useExecutionStore.getState().setStopped();
                                setMessages(prev => {
                                    if (prev.some(m => m.content?.includes('nterrupted') && m.role === 'agent')) return prev;
                                    const lastMsg = prev[prev.length - 1];
                                    if (lastMsg?.role === 'user') return prev;
                                    return [...prev, {
                                        id: `stopped-notice-${Date.now()}`,
                                        role: 'agent',
                                        content: 'Build was interrupted. Press Continue to resume from where it stopped.',
                                        timestamp: new Date().toLocaleTimeString(),
                                    }];
                                });
                            }
                        }
                    }
                }
            } catch (err) {
                console.error('Failed to fetch brain history:', err);
            }
        };

        // Wrap in async IIFE to properly sequence fetchHistory and pending message check
        (async () => {
            await fetchHistory();

            // After fetching history, check if there's a pending message to send
            // This handles the case where we navigated from /brain with a new message
            if (!pendingMessageHandledRef.current) {
                const pendingStr = safeStorage.getItem('brainPendingMessage');
                if (!pendingStr) {
                    console.log('[Brain] No pending message found in sessionStorage');
                    pendingMessageHandledRef.current = true;
                    return;
                }

                // Check if we already have assistant messages (stream already ran)
                const hasAssistantMessages = messages.some(m => m.role === 'agent' || m.role === 'clarification');
                if (hasAssistantMessages) {
                    console.log('[Brain] Already has assistant messages, skipping pending message');
                    safeStorage.removeItem('brainPendingMessage');
                    pendingMessageHandledRef.current = true;
                    return;
                }

                // If auth is not ready yet, wait and retry later — don't consume the ref
                if (!isAuthenticated || isAuthLoading) {
                    console.log('[Brain] Auth not ready for pending message, waiting...');
                    return;
                }

                // If conversation ID is not yet synced from URL, wait for next effect cycle
                if (!currentConversationId) {
                    console.log('[Brain] Conversation ID not ready for pending message, waiting...');
                    return;
                }

                const pending = JSON.parse(pendingStr);
                console.log('[Brain] New component picked up pending message:', pending.userText?.substring(0, 50));
                if (pending.projectId) {
                    projectIdRef.current = pending.projectId;
                }

                // Small delay to ensure component is fully settled
                await new Promise(r => setTimeout(r, 150));

                // CONSUME IMMEDIATELY BEFORE SENDING to prevent duplicate dispatch on Fast Refresh / re-renders
                pendingMessageHandledRef.current = true;
                safeStorage.removeItem('brainPendingMessage');
                setNavigatingFlag(false);

                // Force-clear stale loading/sending state from previous handleSendMessage call
                setIsLoading(false);
                sendingRef.current = false;
                try {
                    await handleSendMessage(
                        pending.userText,
                        pending.temperature,
                        pending.isPlanApproval,
                        pending.approvedPlan,
                        pending.targetMessageId,
                        pending.attachedFileIds
                    );
                    console.log('[Brain] Pending message sent successfully');
                } catch (e) {
                    console.error('[Brain] Pending message send failed:', e);
                    // On error, restore pending state so it can retry
                    safeStorage.setItem('brainPendingMessage', pendingStr);
                    pendingMessageHandledRef.current = false;
                    return;
                }
            } else {
                // CRITICAL FIX: If ref is already true but there's still a pending message,
                // it means the ref wasn't properly reset. Force retry.
                const staleCheck = safeStorage.getItem('brainPendingMessage');
                if (staleCheck && currentConversationId) {
                    console.warn('[Brain] pendingMessageHandledRef was true but pending message exists — resetting ref');
                    pendingMessageHandledRef.current = false;
                }
            }
        })();
    }, [currentConversationId, pathname, resumeBrainAfterReload, selectedFramework, isAuthenticated, isAuthLoading, openAuthModal]);

    useEffect(() => {
        const handleApprove = () => {
            if (!isLoading) {
                handleSendMessage('✅ Plan Approved');
            }
        };

        const handleOpenSandbox = (e: any) => {
            const detail = e.detail || {};
            const jobId = detail.jobId || detail.job_id;
            if (!jobId) {
                console.warn('BrainMessages: Invalid sandbox event detail (missing jobId)', detail);
                return;
            }
            const jobData = {
                jobId,
                syncUrl: detail.syncUrl || detail.sync_url,
                streamUrl: detail.streamUrl || detail.stream_url,
                framework: detail.framework || selectedFramework,
                todoList: detail.todoList,
                runtime: detail.runtime || 'sandbox',
            };
            setActiveSandboxJob(jobData);
            latestJobRef.current = jobData;
            setBuildJob(jobData);
            setIsBuildMode(true);
            setIsEditorOpen(true);
            window.dispatchEvent(new CustomEvent('openBrainEditor', { detail: jobData }));
        };

        window.addEventListener('triggerBrainApprove', handleApprove);
        window.addEventListener('openSandboxCanvas', handleOpenSandbox);

        return () => {
            window.removeEventListener('triggerBrainApprove', handleApprove);
            window.removeEventListener('openSandboxCanvas', handleOpenSandbox);
        };
    }, [isLoading, currentConversationId]); // Added dependencies to ensure fresh closures

    const handleSendMessage = async (
        overrideText?: string | any,
        temperature: number = 0.3,
        isPlanApproval?: boolean,
        approvedPlan?: string,
        targetMessageId?: string,
        overrideFileIds?: string[]
    ) => {
        const textValue = typeof overrideText === 'string' ? overrideText : input;
        const activeFileIds = overrideFileIds || brainAttachments.map(a => a.id);
        console.log('BrainMessages: handleSendMessage called', { textValue, isPlanApproval, targetMessageId, activeFileIds });

        if (!isAuthenticated) {
            openAuthModal('signin-email');
            return;
        }

        const userText = (textValue || '').trim();
        if (!userText || isLoading || sendingRef.current) return;
        sendingRef.current = true;
        useExecutionStore.getState().clearStopped();

        // Force isUpdate based strictly on targetMessageId presence
        const isUpdate = typeof targetMessageId === 'string' && targetMessageId.length > 0;
        const isRegenerate = typeof overrideText === 'string' && messages.some(m => m.content === overrideText && m.role === 'user');

        if (!isRegenerate && !isUpdate) {
            const userMsg: Message = {
                id: Date.now().toString(),
                role: 'user',
                content: userText,
                timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            };
            setMessages(prev => prev.filter(m => m.role !== 'clarification').concat(userMsg));
            userScrolledUpRef.current = false;
            requestAnimationFrame(() => requestAnimationFrame(() => scrollToBottom(true)));
        }

        setInput('');
        setBrainAttachments([]);
        setIsLoading(true);

        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }
        abortControllerRef.current = new AbortController();

        try {
            // FORCED: If we are on the root /brain path, it is ALWAYS a new conversation.
            const isNew = pathname === '/brain';

            // Priority: 1. Ref (immediate) 2. Context (from URL/state)
            let activeId = isNew ? null : (activeConvIdRef.current || currentConversationId);

            const isApproval = userText.toLowerCase().includes('approve') ||
                userText.toLowerCase().includes('looks good') ||
                userText.toLowerCase() === 'yes' ||
                userText.includes('✅ Plan Approved') ||
                userText.includes('## Strategic Plan') ||
                isPlanApproval ||
                (typeof overrideText === 'string' && overrideText === 'BUILD_PROJECT');

            if (isNew) {
                setNavigatingFlag(true);
                const title = userText.length > 30 ? userText.substring(0, 30) + '...' : userText;
                console.log('[Brain] Creating new conversation for root path...');
                const newConv = await conversationsApi.create({
                    user_id: user?.id || 'anonymous',
                    title: title,
                    status: 'active'
                });
                // Extract ID carefully from nested structure (Node.js backend style)
                activeId = newConv.data?.conversation?.id || newConv.data?.id || (newConv as any).id;
                console.log('[Brain] New conversation created:', activeId);

                if (activeId) {
                    activeConvIdRef.current = activeId;
                    setConversationId(activeId);

                    addConversation({
                        id: activeId,
                        userId: user?.id || 'anonymous',
                        title: title,
                        isArchived: false,
                        createdAt: new Date().toISOString(),
                        updatedAt: new Date().toISOString()
                    });

                    // Fire project creation in background without blocking stream initiation
                    void ensureProjectForConversation(activeId, title);

                    // Update browser address bar URL seamlessly without forcing page unmount/remount
                    if (typeof window !== 'undefined' && window.history) {
                        window.history.replaceState(null, '', `/brain/${activeId}`);
                    }
                    void fetchConversations();
                    setNavigatingFlag(false);
                    safeStorage.removeItem('brainPendingMessage');
                }
                // DO NOT RETURN EARLY! Continue straight to streaming the AI response in-place!
            }

            const aiMsgId = (typeof targetMessageId === 'string' && targetMessageId) ? targetMessageId : `brain_${Date.now()}`;
            const finalAiMsgId = isUpdate ? targetMessageId : aiMsgId;
            const existingMsg = messages.find(m => m.id === finalAiMsgId);

            if (isApproval && existingMsg) {
                setMessages(prev => prev.map(m =>
                    m.id === existingMsg.id ? { ...m, planApproved: true } : m
                ));
            }

            activeConvIdRef.current = activeId || null;

            let approvedPlanContent = approvedPlan || "";
            if (isApproval && !approvedPlanContent) {
                const lastPlanMsg = [...messages].reverse().find(m => m.planContent);
                approvedPlanContent = lastPlanMsg?.planContent || "";
            }

            let fullContent = isApproval ? approvedPlanContent : '';

            // Start with reading step
            setAgentStep('reading');

            // Clear the streaming plan ref so old plan doesn't pop back in
            currentPlanContentRef.current = isApproval ? approvedPlanContent : "";

            // For regular follow-ups (not plan approval), clear the previous build's
            // activities/todos/timeline so the old plan+task UI does NOT attach to the new answer.
            if (!isApproval) {
                setBuildActivities([]);
                setBuildTodos([]);
                setIsBuildSyncing(false);
                setBuildFinishedAt(null);
                useExecutionStore.getState().resetExecution();
            }

            // Initialize/Update the AI message
            setMessages(prev => {
                const existingIdx = prev.findIndex(m => m.id === finalAiMsgId);
                if (existingIdx !== -1) {
                    const next = [...prev];
                    const existing = next[existingIdx];
                    next[existingIdx] = {
                        ...existing,
                        content: isApproval ? 'Plan Approved. Preparing for execution...' : 'Revising architecture based on your feedback...',
                        planContent: isApproval ? (approvedPlanContent || existing.planContent) : "",
                        planVersions: isApproval ? existing.planVersions : (existing.planContent ? [...(existing.planVersions || []), existing.planContent] : existing.planVersions),
                        todoList: existing.todoList || []
                    };
                    return next;
                }
                return [...prev, {
                    id: finalAiMsgId,
                    role: 'agent',
                    content: fullContent || (isUpdate && targetMessageId ? 'Revising architecture based on your feedback...' : ''),
                    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                    planContent: isApproval ? approvedPlanContent : "",
                    todoList: []
                }];
            });
            userScrolledUpRef.current = false;
            requestAnimationFrame(() => requestAnimationFrame(() => scrollToBottom(true)));

            // Store actions
            const execStore = useExecutionStore.getState();

            // Stream state tracking variables - MIRROR EXISTING STATE IF UPDATING/APPROVING
            let accumulatedThoughts = '';
            let currentContent = isApproval ? (approvedPlanContent || "") : '';
            let currentStep: AgentStep = 'analyzing';
            currentPlanContentRef.current = isApproval ? (approvedPlanContent || existingMsg?.planContent || "") : (existingMsg?.planContent || "");
            let currentSandboxJob: any = existingMsg?.sandboxJob || null;
            let currentTodoList: any[] | null = isApproval ? (existingMsg?.todoList || null) : (existingMsg?.todoList || null);
            let currentClarificationData: any = existingMsg?.clarificationData || null;
            let currentPlanApproved = isApproval || !!existingMsg?.planApproved;

            if (isApproval) {
                setIsBuildMode(true);
                setBuildActivities([]);
                setBuildStartedAt(Date.now());
                setBuildFinishedAt(null);
                setIsBuildSyncing(true);
                appendBuildActivities([
                    {
                        id: `act-plan-${Date.now()}`,
                        type: 'narration',
                        label: 'Plan approved — generating tasks and opening workspace…',
                        timestamp: Date.now(),
                        status: 'done',
                    },
                ]);
            } else {
                // Instantly trigger the thinking UI for non-approvals
                execStore.setPhase('ANALYZING');
                execStore.updateAgent('leader', { status: 'THINKING', currentTask: 'Analyzing prompt intent' });
                execStore.setStreamingMessage('Analyzing prompt intent...');
            }

            await brainApi.streamChat({
                user_id: user?.id || 'anonymous',
                conversation_id: activeId as string | undefined,
                content: userText,
                model_id: selectedModel?.id || 'gpt-5.4',
                plan_approved: isApproval,
                approved_plan: isApproval ? approvedPlanContent : undefined,
                question_rounds: questionRounds,
                framework: selectedFramework,
                temperature: temperature,
                project_id: projectIdRef.current || undefined,
                attached_file_ids: activeFileIds,
                attachedFileIds: activeFileIds,
            }, (event) => {
                const eventKeys = Object.keys(event || {});
                if (eventKeys.length === 0) return;

                let chunkUpdate = "";

                try {
                    // --- Stopped (from backend SSE during Phase 1 or Phase 2) ---
                    if (event.status === 'stopped') {
                        stoppedByUserRef.current = true;
                        stoppedAtRef.current = Date.now();
                        useExecutionStore.getState().setStopped();
                        setIsLoading(false);
                        setAgentStep('idle');
                        setIsBuildSyncing(false);
                        // Keep isBuildMode=true so Continue button remains visible
                        useExecutionStore.getState().setStreamingMessage(null);
                        sendingRef.current = false;
                        appendBuildActivities([
                            {
                                id: `act-stopped-${Date.now()}`,
                                type: 'narration',
                                label: 'Project generation interrupted.',
                                timestamp: Date.now(),
                                status: 'done',
                            },
                        ]);
                        // Show interrupted message in chat
                        setMessages(prev => {
                            if (prev.some(m => m.id.startsWith('interrupted-'))) return prev;
                            if (prev.some(m => m.content?.includes('nterrupted') && m.role === 'agent')) return prev;
                            const lastMsg = prev[prev.length - 1];
                            if (lastMsg?.role === 'user') return prev;
                            const cleaned = prev.filter(m =>
                                !(m.role === 'agent' && m.id.startsWith('brain_') && !m.content && !m.planContent && !m.clarificationData)
                            );
                            return [...cleaned, {
                                id: `interrupted-sse2-${Date.now()}`,
                                role: 'agent',
                                content: 'Build was interrupted. Press Continue to resume from where it stopped.',
                                timestamp: new Date().toLocaleTimeString(),
                            }];
                        });
                        return;
                    }

                    // --- Ingress ---
                    if (event.analyze_ingress) {
                        currentStep = 'analyzing';
                        const analysis = event.analyze_ingress.leader_analysis;
                        const thoughtUpdate = typeof analysis === 'object' ? (analysis.analysis || analysis.report || "") : (analysis || "");

                        if (thoughtUpdate) {
                            // Replace the generic "Analyzing prompt intent..." with the actual dynamic thought
                            accumulatedThoughts = thoughtUpdate;
                        }

                        if (event.analyze_ingress.next_agent === 'questions' || event.analyze_ingress.status === 'needs_clarification') {
                            accumulatedThoughts += "\n\nCalling Questions Agent to gather missing context...";
                            execStore.setPhase('QUESTIONING');
                            execStore.updateAgent('planner', { status: 'THINKING', currentTask: 'Generating clarification questions...' });
                        } else {
                            execStore.updateAgent('leader', { status: 'DONE', currentTask: 'Architectural assessment completed' });
                        }

                        // Push to execution store
                        if (!currentContent) {
                            if (accumulatedThoughts) execStore.setStreamingMessage(accumulatedThoughts);
                        }
                        chunkUpdate = ""; // Ensure thoughts don't render as message text
                    }

                    // --- Clarify ---
                    if (event.recursive_clarify) {
                        const clar = event.recursive_clarify;
                        currentStep = 'clarifying';
                        const autoClarifyAnswer = "Proceed with assumptions. Do not ask follow-up questions. Continue to planning and execution.";
                        if (clar.report && clar.report.startsWith('__CLARIFY__:')) {
                            try {
                                const jsonStr = clar.report.replace('__CLARIFY__:', '');
                                const parsed = JSON.parse(jsonStr);
                                const parsedQuestions = normalizeClarificationQuestions(parsed.questions);
                                if (autoClarifyEnabled && parsedQuestions.length > 0 && autoClarifyRoundsRef.current < 1) {
                                    pendingAutoClarifyRef.current = autoClarifyAnswer;
                                    autoClarifyRoundsRef.current += 1;
                                    chunkUpdate = parsed.preamble || "";
                                } else {
                                    currentClarificationData = parsedQuestions;
                                    chunkUpdate = parsed.preamble || chunkUpdate;
                                    if (currentClarificationData && currentClarificationData.length > 0) {
                                        setQuestionRounds(prev => prev + 1);
                                    }
                                }
                            } catch (e) {
                                console.error("Failed to parse clarification JSON", e);
                            }
                        } else if (clar.questions_data) {
                            const parsed = clar.questions_data;
                            const parsedQuestions = normalizeClarificationQuestions(parsed.questions || parsed);
                            if (autoClarifyEnabled && parsedQuestions.length > 0 && autoClarifyRoundsRef.current < 1) {
                                pendingAutoClarifyRef.current = autoClarifyAnswer;
                                autoClarifyRoundsRef.current += 1;
                                chunkUpdate = parsed.preamble || "";
                            } else {
                                currentClarificationData = parsedQuestions;
                                chunkUpdate = parsed.preamble || chunkUpdate;
                                if (currentClarificationData && currentClarificationData.length > 0) {
                                    setQuestionRounds(prev => prev + 1);
                                }
                                execStore.setPhase('QUESTIONING');
                                execStore.updateAgent('planner', { status: 'WORKING', currentTask: 'Formulating questions' });
                                if (chunkUpdate) execStore.setStreamingMessage(chunkUpdate);
                            }
                        } else if (clar.clarifications && Array.isArray(clar.clarifications)) {
                            const parsedQuestions = normalizeClarificationQuestions(clar.clarifications);
                            if (autoClarifyEnabled && parsedQuestions.length > 0 && autoClarifyRoundsRef.current < 1) {
                                pendingAutoClarifyRef.current = autoClarifyAnswer;
                                autoClarifyRoundsRef.current += 1;
                                chunkUpdate = clar.report || "";
                            } else {
                                currentClarificationData = parsedQuestions;
                                if (currentClarificationData.length > 0) {
                                    setQuestionRounds(prev => prev + 1);
                                }
                                if (clar.report) {
                                    chunkUpdate = clar.report;
                                }
                            }
                        } else if (clar.status === 'ready_to_research' || clar.status === 'clarified') {
                            currentStep = 'researching';
                        }
                    }

                    // --- Research ---
                    if (event.web_research) {
                        currentStep = 'researching';
                    }

                    // --- Plan ---
                    if (event.strategic_plan) {
                        currentStep = 'planning';
                        const planData = event.strategic_plan.project_plan || event.strategic_plan.plan;
                        currentPlanContentRef.current = planData ? (typeof planData === 'string' ? planData : JSON.stringify(planData)) : (event.strategic_plan.report || "");
                        chunkUpdate = event.strategic_plan.report || chunkUpdate;

                        execStore.setPhase('PLANNING');
                        execStore.updateAgent('planner', { status: 'WORKING', currentTask: 'Architecting roadmap' });
                        execStore.addTimelineEvent('Strategic Plan Generated', 'SUCCESS');
                        // Intentionally do NOT overwrite the streaming message here so the Manager's thought remains visible.
                    }

                    // --- Create Tasks ---
                    if (event.create_tasks) {
                        currentStep = 'executing';
                        const tasks = (event.create_tasks.plan || []) as BuildTodoItem[];
                        currentTodoList = tasks;
                        applyPlanToTodos(tasks, { activeIndex: 0, buildPhase: 'building' });
                        setIsBuildMode(true);
                        appendBuildActivities([
                            {
                                id: `act-todos-${Date.now()}`,
                                type: 'narration',
                                label: `Created ${tasks.length} tasks for this build`,
                                timestamp: Date.now(),
                                status: 'done',
                            },
                        ]);
                        chunkUpdate = event.create_tasks.report || chunkUpdate;

                        // Persist user's requirement to project memory when tasks are generated
                        if (projectIdRef.current && userText && !isApproval) {
                            appendRequirement(projectIdRef.current, userText).catch((err) =>
                                console.warn('Failed to persist requirement:', err)
                            );
                        }

                        execStore.setPhase('SYNCING');
                        execStore.addTimelineEvent(`Generated ${tasks.length} execution tasks`, 'SUCCESS');
                        if (chunkUpdate) execStore.setStreamingMessage(chunkUpdate);
                        // Convert to dynamic todos for UI
                        const mappedTodos = tasks.map(t => ({
                            id: t.id || t.task || Math.random().toString(),
                            text: t.task || t.title || 'Task',
                            status: t.status === 'completed' || t.status === 'done' ? 'completed' :
                                t.status === 'executing' || t.status === 'running' ? 'in-progress' : 'pending'
                        }));
                        useExecutionStore.setState({ dynamicTodos: mappedTodos as any });
                    }

                    // --- Sandbox (init + per-task execute_sandbox) ---
                    if (event.init_sandbox || event.execute_sandbox) {
                        currentStep = 'executing';
                        const nodeData = (event.init_sandbox || event.execute_sandbox) as Record<string, unknown>;
                        const inner = (nodeData.execute_sandbox || nodeData) as Record<string, unknown>;

                        setIsBuildMode(true);


                        if (nodeData.report) {
                            chunkUpdate = String(nodeData.report);
                        }

                        const planFromNode = (nodeData.plan || inner.plan) as BuildTodoItem[] | undefined;
                        const taskIndex =
                            typeof nodeData.current_task_index === 'number'
                                ? nodeData.current_task_index
                                : typeof inner.current_task_index === 'number'
                                    ? inner.current_task_index
                                    : undefined;
                        const nodeStatus = String(nodeData.status || inner.status || '');

                        if (Array.isArray(planFromNode) && planFromNode.length > 0) {
                            currentTodoList = planFromNode;
                            if (nodeStatus === 'building_complete') {
                                const runnerIdx = planFromNode.findIndex(
                                    (t) => (t.category || '').toLowerCase() === 'runner'
                                );
                                applyPlanToTodos(planFromNode, {
                                    activeIndex: runnerIdx >= 0 ? runnerIdx : planFromNode.length,
                                    buildPhase: 'runner',
                                });
                            } else {
                                applyPlanToTodos(planFromNode, {
                                    activeIndex: taskIndex,
                                    buildPhase: 'building',
                                });
                            }
                        }

                        ingestBuildPayload(inner);

                        const ops = inner.workspace_ops as unknown[] | undefined;
                        if (ops?.length) {
                            setIsBuildSyncing(true);
                            if (buildSyncTimerRef.current) clearTimeout(buildSyncTimerRef.current);
                            buildSyncTimerRef.current = setTimeout(() => setIsBuildSyncing(false), 800);
                            window.dispatchEvent(new CustomEvent('applyBrainWorkspaceOps', {
                                detail: { ops },
                            }));
                            window.dispatchEvent(new CustomEvent('refreshBrainFiles'));
                        }

                        const sandboxJob = (inner.sandbox_job || nodeData.sandbox_job) as Record<string, unknown> | undefined;
                        if (sandboxJob?.job_id) {
                            currentSandboxJob = sandboxJob;
                            const sjTunnelUrl = sandboxJob.tunnel_url as string | undefined;
                            const job = {
                                jobId: String(sandboxJob.job_id),
                                syncUrl: sandboxJob.sync_url as string | undefined,
                                streamUrl: sjTunnelUrl || sandboxJob.stream_url as string | undefined,
                                framework: (sandboxJob.framework as string) || selectedFramework,
                            };
                            setBuildJob(job);
                            setIsEditorOpen(true);
                            setTimeout(() => {
                                window.dispatchEvent(new CustomEvent('openBrainEditor', { detail: job }));
                            }, 0);
                            if (sjTunnelUrl) {
                                window.dispatchEvent(new CustomEvent('brainPreviewReady', {
                                    detail: { url: sjTunnelUrl, streamUrl: sjTunnelUrl }
                                }));
                            }
                        }

                        const progressMsg = inner.progress_msg || nodeData.progress_msg;
                        if (progressMsg) {
                            window.dispatchEvent(new CustomEvent('updateSandboxProgress', {
                                detail: { progressMsg, todoList: currentTodoList },
                            }));
                            try {
                                const pm = typeof progressMsg === 'string' ? JSON.parse(progressMsg) : progressMsg;
                                if (pm.tunnel_url) {
                                    window.dispatchEvent(new CustomEvent('brainPreviewReady', {
                                        detail: { url: pm.tunnel_url, streamUrl: pm.tunnel_url }
                                    }));
                                }
                            } catch { /* not JSON */ }
                        }
                    }

                    // --- Task Started (live progress before builder begins) ---
                    if (event.task_started) {
                        const ts = event.task_started;
                        const taskIndex = ts.current_task_index as number | undefined;
                        const totalTasks = ts.total_tasks as number | undefined;
                        const taskLabel = ts.task_label as string || '';
                        const planFromTs = ts.plan as BuildTodoItem[] | undefined;

                        if (Array.isArray(planFromTs) && planFromTs.length > 0) {
                            currentTodoList = planFromTs;
                            applyPlanToTodos(planFromTs, {
                                activeIndex: taskIndex ?? 0,
                                buildPhase: 'building',
                            });
                        }

                        if (typeof taskIndex === 'number' && typeof totalTasks === 'number') {
                            chunkUpdate = `🔄 Task ${taskIndex + 1}/${totalTasks}: ${taskLabel}`;
                        }
                    }

                    // --- Task Failed ---
                    if (event.task_failed) {
                        const tf = event.task_failed;
                        const failedIndex = tf.current_task_index as number | undefined;
                        const reason = tf.reason as string || 'Task failed';
                        const planFromFailed = tf.plan as BuildTodoItem[] | undefined;

                        if (Array.isArray(planFromFailed) && planFromFailed.length > 0) {
                            currentTodoList = planFromFailed;
                            applyPlanToTodos(planFromFailed, {
                                activeIndex: typeof failedIndex === 'number' ? failedIndex + 1 : undefined,
                                buildPhase: 'building',
                            });
                        }

                        chunkUpdate = `⚠️ Task failed: ${reason}`;
                        appendBuildActivities([{
                            id: `act-fail-${Date.now()}`,
                            type: 'task_failed',
                            label: reason,
                            timestamp: Date.now(),
                            status: 'failed',
                        }]);
                    }

                    // --- Tasks (second handler) ---
                    if (event.create_tasks) {
                        const ct = event.create_tasks;
                        const progress = ct.progress_msg || ct.report;
                        if (progress) {
                            chunkUpdate = (currentContent ? (currentContent + "\n\n") : "") + String(progress);
                        }
                        const planFromCt = ct.plan as BuildTodoItem[] | undefined;
                        if (Array.isArray(planFromCt) && planFromCt.length > 0) {
                            currentTodoList = planFromCt;
                            applyPlanToTodos(planFromCt, {
                                activeIndex: 0,
                                buildPhase: 'building',
                            });
                        }
                    }

                    // --- Orchestrator ---
                    if (event.task_orchestrator) {
                        const orch = event.task_orchestrator;
                        if (orch.plan) {
                            currentTodoList = orch.plan;
                            setBuildTodos(orch.plan as typeof buildTodos);
                        }

                        if (orch.status === 'executing_task') {
                            currentStep = 'executing';
                            const progressMsg = String(orch.progress_msg || "");
                            if (progressMsg) {
                                if (progressMsg.includes('[TASK_PROGRESS]')) {
                                    const cleanMsg = progressMsg.replace('[TASK_PROGRESS]', '').trim();
                                    const markerRegex = /🔄 Task \d+\/\d+:.*/g;
                                    if (currentContent.match(markerRegex)) {
                                        chunkUpdate = currentContent.replace(markerRegex, cleanMsg);
                                    } else {
                                        chunkUpdate = currentContent + "\n\n" + cleanMsg;
                                    }
                                } else {
                                    chunkUpdate = (currentContent && !currentContent.includes(progressMsg)) ? (currentContent + "\n\n" + progressMsg) : currentContent;
                                }
                            }
                        } else if (orch.status === 'all_tasks_completed') {
                            currentStep = 'finalizing';
                            setIsBuildSyncing(false);
                            if (currentTodoList?.length) {
                                setBuildTodos(
                                    currentTodoList.map((t: { status?: string }) => ({
                                        ...t,
                                        status: t.status === 'failed' ? 'failed' : 'completed',
                                    }))
                                );
                            }
                        }
                    }

                    // --- Final Report (Runner finished) ---
                    if (event.final_report) {
                        setIsBuildSyncing(false);
                        const isApproved = event.final_report.plan_approved || false;
                        currentStep = isApproved ? 'completed' : 'planning';
                        const report = String(event.final_report.report || "");
                        chunkUpdate = report;

                        const frInner = (event.final_report.execute_sandbox || {}) as Record<string, unknown>;
                        if (frInner.workspace_ops) {
                            ingestBuildPayload(frInner);
                        }

                        const frSandboxJob = frInner.sandbox_job as Record<string, unknown> | undefined;
                        const tunnelUrl = frSandboxJob?.tunnel_url || frSandboxJob?.stream_url as string | undefined;
                        if (tunnelUrl) {
                            window.dispatchEvent(new CustomEvent('brainPreviewReady', {
                                detail: { url: tunnelUrl, streamUrl: tunnelUrl }
                            }));
                            const frJob = {
                                jobId: String(frSandboxJob?.job_id || ''),
                                syncUrl: frSandboxJob?.sync_url as string | undefined,
                                streamUrl: tunnelUrl as string,
                                framework: (frSandboxJob?.framework as string) || selectedFramework,
                            };
                            setBuildJob(frJob);
                            window.dispatchEvent(new CustomEvent('openBrainEditor', { detail: frJob }));
                            window.dispatchEvent(new CustomEvent('openSandboxCanvas', { detail: frJob }));
                        }

                        completeRunnerBuild();
                        if (currentTodoList?.length) {
                            currentTodoList = markAllTodosComplete(currentTodoList as BuildTodoItem[]);
                        }

                        appendBuildActivities([
                            {
                                id: `act-done-${Date.now()}`,
                                type: 'milestone',
                                label: 'Build complete',
                                timestamp: Date.now(),
                                status: 'done',
                            },
                        ]);

                        const planData = event.final_report.plan || event.final_report.project_plan;
                        const hasRealPlan = planData && (Array.isArray(planData) ? planData.length > 0 : (typeof planData === 'object' && Object.keys(planData).length > 0));

                        if (hasRealPlan) {
                            currentPlanContentRef.current = typeof planData === 'string' ? planData : JSON.stringify(planData);

                            // Extract real tasks from the plan JSON to replace hardcoded ones
                            if (typeof planData === 'object' && Array.isArray(planData.tasks)) {
                                currentTodoList = planData.tasks.map((task: any, index: number) => ({
                                    id: `plan-task-${index}`,
                                    label: typeof task === 'string' ? task : (task.task || task.title || task.description || 'Task ' + (index + 1)),
                                    status: 'pending'
                                }));
                            }
                        } else if (!currentPlanContentRef.current) {
                            currentPlanContentRef.current = report;
                        }

                        // Update project memory with build results
                        if (projectIdRef.current && isApproval && userText) {
                            appendRequirement(projectIdRef.current, userText).catch((err) =>
                                console.warn('Failed to persist requirement to project memory:', err)
                            );
                            updateProjectStack(projectIdRef.current, {
                                frontend: selectedFramework,
                            }).catch((err) =>
                                console.warn('Failed to update project stack:', err)
                            );
                        }
                    }

                    // Handle generic error from backend
                    if (event.error) {
                        const errorMsg = typeof event.error === 'string' ? event.error : JSON.stringify(event.error);
                        chunkUpdate = (currentContent ? (currentContent + "\n\n") : "") + "⚠️ " + errorMsg;
                        // Clear the execution store thinking state so UI doesn't stay in loading
                        execStore.setPhase('ERROR');
                        execStore.setStreamingMessage(`Error: ${errorMsg}`);
                        if (isBuildMode && !buildFinishedAt) {
                            completeRunnerBuild();
                        }
                    }

                    // --- Robust Fallback ---
                    // If chunkUpdate is still empty, try to extract any textual data from the event
                    if (!chunkUpdate && !currentContent) {
                        const nodeKeys = Object.keys(event);
                        if (nodeKeys.length > 0) {
                            const nodeData = event[nodeKeys[0]];
                            if (nodeData && typeof nodeData === 'object') {
                                const possibleText = nodeData.report ||
                                    nodeData.analysis ||
                                    nodeData.progress_msg ||
                                    (typeof nodeData.leader_analysis === 'object' ? nodeData.leader_analysis.analysis : nodeData.leader_analysis);
                                if (possibleText) chunkUpdate = String(possibleText);
                            }
                        }
                    }

                    // Update tracking content
                    if (chunkUpdate) {
                        // Prevent exact duplicate of thoughts appearing in the main message
                        if (chunkUpdate.trim() !== accumulatedThoughts.trim() && !accumulatedThoughts.includes(chunkUpdate.trim())) {
                            currentContent = chunkUpdate;
                        }
                    }

                    // Atomic State Update
                    setMessages(prev => {
                        const next = [...prev];
                        const idx = next.findIndex(m => m.id === aiMsgId);
                        if (idx !== -1) {
                            next[idx] = {
                                ...next[idx],
                                content: currentContent || next[idx].content,
                                planContent: currentPlanContentRef.current || next[idx].planContent,
                                planVersions: next[idx].planVersions,
                                sandboxJob: currentSandboxJob || next[idx].sandboxJob,
                                todoList: currentTodoList || next[idx].todoList,
                                clarificationData: currentClarificationData || next[idx].clarificationData,
                                planApproved: currentPlanApproved || next[idx].planApproved,
                                role: currentClarificationData ? 'clarification' : next[idx].role,
                                thoughts: useExecutionStore.getState().streamingMessage || undefined,
                                timeline: useExecutionStore.getState().timeline || []
                            };
                        }
                        return next;
                    });

                    setAgentStep(currentStep);

                    // --- Auto-open Canvas Logic (Refined) ---
                    if (currentSandboxJob) {
                        const jobData = {
                            streamUrl: currentSandboxJob.streamUrl || currentSandboxJob.stream_url,
                            jobId: currentSandboxJob.jobId || currentSandboxJob.job_id,
                            todoList: currentTodoList || undefined
                        };

                        // Force state update if not yet showing
                        if (!activeSandboxJob) {
                            setActiveSandboxJob(jobData);
                        }

                        // Auto-open sandbox if it's not already open or if the jobId is different
                        if (!latestJobRef.current || latestJobRef.current.jobId !== jobData.jobId) {
                            setTimeout(() => {
                                window.dispatchEvent(new CustomEvent('openSandboxCanvas', { detail: jobData }));
                            }, 0);
                        }
                        latestJobRef.current = jobData;
                    }

                } catch (err) {
                    console.error("Error processing brain stream event:", err);
                }
            }, abortControllerRef.current?.signal);

            // CRITICAL FIX: After stream completes, check if we actually received any content
            // If not, the backend silently failed — show a meaningful error to the user
            // Skip if user stopped (abort) — the "Build was interrupted" message is already shown
            if (!stoppedByUserRef.current) {
                setMessages(prev => {
                    const aiMsg = prev.find(m => m.id === aiMsgId);
                    if (aiMsg && !aiMsg.content && !aiMsg.planContent && !aiMsg.clarificationData && !aiMsg.todoList?.length) {
                        return prev.map(m => m.id === aiMsgId
                            ? { ...m, content: '⚠️ Brain could not process this request. The AI service may be temporarily unavailable. Please try again.' }
                            : m
                        );
                    }
                    return prev;
                });
            }

            setAgentStep('idle');
            setIsLoading(false);
            if (isBuildMode && !buildFinishedAt && !stoppedByUserRef.current) {
                completeRunnerBuild();
            }
            stoppedByUserRef.current = false;
            stoppedAtRef.current = null;
            refreshBalance();

            if (autoClarifyEnabled && pendingAutoClarifyRef.current) {
                const autoAnswer = pendingAutoClarifyRef.current;
                pendingAutoClarifyRef.current = null;
                setTimeout(() => {
                    handleSendMessage(autoAnswer, 0.3);
                }, 0);
            }

        } catch (err: any) {
            if (err.name !== 'AbortError') {
                console.error('Brain chat error:', err);
                const errorDetail = err?.message || 'Unknown error';
                const isNetworkError = errorDetail.includes('network') || errorDetail.includes('unreachable') || errorDetail.includes('fetch') || errorDetail.includes('Failed to fetch');
                const userMessage = isNetworkError
                    ? '⚠️ Could not connect to Brain service. Please check if the backend is running and try again.'
                    : `⚠️ ${errorDetail.includes('Brain') ? errorDetail : 'Connection interrupted: ' + errorDetail}. Please try again.`;
                setMessages(prev => [...prev, {
                    id: `error_${Date.now()}`,
                    role: 'agent',
                    content: userMessage,
                    timestamp: new Date().toLocaleTimeString()
                }]);
            }
            setAgentStep('idle');
            setIsLoading(false);
            if (isBuildMode && !buildFinishedAt) {
                completeRunnerBuild();
            }
        } finally {
            sendingRef.current = false;
        }
    };

    const handleStopChat = useCallback(async () => {
        stoppedByUserRef.current = true;
        stoppedAtRef.current = Date.now();
        useExecutionStore.getState().setStopped();
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
        }
        setIsLoading(false);
        setAgentStep('idle');
        useExecutionStore.getState().setStreamingMessage(null);
        sendingRef.current = false;
        // Keep isBuildMode=true so Continue button remains visible

        // Store interrupted message in ref so fetchHistory can re-apply it
        const interruptedMsg = {
            id: `interrupted-${Date.now()}`,
            role: 'agent' as const,
            content: 'Build was interrupted. Press Continue to resume from where it stopped.',
            timestamp: new Date().toLocaleTimeString(),
        };
        interruptedMsgRef.current = interruptedMsg;
        setMessages(prev => {
            // Don't add duplicate interrupted messages
            if (prev.some(m => m.content?.includes('nterrupted') && m.role === 'agent')) return prev;
            // Remove empty AI placeholder messages (brain_xxx with no content)
            const cleaned = prev.filter(m =>
                !(m.role === 'agent' && m.id.startsWith('brain_') && !m.content && !m.planContent && !m.clarificationData)
            );
            return [...cleaned, interruptedMsg];
        });

        const convId = activeConvIdRef.current || currentConversationId;
        if (convId && convId !== 'new') {
            try {
                await brainApi.stopChat(convId);
            } catch (err) {
                console.error('[Brain] Failed to stop execution on backend:', err);
            }
        }
    }, [currentConversationId]);

    const handleRegenerate = async (msgId: string) => {
        if (isLoading) return;

        const msgIndex = messages.findIndex(m => m.id === msgId);
        if (msgIndex === -1) return;

        // Find the user message associated with this assistant response
        let lastUserText = '';
        for (let i = msgIndex - 1; i >= 0; i--) {
            if (messages[i].role === 'user') {
                lastUserText = messages[i].content;
                break;
            }
        }

        if (!lastUserText) return;

        // Remove the assistant message that we're regenerating
        setMessages(prev => prev.filter(m => m.id !== msgId));

        // Trigger a fresh generation with higher temperature for variety
        handleSendMessage(lastUserText, 0.7);
    };

    // Handler for when user selects a clarification option
    const handleClarificationAnswer = (answer: string) => {
        // Find the last agent/clarification message and stamp it with "Clarified requirements"
        setMessages(prev => {
            const updated = [...prev];
            // Walk backwards to find the last clarification/agent message
            for (let i = updated.length - 1; i >= 0; i--) {
                if (updated[i].role === 'clarification' || updated[i].role === 'agent') {
                    updated[i] = {
                        ...updated[i],
                        role: 'agent',
                        // Clear clarification card, keep content as preamble
                        clarificationData: undefined,
                        // Add "Clarified requirements" as a completed timeline event
                        timeline: [
                            ...(updated[i].timeline || []),
                            { id: 'clarified', text: 'Clarified requirements', type: 'SUCCESS' }
                        ]
                    };
                    break;
                }
            }
            return updated;
        });
        // Send the answers to the backend
        handleSendMessage(answer);
    };

    const handleClarificationSkip = () => {
        setMessages(prev => prev.filter(m => m.role !== 'clarification'));
        // Focus the text input so the user can type freely
        textareaRef?.current?.focus();
    };

    return (
        <div className="flex flex-col h-full bg-app relative overflow-hidden font-sans text-text-primary">
            {/* High-Fidelity Header */}
            <header className="h-[52px] shrink-0 border-b border-border-subtle flex items-center justify-between px-4 sm:px-6 bg-sidebar z-30">
                <div className="flex items-center gap-4 min-w-0">
                    <button
                        onClick={onToggleSidebarAction || (() => window.dispatchEvent(new CustomEvent('toggleBrainSidebar')))}
                        className="lg:hidden w-9 h-9 flex items-center justify-center rounded-xl text-text-muted hover:text-text-primary hover:bg-surface-2 transition-all shrink-0"
                    >
                        <Menu size={18} />
                    </button>
                    <div className="flex flex-col min-w-0">
                        <div className="flex items-center gap-2">
                            <span className="text-[13px] font-bold text-text-primary tracking-tight truncate max-w-[180px] sm:max-w-[250px] font-display">
                                {activeConversation?.title || 'New Chat'}
                            </span>
                            {projectComplete && (
                                <button
                                    type="button"
                                    onClick={handleNewChat}
                                    className="ml-1 flex items-center gap-1.5 px-3 h-8 rounded-full bg-accent text-white border border-accent text-[12px] font-bold tracking-tight hover:brightness-110 transition-all shadow-md shrink-0 animate-in fade-in zoom-in-95 duration-300"
                                    title="Start a new chat"
                                >
                                    <Plus size={14} strokeWidth={2.5} />
                                    New Chat
                                </button>
                            )}
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-surface-2 border border-border-subtle shadow-sm">
                        <Coins size={12} className="text-accent" />
                        <span className="text-[12px] font-black text-text-primary tabular-nums tracking-tighter">
                            {userCredits?.toLocaleString() || '0'}
                        </span>
                    </div>

                    <div className="items-center gap-2 ml-1 hidden sm:flex">
                        <div className="flex flex-col items-end leading-none mr-1">
                            <span className="text-[11px] font-bold text-text-secondary lowercase truncate max-w-[100px]">
                                {user?.name || user?.email?.split('@')[0]}
                            </span>
                            <span className="text-[8px] font-black text-accent tracking-widest uppercase">PRO</span>
                        </div>
                        <div className="w-8 h-8 rounded-xl bg-accent flex items-center justify-center border border-accent/30 shadow-md shrink-0 text-white">
                            <User size={15} />
                        </div>
                    </div>
                </div>
            </header>

            {/* Content Area - 3-Panel Split (Chat | Build Plan | Live Workspace) */}
            <div className="flex flex-1 min-h-0 w-full overflow-hidden">
                {/* Left Side: Chat History & Input */}
                <div className={`${isBuildMode ? 'w-full lg:w-[34%] max-w-[460px] border-r border-border-subtle shrink-0 bg-app' : 'flex-1'} flex flex-col relative z-1 overflow-hidden`}>

                    {/* Chat Messages */}
                    <div
                        ref={scrollContainerRef}
                        className={`flex-1 flex flex-col overflow-y-auto custom-scrollbar ${(messages.length === 0 && pathname === '/brain' && !isLoading) ? 'items-center justify-center' : 'px-4 py-8 space-y-8'}`}
                    >
                        {(messages.length === 0 && pathname === '/brain' && !isLoading) ? (
                            <div className="w-full max-w-4xl flex flex-col items-center px-4 sm:px-6 py-10 sm:py-16 animate-in fade-in duration-700 relative z-10">

                                <AmbientBackground />

                                {/* Date Label */}
                                <p className="mb-2 text-sm font-medium text-text-muted tracking-tight">
                                    {new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date())}
                                </p>

                                {/* Main Greeting & User Name */}
                                <h1 className="w-full max-w-full text-[clamp(1.75rem,3.4vw,2.75rem)] font-semibold leading-[1.08] tracking-[-0.03em] text-text-primary font-display text-center break-words mb-3">
                                    {new Date().getHours() < 12 ? 'Good morning' : new Date().getHours() < 18 ? 'Good afternoon' : 'Good evening'},<br />
                                    {(user?.email || user?.name || 'singhkashish364@gmail.com').replace(/@gmil\.com/i, '@gmail.com')}.
                                </h1>



                                {/* Subtitle */}
                                <p className="text-base sm:text-lg text-text-secondary text-center mb-8 font-sans">
                                    What should we <span className="font-semibold text-accent">focus on</span> today?
                                </p>

                                {/* Glassmorphic Pill Input Container */}
                                <div className="w-full max-w-[760px] relative mb-6 sm:mb-8 px-1 flex flex-col gap-2">
                                    {brainAttachments.length > 0 && (
                                        <div className="flex flex-wrap gap-2 px-2 py-1">
                                            {brainAttachments.map(att => (
                                                <div key={att.id} className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-surface-3 border border-border-default text-xs text-text-primary">
                                                    <span className="truncate max-w-[140px]">{att.name}</span>
                                                    {att.status === 'uploading' ? (
                                                        <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
                                                    ) : (
                                                        <button 
                                                            type="button" 
                                                            onClick={() => setBrainAttachments(prev => prev.filter(x => x.id !== att.id))} 
                                                            className="text-text-muted hover:text-red-400 font-bold ml-1"
                                                        >
                                                            ×
                                                        </button>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                    <div className="group relative rounded-2xl sm:rounded-2xl border border-border-default bg-surface-2/90 backdrop-blur-xl px-3.5 sm:px-5 py-2.5 sm:py-3 shadow-glass transition-all duration-300 focus-within:border-accent/60 focus-within:ring-2 focus-within:ring-accent/20 hover:border-border-strong flex flex-wrap items-center gap-2 sm:gap-3">
                                        <div className="flex items-center gap-2 flex-1 min-w-[140px]">
                                            <button 
                                                type="button" 
                                                onClick={() => fileInputRef.current?.click()}
                                                className="w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-surface-3 transition-all shrink-0"
                                                title="Add Attachment (Image / PDF)"
                                            >
                                                <Plus size={16} className="sm:w-[18px] sm:h-[18px]" />
                                            </button>

                                            <input
                                                ref={fileInputRef}
                                                type="file"
                                                multiple
                                                onChange={handleBrainFileSelect}
                                                className="hidden"
                                            />

                                            <textarea
                                                value={input}
                                                onChange={(e) => {
                                                    setInput(e.target.value);
                                                    e.target.style.height = 'auto';
                                                    e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
                                                }}
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter' && !e.shiftKey) {
                                                        e.preventDefault();
                                                        handleSendMessage();
                                                    }
                                                }}
                                                rows={1}
                                                placeholder="Ask Grizon"
                                                className="w-full bg-transparent border-none focus:ring-0 focus:outline-none text-sm sm:text-base text-text-primary placeholder:text-text-muted p-0 font-sans resize-none overflow-y-auto"
                                                style={{ maxHeight: '120px' }}
                                            />
                                        </div>

                                        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 ml-auto">
                                            <BrainFrameworkSelector
                                                value={selectedFramework}
                                                onChange={handleFrameworkChange}
                                                disabled={isLoading}
                                                compact
                                            />

                                            <button
                                                onClick={() => handleSendMessage()}
                                                disabled={!input.trim() || isLoading}
                                                className={`w-8 h-8 sm:w-9 sm:h-9 rounded-full flex items-center justify-center transition-all shadow-md shrink-0 ${input.trim() && !isLoading
                                                    ? 'bg-accent text-white hover:brightness-110 shadow-lg shadow-accent/30 scale-105'
                                                    : 'bg-surface-3 text-text-muted border border-border-subtle'
                                                    }`}
                                            >
                                                <ArrowRight size={15} className="sm:w-4 sm:h-4" />
                                            </button>
                                        </div>
                                    </div>
                                </div>

                                {/* Quick Action Pills */}
                                <div className="flex flex-wrap justify-center gap-1.5 sm:gap-2.5 mb-6 sm:mb-8 w-full max-w-2xl px-1">
                                    {[
                                        { icon: Database, label: "Use cases", prompt: "Show me common use cases and project templates" },
                                        { icon: Users, label: "Lead generation", prompt: "Build a lead generation engine with web scraping" },
                                        { icon: Sparkles, label: "Recruiting", prompt: "Create an AI candidate screening app" },
                                        { icon: TrendingUp, label: "Monitoring", prompt: "Set up a real-time system monitoring dashboard" }
                                    ].map((item, i) => (
                                        <button
                                            key={i}
                                            onClick={() => setInput(item.prompt)}
                                            className="flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-1.5 sm:py-2 rounded-full bg-surface-2 border border-border-subtle hover:bg-surface-3 hover:border-accent/40 transition-all text-[11px] sm:text-xs font-medium text-text-secondary hover:text-text-primary shadow-sm hover:-translate-y-0.5 font-sans shrink-0"
                                        >
                                            <item.icon size={12} className="text-accent sm:w-[13px] sm:h-[13px]" />
                                            <span>{item.label}</span>
                                        </button>
                                    ))}
                                </div>

                                {/* Visual Showcase Skill Cards */}
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 w-full px-1">
                                    {[
                                        {
                                            title: "Lead Generation Engine",
                                            desc: "Automated scraping & scoring",
                                            color: "from-purple-500/20 via-indigo-500/10 to-transparent",
                                            prompt: "Build an automated lead generation engine with score tracking",
                                            icon: Users
                                        },
                                        {
                                            title: "Stock & Market Analysis",
                                            desc: "Real-time chart telemetry",
                                            color: "from-emerald-500/20 via-teal-500/10 to-transparent",
                                            prompt: "Build a financial stock analysis app with charts",
                                            icon: TrendingUp
                                        },
                                        {
                                            title: "Market Trend Analyzer",
                                            desc: "Competitor intelligence data",
                                            color: "from-amber-500/20 via-purple-500/10 to-transparent",
                                            prompt: "Build a market trends analytics dashboard",
                                            icon: Activity
                                        }
                                    ].map((card, i) => (
                                        <div
                                            key={i}
                                            onClick={() => setInput(card.prompt)}
                                            className="group cursor-pointer p-3.5 sm:p-4 rounded-2xl border border-border-subtle bg-surface-1/90 backdrop-blur-md hover:border-accent/40 hover:shadow-xl transition-all duration-300 flex flex-col justify-between hover:-translate-y-1"
                                        >
                                            <div>
                                                <div className={`h-20 sm:h-24 w-full rounded-xl bg-gradient-to-br ${card.color} border border-border-subtle relative overflow-hidden flex items-center justify-center mb-3 group-hover:border-accent/30 transition-colors`}>
                                                    <card.icon size={28} className="text-accent group-hover:scale-110 transition-transform duration-300 sm:w-8 sm:h-8" />
                                                </div>
                                                <h3 className="text-xs font-bold text-text-primary group-hover:text-accent transition-colors truncate mb-1 font-display">
                                                    {card.title}
                                                </h3>
                                                <p className="text-[11px] text-text-muted line-clamp-1 font-sans">
                                                    {card.desc}
                                                </p>
                                            </div>
                                            <div className="mt-3 pt-2 border-t border-border-subtle flex items-center justify-between text-[10px] font-bold text-accent opacity-0 group-hover:opacity-100 transition-opacity">
                                                <span>Launch Skill</span>
                                                <ArrowRight size={12} />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                        ) : (
                            <div className="max-w-4xl mx-auto w-full relative">

                                {messages.length === 0 && !isLoading ? (
                                    <div className="flex flex-col items-center justify-center h-full min-h-[40vh] text-center px-6 animate-in fade-in duration-500">
                                        <div className="flex items-center gap-2 mb-4">
                                            <div className="w-6 h-6 bg-white rounded-md flex items-center justify-center shrink-0">
                                                <div className="w-3 h-2 border-[1.5px] border-black rounded-sm" />
                                            </div>
                                            <span className="text-lg font-medium text-white/40">Grizon <span className="text-white/20">brain</span></span>

                                        </div>
                                        <p className="text-sm text-white/30 max-w-md">
                                            This conversation has no messages yet. Type something below to get started.
                                        </p>
                                    </div>
                                ) : (
                                    <>
                                        {(() => {
                                            // Dynamically calculate the last plan and accumulate all plan versions
                                            const planVersionsAcrossHistory = messages
                                                .filter(m => m.planContent)
                                                .map(m => m.planContent!);

                                            const lastPlanMessageId = [...messages].reverse().find(m => m.planContent)?.id;

                                            // Filter out purely task-status messages from being rendered as main chat bubbles
                                            const displayMessages = messages.filter((m, idx) => {
                                                if (m.role === 'user') return true;
                                                if (m.planContent) return true; // Never hide plans

                                                // Keep the actively streaming message
                                                const isActivelyStreaming = (isLoading || isBuildMode) && idx === messages.length - 1;
                                                if (isActivelyStreaming) return true;

                                                // Keep messages with substantial thoughts
                                                if (m.thoughts && m.thoughts.length > 20) return true;

                                                const c = m.content || '';
                                                
                                                // Hide empty agent messages (no content, no plan, no thoughts)
                                                if (m.role === 'agent' && !c && !m.planContent && (!m.thoughts || m.thoughts.length <= 20)) return false;

                                                // Hide known backend status update messages
                                                if (m.metadata?.agentStep === 'task_execution' || m.metadata?.is_task_update) return false;
                                                
                                                // If it's a short message containing known status phrases, it's a backend injection
                                                if (c.length < 300 && (
                                                    c.includes('✅ Task ') || 
                                                    c.includes('→ Moving to task') || 
                                                    c.includes('Sandbox workspace ready') || 
                                                    c.includes("I've broken down the project") ||
                                                    c.includes("Starting the build process now")
                                                )) {
                                                    return false;
                                                }

                                                return true;
                                            });

                                            return displayMessages.map((msg, index) => {
                                                if (msg.role === 'user') {
                                                    return <BrainUserMessage key={msg.id} content={msg.content} dateTime={msg.timestamp} />;
                                                }

                                                const isLatestPlan = msg.id === lastPlanMessageId;
                                                const isSuperseded = Boolean(msg.planContent && !isLatestPlan);
                                                const isLastDisplayMessage = index === displayMessages.length - 1;
                                                const shouldShowBuildUI = isBuildMode && isLastDisplayMessage;
                                                const shouldShowLiveThoughts = isLoading && isLastDisplayMessage;

                                                // For the latest plan, give it all previous versions (excluding its own)
                                                const dynamicPlanVersions = isLatestPlan
                                                    ? Array.from(new Set(planVersionsAcrossHistory.filter(p => p !== msg.planContent)))
                                                    : [];

                                                return (
                                                    <React.Fragment key={msg.id}>
                                                        <BrainAgentMessage
                                                            content={msg.content}
                                                            planVersions={
                                                                msg.planVersions?.length
                                                                    ? Array.from(new Set(msg.planVersions.filter(p => p !== msg.planContent)))
                                                                    : dynamicPlanVersions
                                                            }
                                                            dateTime={msg.timestamp}
                                                            planContent={msg.planContent}
                                                            sandboxJob={msg.sandboxJob}
                                                            todoList={(shouldShowBuildUI && buildTodos.length) ? (buildTodos as any) : (msg.metadata?.agentStep === 'create_tasks' ? msg.todoList : undefined)}
                                                            clarificationData={msg.clarificationData}
                                                            thoughts={shouldShowLiveThoughts ? (liveThoughts || msg.thoughts) : msg.thoughts}
                                                            timeline={shouldShowLiveThoughts ? (liveTimeline?.length ? liveTimeline : msg.timeline) : msg.timeline}
                                                            planApproved={msg.planApproved}
                                                            planSuperseded={isSuperseded}
                                                            agentStep={shouldShowLiveThoughts ? agentStep : undefined}
                                                            buildActivities={shouldShowBuildUI ? buildActivities : undefined}
                                                            buildTodos={(shouldShowBuildUI && buildTodos.length) ? buildTodos : undefined}
                                                            isBuildSyncing={shouldShowBuildUI ? isBuildSyncing : undefined}
                                                            durationSeconds={msg.durationSeconds}
                                                            onClarifySelect={handleClarificationAnswer}
                                                            onClarifySkip={handleClarificationSkip}
                                                            onRegenerate={() => handleRegenerate(msg.id)}
                                                            onBuild={() => handleSendMessage(
                                                                "✅ Plan Approved. Please proceed with the build.",
                                                                0.3,
                                                                true,
                                                                msg.planContent,
                                                                msg.id // Pass the current message ID to build in-place
                                                            )}
                                                            onReject={(feedback?: string) => {
                                                                if (feedback) {
                                                                    // Perform in-place update for feedback
                                                                    handleSendMessage(
                                                                        `I would like to request changes to this plan: ${feedback}. Please review and update the strategy.`,
                                                                        0.3,
                                                                        false,
                                                                        undefined,
                                                                        msg.id // Pass the current message ID to update it in-place
                                                                    );
                                                                } else {
                                                                    handleSendMessage("I reject this plan. Let's rethink the strategy.", 0.3);
                                                                }
                                                            }}

                                                        />
                                                    </React.Fragment>
                                                );
                                            });
                                        })()}

                                        {/* Fallback loading for when agentStep is idle but still loading */}
                                        {isLoading && agentStep === 'idle' && messages.length > 0 && messages[messages.length - 1].role === 'user' && (
                                            <div className="flex items-center gap-3 py-4 pl-4 animate-in fade-in duration-500">
                                                <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center text-white/20 relative">
                                                    <div className="absolute inset-0 rounded-lg border border-white/10 animate-pulse" />
                                                    <Activity size={14} className="animate-spin opacity-40" />
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <span className="text-[13px] text-white/30 font-medium tracking-wide">Initializing engine...</span>
                                                    <div className="flex gap-1">
                                                        <div className="w-1 h-1 rounded-full bg-white/20 animate-bounce [animation-delay:-0.3s]" />
                                                        <div className="w-1 h-1 rounded-full bg-white/20 animate-bounce [animation-delay:-0.15s]" />
                                                        <div className="w-1 h-1 rounded-full bg-white/20 animate-bounce" />
                                                    </div>
                                                </div>
                                            </div>
                                        )}

                                        <div ref={messagesEndRef} className="h-40 shrink-0" />
                                    </>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Sticky Bottom Input */}
                    {(messages.length > 0 || pathname.startsWith('/brain/')) && (
                        <div className={`bg-app border-t border-border-subtle relative z-10 shrink-0 ${isBuildMode ? 'px-3 py-3' : 'p-4 sm:p-6'}`}>
                            <div className={`${isBuildMode ? 'w-full' : 'max-w-3xl mx-auto'} relative group`}>
                                <div className="relative flex flex-col gap-2 bg-surface-2/90 border border-border-default rounded-2xl p-2 pr-3 focus-within:border-accent/40 focus-within:ring-2 focus-within:ring-accent/15 transition-all duration-300 shadow-xl">
                                    {brainAttachments.length > 0 && (
                                        <div className="flex flex-wrap gap-2 px-2 pt-1 border-b border-border-subtle pb-2">
                                            {brainAttachments.map(att => (
                                                <div key={att.id} className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-surface-3 border border-border-default text-xs text-text-primary">
                                                    <span className="truncate max-w-[140px]">{att.name}</span>
                                                    {att.status === 'uploading' ? (
                                                        <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
                                                    ) : (
                                                        <button 
                                                            type="button" 
                                                            onClick={() => setBrainAttachments(prev => prev.filter(x => x.id !== att.id))} 
                                                            className="text-text-muted hover:text-red-400 font-bold ml-1"
                                                        >
                                                            ×
                                                        </button>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                    <div className="relative flex items-end gap-3 pt-1">
                                        <button 
                                            type="button" 
                                            onClick={() => fileInputRef.current?.click()}
                                            className="w-9 h-9 rounded-full flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-surface-3 transition-all shrink-0 mb-1"
                                            title="Add Attachment (Image / PDF)"
                                        >
                                            <Plus size={18} />
                                        </button>
                                        {tokenEstimate !== null && !isBuildMode && (
                                            <div className="absolute -top-10 right-0 px-3 py-1.5 rounded-lg bg-surface-2 border border-border-subtle shadow-xl animate-in fade-in slide-in-from-bottom-2 duration-300">
                                                <div className="flex items-center gap-2">
                                                    <Zap size={12} className="text-accent" />
                                                    <span className="text-[11px] font-bold text-text-primary">
                                                        Est. {tokenEstimate.toLocaleString()} tokens
                                                    </span>
                                                </div>
                                            </div>
                                        )}
                                        <textarea
                                            ref={textareaRef}
                                            value={input}
                                            onChange={(e) => setInput(e.target.value)}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter' && !e.shiftKey) {
                                                    e.preventDefault();
                                                    handleSendMessage();
                                                }
                                            }}
                                            placeholder={isBuildMode ? "Ask a follow-up..." : "Follow up..."}
                                            className="flex-1 bg-transparent border-none focus:ring-0 text-text-primary placeholder:text-text-muted py-3 px-4 resize-none min-h-[52px] max-h-48 custom-scrollbar text-[15px]"
                                            rows={1}
                                        />

                                        {isLoading ? (
                                            <button
                                                type="button"
                                                onClick={() => void handleStopChat()}
                                                className="w-10 h-10 rounded-full transition-all flex items-center justify-center bg-red-600 text-white hover:bg-red-700 shadow-[0_0_15px_rgba(220,38,38,0.3)] animate-pulse shrink-0"
                                                title="Stop execution"
                                            >
                                                <Square size={14} fill="currentColor" />
                                            </button>
                                        ) : (
                                            <div className="flex items-center gap-2 shrink-0">
                                                {((isBuildMode && buildTodos.length > 0 && !isBuildTodosComplete(buildTodos)) || isStopped) && !input.trim() && (
                                                    <button
                                                        type="button"
                                                        onClick={() => void handleResumeBuild()}
                                                        className="px-4 h-10 rounded-full bg-[#976df8] text-white hover:bg-[#8254e5] transition-all flex items-center gap-2 text-xs font-black uppercase tracking-wider shadow-[0_0_15px_rgba(151,109,248,0.2)]"
                                                        title="Continue project generation"
                                                    >
                                                        <Activity size={14} className="animate-pulse" />
                                                        <span>Continue</span>
                                                    </button>
                                                )}
                                                <button
                                                    id="brain-send-btn"
                                                    type="button"
                                                    onClick={() => handleSendMessage()}
                                                    disabled={!input.trim()}
                                                    className={`w-10 h-10 rounded-full transition-all flex items-center justify-center ${input.trim()
                                                        ? 'bg-white text-black hover:bg-white/80'
                                                        : 'bg-white/5 text-white/20'
                                                        }`}
                                                >
                                                    <ArrowRight size={20} />
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Middle Side: Build Plan / Task List (real-time Pending → Running → Completed) */}
                {isBuildMode && !projectComplete && (
                    <BrainBuildPlan
                        todos={buildTodos}
                        isSyncing={isBuildSyncing}
                        workedSeconds={buildStartedAt
                            ? (frozenWorkedSeconds.current !== null
                                ? frozenWorkedSeconds.current
                                : Math.floor(((buildFinishedAt || Date.now()) - buildStartedAt) / 1000))
                            : undefined}
                    />
                )}

                {/* Right Side: Brain Editor Canvas (Live Workspace — Preview / Code / Terminal) */}
                {isBuildMode && (
                    <main className="flex-1 min-w-0 hidden lg:flex flex-col bg-[#0d0d0d] relative">
                        {buildJob ? (
                            <BrainEditorCanvas
                                embedded
                                isOpen
                                buildJob={buildJob}
                                buildComplete={!!buildFinishedAt || (buildTodos.length > 0 && isBuildTodosComplete(buildTodos))}
                                forceBuilding={isBuildSyncing}
                                todoList={buildTodos.length ? buildTodos : ([...messages].reverse().find(m => m.todoList?.length)?.todoList || [])}
                                activities={buildActivities}
                                isSyncing={isBuildSyncing}
                            />
                        ) : (
                            <BrainWorkspaceBoot />
                        )}
                    </main>
                )}
            </div>


            {!isBuildMode && (
                <BrainEditorCanvas
                    isOpen={isEditorOpen}
                    onClose={() => setIsEditorOpen(false)}
                />
            )}
        </div>
    );
}
