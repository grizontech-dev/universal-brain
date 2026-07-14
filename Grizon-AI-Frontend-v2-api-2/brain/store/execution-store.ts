import { create } from 'zustand';

export type AgentPhase = 'IDLE' | 'ANALYZING' | 'PLANNING' | 'QUESTIONING' | 'WAITING_FOR_USER' | 'EXECUTING' | 'SYNCING' | 'COMPLETED';

export type AgentRole = 'LEADER' | 'PLANNER' | 'FRONTEND' | 'BACKEND' | 'DATABASE' | 'TESTER';

export type AgentStatus = 'IDLE' | 'THINKING' | 'WORKING' | 'DONE' | 'ERROR';

export interface ActiveAgent {
    id: string;
    role: AgentRole;
    name: string;
    status: AgentStatus;
    currentTask?: string;
    progress?: number;
}

export interface TimelineEvent {
    id: string;
    timestamp: number;
    text: string;
    type: 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR';
}

export interface LiveTodo {
    id: string;
    text: string;
    status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED';
}

export interface FileOperation {
    id: string;
    filename: string;
    operation: 'READ' | 'CREATE' | 'UPDATE' | 'DELETE' | 'INSTALL';
    status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'ERROR';
}

interface ExecutionState {
    currentPhase: AgentPhase;
    timeline: TimelineEvent[];
    activeAgents: Record<string, ActiveAgent>;
    dynamicTodos: LiveTodo[];
    fileOperations: FileOperation[];
    streamingMessage: string | null;

    // Actions
    setPhase: (phase: AgentPhase) => void;
    addTimelineEvent: (text: string, type?: TimelineEvent['type']) => void;
    updateAgent: (id: string, updates: Partial<ActiveAgent>) => void;
    addTodo: (todo: Omit<LiveTodo, 'id' | 'status'>) => void;
    updateTodo: (id: string, status: LiveTodo['status']) => void;
    addFileOperation: (op: Omit<FileOperation, 'id' | 'status'>) => void;
    updateFileOperation: (id: string, status: FileOperation['status']) => void;
    setStreamingMessage: (msg: string | null) => void;
    resetExecution: () => void;
}

export const useExecutionStore = create<ExecutionState>((set) => ({
    currentPhase: 'IDLE',
    timeline: [],
    activeAgents: {
        leader: { id: 'leader', role: 'LEADER', name: 'Leader Agent', status: 'IDLE', progress: 0 },
        planner: { id: 'planner', role: 'PLANNER', name: 'Architect Agent', status: 'IDLE', progress: 0 },
        frontend: { id: 'frontend', role: 'FRONTEND', name: 'Frontend Builder', status: 'IDLE', progress: 0 },
        backend: { id: 'backend', role: 'BACKEND', name: 'Backend Builder', status: 'IDLE', progress: 0 },
        database: { id: 'database', role: 'DATABASE', name: 'Database Engineer', status: 'IDLE', progress: 0 },
        tester: { id: 'tester', role: 'TESTER', name: 'QA Agent', status: 'IDLE', progress: 0 }
    },
    dynamicTodos: [],
    fileOperations: [],
    streamingMessage: null,

    setPhase: (phase) => set({ currentPhase: phase }),
    
    addTimelineEvent: (text, type = 'INFO') => set((state) => ({
        timeline: [...state.timeline, { id: crypto.randomUUID(), timestamp: Date.now(), text, type }]
    })),

    updateAgent: (id, updates) => set((state) => ({
        activeAgents: {
            ...state.activeAgents,
            [id]: { ...state.activeAgents[id], ...updates }
        }
    })),

    addTodo: (todo) => set((state) => ({
        dynamicTodos: [...state.dynamicTodos, { ...todo, id: crypto.randomUUID(), status: 'PENDING' }]
    })),

    updateTodo: (id, status) => set((state) => ({
        dynamicTodos: state.dynamicTodos.map(t => t.id === id ? { ...t, status } : t)
    })),

    addFileOperation: (op) => set((state) => ({
        fileOperations: [...state.fileOperations, { ...op, id: crypto.randomUUID(), status: 'PENDING' }]
    })),

    updateFileOperation: (id, status) => set((state) => ({
        fileOperations: state.fileOperations.map(f => f.id === id ? { ...f, status } : f)
    })),

    setStreamingMessage: (msg) => set({ streamingMessage: msg }),

    resetExecution: () => set({
        currentPhase: 'IDLE',
        timeline: [],
        dynamicTodos: [],
        fileOperations: [],
        streamingMessage: null,
        activeAgents: {
            leader: { id: 'leader', role: 'LEADER', name: 'Leader Agent', status: 'IDLE', progress: 0 },
            planner: { id: 'planner', role: 'PLANNER', name: 'Architect Agent', status: 'IDLE', progress: 0 },
            frontend: { id: 'frontend', role: 'FRONTEND', name: 'Frontend Builder', status: 'IDLE', progress: 0 },
            backend: { id: 'backend', role: 'BACKEND', name: 'Backend Builder', status: 'IDLE', progress: 0 },
            database: { id: 'database', role: 'DATABASE', name: 'Database Engineer', status: 'IDLE', progress: 0 },
            tester: { id: 'tester', role: 'TESTER', name: 'QA Agent', status: 'IDLE', progress: 0 }
        }
    })
}));
