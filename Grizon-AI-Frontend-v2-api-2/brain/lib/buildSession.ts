'use client';

import type { BuildActivity } from './buildActivity';
import type { BuildTodoItem } from './buildActivity';
import {
    currentTaskIndexFromTodos,
    dedupeReloadActivities,
    isBuildTodosComplete,
    markAllTodosComplete,
    mergeTodosFromPlan,
} from './buildActivity';

export type BuildSessionSnapshot = {
    todos: BuildTodoItem[];
    activities: BuildActivity[];
    buildStartedAt: number | null;
    isBuildMode: boolean;
    currentTaskIndex?: number;
    previewUrl?: string | null;
    previewPort?: number | null;
};

const MAX_ACTIVITIES = 150;

function storageKey(conversationId: string) {
    return `grizon-brain-build:${conversationId}`;
}

export function saveBuildSession(conversationId: string, snap: BuildSessionSnapshot) {
    if (typeof window === 'undefined' || !conversationId) return;
    try {
        sessionStorage.setItem(
            storageKey(conversationId),
            JSON.stringify({
                ...snap,
                activities: snap.activities.slice(-MAX_ACTIVITIES),
            })
        );
    } catch {
        /* quota */
    }
}

export function loadBuildSession(conversationId: string): BuildSessionSnapshot | null {
    if (typeof window === 'undefined' || !conversationId) return null;
    try {
        const raw = sessionStorage.getItem(storageKey(conversationId));
        if (!raw) return null;
        return JSON.parse(raw) as BuildSessionSnapshot;
    } catch {
        return null;
    }
}

export function todosFromMessageList(todoData: unknown): BuildTodoItem[] {
    if (!Array.isArray(todoData)) return [];
    return todoData.map((t: Record<string, unknown>) => ({
        id: t.id as string | undefined,
        title: (t.title || t.task || t.label || 'Task') as string,
        task: (t.task || t.title) as string | undefined,
        description: t.description as string | undefined,
        status: (t.status as string) || 'pending',
        category: t.category as string | undefined,
        skill_required: t.skill_required as string | undefined,
        files: t.files as string[] | undefined,
        ui: t.ui as string[] | undefined,
        api: t.api as string[] | undefined,
        depends_on: t.depends_on as string[] | undefined,
        acceptance: t.acceptance as string[] | undefined,
    }));
}

/** Restore sidebar after reload — session first, then DB todo list. */
export function resolveBuildSessionForReload(
    conversationId: string,
    todoFromDb?: unknown
): BuildSessionSnapshot | null {
    const snap = loadBuildSession(conversationId);
    const dbTodos = todosFromMessageList(todoFromDb);

    if (snap && (snap.activities.length > 0 || snap.todos.length > 0)) {
        const dbComplete = dbTodos.length > 0 && isBuildTodosComplete(dbTodos);
        const activeIdx =
            typeof snap.currentTaskIndex === 'number'
                ? snap.currentTaskIndex
                : currentTaskIndexFromTodos(snap.todos.length ? snap.todos : dbTodos);
        const todos =
            dbComplete
                ? markAllTodosComplete(dbTodos)
                : snap.todos.length > 0
                    ? snap.todos
                    : dbTodos.length > 0
                        ? mergeTodosFromPlan(dbTodos, activeIdx, 'building')
                        : [];
        return {
            ...snap,
            todos,
            activities: dedupeReloadActivities(snap.activities),
            currentTaskIndex: activeIdx,
            isBuildMode: true,
        };
    }

    if (dbTodos.length > 0) {
        return {
            todos: isBuildTodosComplete(dbTodos)
                ? markAllTodosComplete(dbTodos)
                : mergeTodosFromPlan(dbTodos),
            activities: [],
            buildStartedAt: null,
            isBuildMode: true,
        };
    }

    return null;
}
