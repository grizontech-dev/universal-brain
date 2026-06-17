'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Brain, Send, Loader2, Sparkles, Zap, Terminal, Activity, Menu, Plus, Search, User, ArrowRight, Database, Coins, X, Code, Square } from 'lucide-react';
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
import BrainDecisionView from './BrainDecisionView';
import BrainExecutionView from './BrainExecutionView';
import BrainArtifactView from './BrainArtifactView';
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
import {
    applyResumeToWebContainer,
    fetchResumePayload,
    normalizeTodosForResume,
    shouldStreamResumeBuild,
} from '../lib/resumeBrainBuild';
import { resetBrainWebContainer } from '../lib/brainWebContainer';

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

export default function BrainMessages({ onToggleSidebarAction }: BrainMessagesProps) {
    const router = useRouter();
    const pathname = usePathname();
    const { isAuthenticated, openAuthModal, user, isLoading: isAuthLoading } = useAuth();
    const { currentConversationId, conversations, addConversation, touchConversation, fetchConversations, setConversationId } = useConversations();
    const { selectedModel } = useModels();
    const { balance, refreshBalance } = useCredits();
    const { setThreadListOpen } = useThreadList();
    const [messages, setMessages] = useState<Message[]>([]);

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
    const activeConvIdRef = useRef<string | null>(null);
    const abortControllerRef = useRef<AbortController | null>(null);
    const userScrolledUpRef = useRef(false);

    // Sync ref with URL param
    useEffect(() => {
        if (currentConversationId) {
            activeConvIdRef.current = currentConversationId;
        }
    }, [currentConversationId]);

    // Use sessionStorage to track navigation state across component instances
    const isNavigatingToNewRef = useRef(false);
    const getNavigatingFlag = () => {
        if (typeof window === 'undefined') return false;
        return sessionStorage.getItem('brainNavigatingToNew') === 'true';
    };
    const setNavigatingFlag = (value: boolean) => {
        if (typeof window === 'undefined') return;
        if (value) sessionStorage.setItem('brainNavigatingToNew', 'true');
        else sessionStorage.removeItem('brainNavigatingToNew');
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

    const [sessionState, setSessionState] = useState<SessionState | null>(null);

    // Close the chat history sidebar when build mode starts
    useEffect(() => {
        if (isBuildMode) {
            setThreadListOpen(false);
        }
    }, [isBuildMode, setThreadListOpen]);

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
            setBuildTodos(mergeTodosFromPlan(plan, opts?.activeIndex, opts?.buildPhase));
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
                next.push(item);
                ids.add(item.id);
                recentLabels.push(item.label);
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

    const ingestSandboxStreamEvent = useCallback(
        (event: Record<string, unknown>) => {
            if (event.create_tasks) {
                const tasks = ((event.create_tasks as Record<string, unknown>).plan || []) as BuildTodoItem[];
                if (tasks.length) {
                    applyPlanToTodos(tasks, { activeIndex: 0, buildPhase: 'building' });
                    setIsBuildMode(true);
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
                    window.dispatchEvent(new CustomEvent('openBrainEditor', { detail: job }));
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

    const resumeBrainAfterReload = useCallback(
        async (conversationId: string, framework: string, todos: BuildTodoItem[]) => {
            if (!conversationId || resumeAfterReloadRef.current) return;
            resumeAfterReloadRef.current = true;

            const payload = await fetchResumePayload(conversationId, framework);
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
                        label: `Resuming build from task ${payload.current_task_index + 1}…`,
                        timestamp: Date.now(),
                        status: 'running',
                    },
                ]);
            }

            window.dispatchEvent(
                new CustomEvent('openBrainEditor', {
                    detail: {
                        jobId: conversationId,
                        syncUrl: payload.sync_url,
                        framework: payload.framework,
                        runtime: 'webcontainer',
                        todoList: normalized,
                    },
                })
            );

            try {
                await applyResumeToWebContainer(payload);
            } catch (e) {
                console.warn('[Brain] resume mount failed:', e);
            }

            if (payload.build_complete) {
                completeRunnerBuild();
                return;
            }

            if (!shouldStreamResumeBuild(todos, payload)) {
                setIsBuildSyncing(false);
                return;
            }

            setIsLoading(true);
            setAgentStep('executing');
            try {
                await brainApi.streamChat(
                    {
                        user_id: user?.id || 'anonymous',
                        conversation_id: conversationId,
                        content: '__RESUME_BUILD__',
                        model_id: selectedModel?.id || 'deepseek-chat',
                        plan_approved: true,
                        resume_build: true,
                        framework,
                        temperature: 0.3,
                        question_rounds: questionRounds,
                    },
                    (event) => {
                        if (!event || typeof event !== 'object') return;
                        ingestSandboxStreamEvent(event as Record<string, unknown>);
                    }
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
                setIsLoading(false);
                setIsBuildSyncing(false);
            }
        },
        [
            user?.id,
            selectedModel?.id,
            questionRounds,
            appendBuildActivities,
            completeRunnerBuild,
            ingestSandboxStreamEvent,
            setMessages,
        ]
    );

    useEffect(() => {
        resumeAfterReloadRef.current = false;
    }, [currentConversationId]);

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

    useEffect(() => {
        const onProgress = (e: Event) => {
            const d = (e as CustomEvent).detail || {};
            if (d.todoList?.length) {
                setBuildTodos((prev) => {
                    if (prev.length && isBuildTodosComplete(prev)) {
                        return prev;
                    }
                    return mergeTodosFromPlan(d.todoList as BuildTodoItem[], undefined, 'building');
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
            messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
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
        if (pathname === '/brain' && !navigating) {
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
            resetBrainWebContainer();
            // Close canvas when starting new chat
            window.dispatchEvent(new CustomEvent('closeBrainCanvas'));
            window.dispatchEvent(new CustomEvent('closeBrainEditor'));
            return;
        }

        const fetchHistory = async () => {
            if (!currentConversationId || !pathname.startsWith('/brain/')) return;

            if (isAuthLoading) {
                return;
            }

            if (!isAuthenticated) {
                if (currentConversationId && currentConversationId !== 'new') {
                    openAuthModal('signin-email');
                }
                return;
            }

            // If we are currently loading, don't fetch history to avoid interrupting the active stream/state.
            if (isLoading) {
                return;
            }

            const navFlag = getNavigatingFlag();
            const pendingMessage = sessionStorage.getItem('brainPendingMessage');
            
            // If we're navigating AND there's a pending message, we still need to fetch
            // the user message that was just sent. Only skip fetch if no pending message.
            if (navFlag && !pendingMessage) {
                setNavigatingFlag(false);
                return;
            }

            // Always reset the webcontainer before loading a new conversation
            // to prevent files from leaking across workspaces!
            resetBrainWebContainer();

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
                    if (mappedMessages.length > 0 || !getNavigatingFlag() || hasPendingMessage) {
                        setMessages(filteredMessages);

                        // Auto-hydrate active sandbox if found in recent messages
                        const latestSandboxMsg = [...mappedMessages].reverse().find(m => m.sandboxJob);
                        if (latestSandboxMsg) {
                            const jobData = {
                                jobId: latestSandboxMsg.sandboxJob.job_id || latestSandboxMsg.sandboxJob.jobId,
                                syncUrl: latestSandboxMsg.sandboxJob.sync_url || latestSandboxMsg.sandboxJob.syncUrl,
                                streamUrl: latestSandboxMsg.sandboxJob.stream_url || latestSandboxMsg.sandboxJob.streamUrl,
                                framework: latestSandboxMsg.sandboxJob.framework || selectedFramework,
                                todoList: latestSandboxMsg.todoList,
                                runtime: latestSandboxMsg.sandboxJob.runtime || 'webcontainer',
                            };
                            setActiveSandboxJob(jobData);
                            latestJobRef.current = jobData;

                            const restored = resolveBuildSessionForReload(
                                currentConversationId,
                                latestSandboxMsg.todoList
                            );
                            if (restored) {
                                setBuildTodos(restored.todos);
                                setBuildActivities(dedupeReloadActivities(restored.activities));
                                if (restored.buildStartedAt) {
                                    setBuildStartedAt(restored.buildStartedAt);
                                } else if (isBuildTodosComplete(restored.todos)) {
                                    setBuildStartedAt(Date.now() - 60_000);
                                    setBuildFinishedAt(Date.now());
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
                                const todosForResume =
                                    restored?.todos?.length
                                        ? restored.todos
                                        : (latestSandboxMsg.todoList as BuildTodoItem[]) || [];
                                void resumeBrainAfterReload(
                                    currentConversationId,
                                    jobData.framework || selectedFramework,
                                    todosForResume
                                );
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
                pendingMessageHandledRef.current = true;
                const pendingStr = sessionStorage.getItem('brainPendingMessage');
                if (!pendingStr) return;
                
                // Check if we already have assistant messages (stream already ran)
                const hasAssistantMessages = messages.some(m => m.role === 'agent' || m.role === 'clarification');
                if (hasAssistantMessages) {
                    sessionStorage.removeItem('brainPendingMessage');
                    return;
                }
                
                // Also check if we're still loading - if so, wait
                if (isLoading) return;
                
                const pending = JSON.parse(pendingStr);
                console.log('[Brain] New component picked up pending message:', pending);
                if (pending.projectId) {
                    projectIdRef.current = pending.projectId;
                }
                sessionStorage.removeItem('brainPendingMessage');
                
                // Small delay to ensure component is fully settled
                await new Promise(r => setTimeout(r, 100));
                handleSendMessage(
                    pending.userText,
                    pending.temperature,
                    pending.isPlanApproval,
                    pending.approvedPlan,
                    pending.targetMessageId
                );
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
                runtime: detail.runtime || 'webcontainer',
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
        targetMessageId?: string
    ) => {
        const textValue = typeof overrideText === 'string' ? overrideText : input;
        console.log('BrainMessages: handleSendMessage called', { textValue, isPlanApproval, targetMessageId });

        if (!isAuthenticated) {
            openAuthModal('signin-email');
            return;
        }

        const userText = (textValue || '').trim();
        if (!userText || isLoading) return;

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
        }

        setInput('');
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

                // CRITICAL: Update the ref immediately so follow-up logic knows we have an ID
                if (activeId) {
                    activeConvIdRef.current = activeId;

                    addConversation({
                        id: activeId,
                        userId: user?.id || 'anonymous',
                        title: title,
                        isArchived: false,
                        createdAt: new Date().toISOString(),
                        updatedAt: new Date().toISOString()
                    });

                    setConversationId(activeId);

                    // Create project memory for this conversation
                    await ensureProjectForConversation(activeId, title);

                    // Store the pending message for the new component to pick up
                    sessionStorage.setItem('brainPendingMessage', JSON.stringify({
                        userText,
                        temperature,
                        isPlanApproval,
                        approvedPlan,
                        targetMessageId,
                        modelId: selectedModel?.id || 'deepseek-chat',
                        framework: selectedFramework,
                        questionRounds,
                        userId: user?.id || 'anonymous',
                        projectId: projectIdRef.current,
                    }));
                    // router.replace returns a Promise that resolves when navigation completes
                    await router.replace(`/brain/${activeId}`);
                }
                await fetchConversations();
                // Return early - the new component will handle the stream
                return;
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
                model_id: selectedModel?.id || 'deepseek-chat',
                plan_approved: isApproval,
                approved_plan: isApproval ? approvedPlanContent : undefined,
                question_rounds: questionRounds,
                framework: selectedFramework,
                temperature: temperature,
                project_id: projectIdRef.current || undefined,
            }, (event) => {
                const eventKeys = Object.keys(event || {});
                if (eventKeys.length === 0) return;

                let chunkUpdate = "";

                try {
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
                        }

                        const sandboxJob = (inner.sandbox_job || nodeData.sandbox_job) as Record<string, unknown> | undefined;
                        if (sandboxJob?.job_id) {
                            currentSandboxJob = sandboxJob;
                            const job = {
                                jobId: String(sandboxJob.job_id),
                                syncUrl: sandboxJob.sync_url as string | undefined,
                                streamUrl: sandboxJob.stream_url as string | undefined,
                                framework: (sandboxJob.framework as string) || selectedFramework,
                            };
                            setBuildJob(job);
                            setIsEditorOpen(true);
                            window.dispatchEvent(new CustomEvent('openBrainEditor', { detail: job }));
                        }

                        const progressMsg = inner.progress_msg || nodeData.progress_msg;
                        if (progressMsg) {
                            window.dispatchEvent(new CustomEvent('updateSandboxProgress', {
                                detail: { progressMsg, todoList: currentTodoList },
                            }));
                        }
                    }

                    // --- Tasks ---
                    if (event.create_tasks) {
                        currentStep = 'taskifying';
                        const tasks = event.create_tasks.plan || [];
                        if (tasks.length > 0) {
                            currentTodoList = tasks;
                        }
                        const progress = event.create_tasks.progress_msg || event.create_tasks.report;
                        if (progress) {
                            chunkUpdate = (currentContent ? (currentContent + "\n\n") : "") + String(progress);
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

                    // Handle generic error
                    if (event.error) {
                        chunkUpdate = (currentContent ? (currentContent + "\n\n") : "") + "Error: " + event.error;
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
                            window.dispatchEvent(new CustomEvent('openSandboxCanvas', { detail: jobData }));
                        }
                        latestJobRef.current = jobData;
                    }

                } catch (err) {
                    console.error("Error processing brain stream event:", err);
                }
            }, abortControllerRef.current?.signal);

            setAgentStep('idle');
            setIsLoading(false);
            if (isBuildMode && !buildFinishedAt) {
                completeRunnerBuild();
            }
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
                setMessages(prev => [...prev, {
                    id: `error_${Date.now()}`,
                    role: 'agent',
                    content: 'Connection interrupted. Please try again.',
                    timestamp: new Date().toLocaleTimeString()
                }]);
            }
            setAgentStep('idle');
            setIsLoading(false);
            if (isBuildMode && !buildFinishedAt) {
                completeRunnerBuild();
            }
        }
    };

    const handleStopChat = () => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
        }
        setIsLoading(false);
        setAgentStep('idle');
        useExecutionStore.getState().setStreamingMessage(null);
    };

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
        <div className="flex flex-col h-full bg-[#0a0a0a] relative overflow-hidden font-sans selection:bg-[#976df8]/30 text-white">
            {/* High-Fidelity Header */}
            <header className="h-[52px] shrink-0 border-b border-white/5 flex items-center justify-between px-4 sm:px-6 bg-[#0a0a0a] z-30">
                <div className="flex items-center gap-4 min-w-0">
                    <button
                        onClick={onToggleSidebarAction || (() => window.dispatchEvent(new CustomEvent('toggleBrainSidebar')))}
                        className="lg:hidden w-9 h-9 flex items-center justify-center rounded-xl text-white/40 hover:text-white hover:bg-white/[0.05] transition-all shrink-0"
                    >
                        <Menu size={18} />
                    </button>
                    <div className="flex flex-col min-w-0">
                        <div className="flex items-center gap-2">
                            <span className="text-[13px] font-bold text-white tracking-tight truncate max-w-[180px] sm:max-w-[250px]">
                                {activeConversation?.title || 'New Chat'}
                            </span>
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                    {(activeSandboxJob || messages.some(m => m.sandboxJob)) && (
                        <button
                            onClick={() => {
                                if (activeSandboxJob) {
                                    // If already open, just make sure it stays open
                                    window.dispatchEvent(new CustomEvent('openSandboxCanvas', { detail: activeSandboxJob }));
                                } else {
                                    const latestJob = [...messages].reverse().find(m => m.sandboxJob);
                                    if (latestJob) {
                                        const jobData = {
                                            streamUrl: latestJob.sandboxJob.streamUrl || latestJob.sandboxJob.stream_url,
                                            jobId: latestJob.sandboxJob.jobId || latestJob.sandboxJob.job_id,
                                            todoList: latestJob.todoList
                                        };
                                        setActiveSandboxJob(jobData);
                                        window.dispatchEvent(new CustomEvent('openSandboxCanvas', { detail: jobData }));
                                    }
                                }
                            }}
                            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 transition-all text-[10px] font-black text-white/70 uppercase tracking-widest hidden sm:flex"
                        >
                            <Terminal size={12} />
                            <span>Terminal</span>
                        </button>
                    )}

                    {sessionState?.workflow_state && sessionState.workflow_state !== 'done' && sessionState.workflow_state !== 'error' && (
                        <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white/[0.03] border border-white/5 shadow-inner">
                            <div className={`w-1.5 h-1.5 rounded-full animate-pulse ${workflowPhaseColor(sessionState.workflow_state).replace('text-', 'bg-')}`} />
                            <span className={`text-[11px] font-bold tracking-tight ${workflowPhaseColor(sessionState.workflow_state)}`}>
                                {workflowPhaseLabel(sessionState.workflow_state)}
                            </span>
                            {sessionState.current_agent && (
                                <span className="text-[10px] text-white/30 hidden sm:inline">
                                    · {sessionState.current_agent}
                                </span>
                            )}
                        </div>
                    )}

                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white/[0.03] border border-white/5 shadow-inner">
                        <Coins size={12} className="text-[#976df8]" />
                        <span className="text-[12px] font-black text-white/90 tabular-nums tracking-tighter">
                            {userCredits?.toLocaleString() || '0'}
                        </span>
                    </div>

                    <div className="items-center gap-2 ml-1 hidden sm:flex">
                        <div className="flex flex-col items-end leading-none mr-1">
                            <span className="text-[11px] font-bold text-white/80 lowercase truncate max-w-[100px]">
                                {user?.name || user?.email?.split('@')[0]}
                            </span>
                            <span className="text-[8px] font-black text-white/20 tracking-widest uppercase">PRO</span>
                        </div>
                        <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-[#976df8] to-[#7c3aed] flex items-center justify-center border border-white/10 shadow-xl shrink-0">
                            <User size={15} className="text-white" />
                        </div>
                    </div>
                </div>
            </header>

            {/* Content Area - Split View Support */}
            <div className="flex flex-1 min-h-0 w-full overflow-hidden">
                {/* Left Side: Chat History & Input */}
                <div className={`${isBuildMode ? 'w-full lg:w-[35%] max-w-[500px] border-r border-white/10 shrink-0 bg-[#0a0a0a]' : 'flex-1'} flex flex-col relative z-1 overflow-hidden`}>
                    
                    {/* Chat Messages */}
                    <div
                        ref={scrollContainerRef}
                        className={`flex-1 flex flex-col overflow-y-auto custom-scrollbar ${(messages.length === 0 && pathname === '/brain' && !isLoading) ? 'items-center justify-center' : 'px-4 py-8 space-y-8'}`}
                    >
                    {(messages.length === 0 && pathname === '/brain' && !isLoading) ? (
                        <div className="w-full max-w-3xl flex flex-col items-center px-6 animate-in fade-in duration-700">
                            {/* Logo Style - Responsive Font Size */}
                            <div className="flex items-center gap-2 sm:gap-3 mb-10">
                                <div className="w-8 h-8 sm:w-10 sm:h-10 bg-white rounded-lg sm:rounded-xl flex items-center justify-center shrink-0">
                                    <div className="w-4 h-3 sm:w-6 sm:h-4 border-[1.5px] sm:border-2 border-black rounded-sm relative">
                                        <div className="absolute top-0.5 sm:top-1 left-0.5 sm:left-1 w-0.5 sm:w-1 h-0.5 sm:h-1 bg-black rounded-full" />
                                        <div className="absolute top-0.5 sm:top-1 right-0.5 sm:right-1 w-0.5 sm:w-1 h-0.5 sm:h-1 bg-black rounded-full" />
                                    </div>
                                </div>
                                <h1 className="text-[24px] sm:text-[32px] font-medium tracking-tight">
                                    grizon <span className="text-white/60">brain</span>
                                </h1>
                            </div>

                            {/* Perplexity-style Input Bar - Responsive Padding & Font */}
                            <div className="w-full relative mb-6">
                                <div className="bg-[#1a1a1a] border border-white/10 rounded-2xl p-3 sm:p-4 shadow-2xl transition-all duration-300 focus-within:border-white/20">
                                    <textarea
                                        value={input}
                                        onChange={(e) => setInput(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter' && !e.shiftKey) {
                                                e.preventDefault();
                                                handleSendMessage();
                                            }
                                        }}
                                        placeholder="What should we work on next?"
                                        className="w-full bg-transparent border-none focus:ring-0 focus:outline-none text-[16px] sm:text-[18px] text-white placeholder:text-white/30 p-0 mb-3 sm:mb-4 resize-none min-h-[40px] custom-scrollbar"
                                        rows={1}
                                    />

                                    <div className="flex items-center justify-between gap-2 flex-wrap">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <BrainFrameworkSelector
                                                value={selectedFramework}
                                                onChange={handleFrameworkChange}
                                                disabled={isLoading}
                                                compact
                                            />
                                            <span className="text-[10px] text-white/30 hidden sm:inline">
                                                + Express & Supabase in canvas
                                            </span>
                                        </div>

                                        <div className="flex items-center gap-2 sm:gap-4 overflow-hidden">
                                            <span className="hidden xs:inline text-[11px] sm:text-[13px] text-white/40 font-medium italic truncate">Orchestrator</span>
                                            <button
                                                onClick={() => handleSendMessage()}
                                                disabled={!input.trim() || isLoading}
                                                className={`w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center rounded-full transition-all shrink-0 ${input.trim() && !isLoading
                                                    ? 'bg-white text-black'
                                                    : 'bg-white/10 text-white/20'
                                                    }`}
                                            >
                                                <ArrowRight size={18} />
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Category Buttons */}
                            <div className="flex flex-wrap justify-center gap-2 mb-16">
                                {[
                                    { icon: Database, text: "Use cases" },
                                    { icon: User, text: "Lead generation" },
                                    { icon: Sparkles, text: "Recruiting" },
                                    { icon: Activity, text: "Monitoring" }
                                ].map((item, i) => (
                                    <button
                                        key={i}
                                        className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 border border-white/5 hover:bg-white/10 transition-all text-[13px] font-medium text-white/80"
                                    >
                                        <item.icon size={14} className="text-white/40" />
                                        <span>{item.text}</span>
                                    </button>
                                ))}
                            </div>

                            {/* Visual Task Cards */}
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 w-full">
                                {[
                                    { title: "Lead Generation", color: "from-blue-500/20" },
                                    { title: "Stock Analysis", color: "from-emerald-500/20" },
                                    { title: "Market Trends", color: "from-purple-500/20" }
                                ].map((card, i) => (
                                    <div key={i} className="group cursor-pointer">
                                        <div className={`aspect-video w-full rounded-xl bg-gradient-to-br ${card.color} to-transparent border border-white/5 mb-3 relative overflow-hidden group-hover:border-white/20 transition-all`}>
                                            <div className="absolute inset-0 flex items-center justify-center opacity-20">
                                                <Activity size={40} />
                                            </div>
                                        </div>
                                        <h3 className="text-[13px] font-medium text-white/60 group-hover:text-white transition-colors">{card.title}</h3>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ) : (
                        <div className="max-w-4xl mx-auto w-full relative">
                            {(() => {
                                // Dynamically calculate the last plan and accumulate all plan versions
                                const planVersionsAcrossHistory = messages
                                    .filter(m => m.planContent)
                                    .map(m => m.planContent!);
                                
                                const lastPlanMessageId = [...messages].reverse().find(m => m.planContent)?.id;

                                return messages.map((msg, index) => {
                                    if (msg.role === 'user') {
                                        return <BrainUserMessage key={msg.id} content={msg.content} dateTime={msg.timestamp} />;
                                    }
                                    
                                    const isLatestPlan = msg.id === lastPlanMessageId;
                                    const isSuperseded = Boolean(msg.planContent && !isLatestPlan);
                                    
                                    // For the latest plan, give it all previous versions (excluding its own)
                                    const dynamicPlanVersions = isLatestPlan 
                                        ? Array.from(new Set(planVersionsAcrossHistory.filter(p => p !== msg.planContent)))
                                        : [];

                                    return (
                                        <React.Fragment key={msg.id}>
                                            <BrainAgentMessage
                                                content={msg.content}
                                                planVersions={msg.planVersions?.length ? msg.planVersions : dynamicPlanVersions}
                                                dateTime={msg.timestamp}
                                                planContent={msg.planContent}
                                                sandboxJob={msg.sandboxJob}
                                                todoList={(isBuildMode && index === messages.length - 1 && buildTodos.length) ? (buildTodos as any) : msg.todoList}
                                                clarificationData={msg.clarificationData}
                                                thoughts={(isLoading && index === messages.length - 1) ? (liveThoughts || msg.thoughts) : msg.thoughts}
                                                timeline={(isLoading && index === messages.length - 1) ? (liveTimeline?.length ? liveTimeline : msg.timeline) : msg.timeline}
                                                planApproved={msg.planApproved}
                                                planSuperseded={isSuperseded}
                                                agentStep={(isLoading && index === messages.length - 1) ? agentStep : undefined}
                                                buildActivities={isBuildMode && index === messages.length - 1 ? buildActivities : undefined}
                                                buildTodos={(isBuildMode && index === messages.length - 1) ? (buildTodos.length ? buildTodos : msg.todoList) : undefined}
                                                isBuildSyncing={isBuildMode && index === messages.length - 1 ? isBuildSyncing : undefined}
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
                            {projectIdRef.current && (messages.some(m => m.planApproved) || buildTodos.length > 0) && (
                                <div className="px-4 mb-4 space-y-3">
                                    <BrainDecisionView
                                        projectId={projectIdRef.current}
                                        onDecisionOverride={(key, newVal) => {
                                            console.log(`Decision overridden: ${key} → ${newVal}`);
                                        }}
                                    />
                                    <BrainExecutionView
                                        projectId={projectIdRef.current}
                                    />
                                    <BrainArtifactView
                                        projectId={projectIdRef.current}
                                    />
                                </div>
                            )}
                            <div ref={messagesEndRef} className="h-40 shrink-0" />
                        </div>
                    )}
                    </div>

                    {/* Sticky Bottom Input */}
                    {messages.length > 0 && (
                        <div className={`bg-[#0a0a0a] relative z-10 shrink-0 ${isBuildMode ? 'border-t border-white/5 px-3 py-3' : 'p-6'}`}>
                            <div className={`${isBuildMode ? 'w-full' : 'max-w-3xl mx-auto'} relative group`}>
                                <div className="relative flex flex-col gap-2 bg-[#1a1a1a] border border-white/10 rounded-2xl p-2 pr-3 focus-within:border-white/20 transition-all duration-300 shadow-2xl">
                                    <div className="relative flex items-end gap-3 pt-1">
                                        {tokenEstimate !== null && !isBuildMode && (
                                            <div className="absolute -top-10 right-0 px-3 py-1.5 rounded-lg bg-[#1a1a1a] border border-white/10 shadow-2xl animate-in fade-in slide-in-from-bottom-2 duration-300">
                                                <div className="flex items-center gap-2">
                                                    <Zap size={12} className="text-[#976df8]" />
                                                    <span className="text-[11px] font-bold text-white/90">
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
                                            className="flex-1 bg-transparent border-none focus:ring-0 text-white placeholder:text-white/20 py-3 px-4 resize-none min-h-[52px] max-h-48 custom-scrollbar text-[15px]"
                                            rows={1}
                                        />
                                        {isLoading ? (
                                            <button
                                                onClick={handleStopChat}
                                                className="w-10 h-10 rounded-full transition-all flex items-center justify-center bg-white text-black hover:bg-white/80"
                                            >
                                                <Square size={16} fill="currentColor" />
                                            </button>
                                        ) : (
                                            <button
                                                id="brain-send-btn"
                                                onClick={() => handleSendMessage()}
                                                disabled={!input.trim()}
                                                className={`w-10 h-10 rounded-full transition-all flex items-center justify-center ${input.trim()
                                                    ? 'bg-white text-black'
                                                    : 'bg-white/5 text-white/20'
                                                    }`}
                                            >
                                                <ArrowRight size={20} />
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Right Side: Brain Editor Canvas (65% when building) */}
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
                                />
                        ) : (
                            <div className="flex-1 flex items-center justify-center text-white/30 text-sm">
                                Initializing workspace…
                            </div>
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
