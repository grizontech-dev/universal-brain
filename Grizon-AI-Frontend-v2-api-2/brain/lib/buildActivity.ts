export type BrainEvent =
  | {
      type: "narration";
      message: string;
      timestamp: string;
    }
  | {
      type: "thinking";
      message: string;
      timestamp: string;
    }
  | {
      type: "todo_created";
      todos: BuildTodoItem[];
      timestamp: string;
    }
  | {
      type: "task_started";
      taskId: string;
      title: string;
      timestamp: string;
    }
  | {
      type: "task_completed";
      taskId: string;
      title: string;
      timestamp: string;
    }
  | {
      type: "file_created";
      file: string;
      reason: string;
      expectedResult: string;
      timestamp: string;
    }
  | {
      type: "file_updated";
      file: string;
      reason: string;
      expectedResult: string;
      timestamp: string;
    }
  | {
      type: "dependency_installed";
      packageName: string;
      timestamp: string;
    }
  | {
      type: "tool_action";
      action: string;
      timestamp: string;
    }
  | {
      type: "validation";
      status: "running" | "success" | "failed";
      timestamp: string;
    }
  | {
      type: "build_success";
      timestamp: string;
    };

export type BuildActivityType =
    | 'task_start'
    | 'task_done'
    | 'task_failed'
    | 'write_file'
    | 'edit_file'
    | 'read_file'
    | 'mkdir'
    | 'run_command'
    | 'template'
    | 'explore'
    | 'search'
    | 'sync'
    | 'narration'
    | 'thinking'
    | 'milestone';

export interface BuildActivity {
    id: string;
    type: BuildActivityType;
    label: string;
    detail?: string;
    path?: string;
    taskTitle?: string;
    status?: 'running' | 'done' | 'failed';
    timestamp: number;
    linesAdded?: number;
    linesRemoved?: number;
    reason?: string;
    expectedResult?: string;
    isGroup?: boolean;
}

let activityCounter = 0;
export function nextActivityId() {
    activityCounter += 1;
    return `act-${Date.now()}-${activityCounter}`;
}

/** Strip ANSI escape codes and control chars from terminal output */
export function stripAnsi(text: string): string {
    return text
        .replace(/\x1B\[[0-9;?]*[a-zA-Z]/g, '')
        .replace(/\x1B\][^\x07]*\x07/g, '')
        .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '')
        .replace(/\r/g, '')
        .trim();
}

/** Terminal noise that should not appear in the activity feed */
export function isNoisyTerminalLine(line: string): boolean {
    const s = stripAnsi(line);
    if (!s || s.length < 2) return true;
    if (/^[\][\[\]\\\/\^\?\dGOKcKlhmpsu%#@\-_=:|.,'"`~*]+$/.test(s)) return true;
    if (/^\[?\d*[GK]/.test(s)) return true;
    if (/^\[OK/i.test(s) || /^OK$/i.test(s)) return true;
    if (/^\\+$/.test(s)) return true;
    if (/^\d+$/.test(s)) return true;
    if (/^[\d,.\s]+$/.test(s)) return true;
    if (s.length <= 4 && !/[a-zA-Z]{4,}/.test(s)) return true;
    return false;
}

function summarizeTerminalOutput(raw: string): BuildActivity | null {
    const line = stripAnsi(raw);
    if (isNoisyTerminalLine(line)) return null;

    const lower = line.toLowerCase();
    if (lower.includes('vite') && (lower.includes('ready') || lower.includes('local'))) {
        return {
            id: nextActivityId(),
            type: 'narration',
            label: 'Dev server is ready',
            detail: line.slice(0, 120),
            timestamp: Date.now(),
            status: 'done',
        };
    }
    if (lower.includes('added') && lower.includes('packages')) {
        return {
            id: nextActivityId(),
            type: 'narration',
            label: 'Installed npm packages',
            timestamp: Date.now(),
            status: 'done',
        };
    }
    if (lower.includes('npm warn') || lower.includes('deprecated')) return null;
    if (line.length > 120) return null;
    if (/^[a-zA-Z]/.test(line)) {
        return {
            id: nextActivityId(),
            type: 'narration',
            label: line,
            timestamp: Date.now(),
            status: 'done',
        };
    }
    return null;
}

export function parseProgressToActivity(progressMsg: string): BuildActivity | null {
    const msg = progressMsg.trim();
    if (!msg) return null;

    // Support structured JSON BrainEvent parsing
    if (msg.startsWith('{') && msg.endsWith('}')) {
        try {
            const event = JSON.parse(msg) as BrainEvent;
            const uniqueKey = (event as any).timestamp || Date.now().toString() + Math.random().toString(36).slice(2, 6);
            const safeMsg = (event.type + (event as any).file + (event as any).taskId + uniqueKey).replace(/[^a-zA-Z0-9]/g, '-').slice(0, 40);
            
            switch (event.type) {
                case 'narration':
                    return { id: `prog-narr-${safeMsg}`, type: 'narration', label: event.message, timestamp: parseInt(event.timestamp) || Date.now(), status: 'done' };
                case 'thinking':
                    return { id: `prog-think-${safeMsg}`, type: 'thinking', label: event.message, timestamp: parseInt(event.timestamp) || Date.now(), status: 'done' };
                case 'task_started':
                    return { id: `prog-start-${safeMsg}`, type: 'explore', label: `Exploring — ${event.title}`, taskTitle: event.title, timestamp: parseInt(event.timestamp) || Date.now(), status: 'running' };
                case 'task_completed':
                    return { id: `prog-task-${safeMsg}`, type: 'task_done', label: event.title, taskTitle: event.title, timestamp: parseInt(event.timestamp) || Date.now(), status: 'done' };
                case 'file_created':
                    return { id: `prog-file-${safeMsg}`, type: 'write_file', label: `Generated \`${event.file}\``, path: event.file, reason: event.reason, expectedResult: event.expectedResult, timestamp: parseInt(event.timestamp) || Date.now(), status: 'done', linesAdded: (event as any).linesAdded, linesRemoved: (event as any).linesRemoved };
                case 'file_updated':
                    return { id: `prog-edit-${safeMsg}`, type: 'edit_file', label: `Modified \`${event.file}\``, path: event.file, reason: event.reason, expectedResult: event.expectedResult, timestamp: parseInt(event.timestamp) || Date.now(), status: 'done', linesAdded: (event as any).linesAdded, linesRemoved: (event as any).linesRemoved };
                case 'dependency_installed':
                    return { id: `prog-dep-${safeMsg}`, type: 'run_command', label: `Installing dependency... npm install ${event.packageName}`, detail: event.packageName, timestamp: parseInt(event.timestamp) || Date.now(), status: 'done' };
                case 'tool_action':
                    return { id: `prog-tool-${safeMsg}`, type: 'run_command', label: `Running tool: ${event.action}`, timestamp: parseInt(event.timestamp) || Date.now(), status: 'running' };
                case 'validation':
                    return { id: `prog-val-${safeMsg}`, type: 'run_command', label: `Running validation...`, timestamp: parseInt(event.timestamp) || Date.now(), status: event.status === 'success' ? 'done' : event.status === 'failed' ? 'failed' : 'running' };
                case 'build_success':
                    return { id: `prog-build-${safeMsg}`, type: 'milestone', label: `✔ Build Successful`, timestamp: parseInt(event.timestamp) || Date.now(), status: 'done' };
            }
        } catch (e) {
            console.warn('[Brain] Failed to parse structured BrainEvent', e);
        }
    }

    const safeMsg = msg.replace(/[^a-zA-Z0-9]/g, '-').slice(0, 30);

    if (msg.startsWith('[FILE]')) {
        const path = msg.replace('[FILE]', '').trim();
        return {
            id: `prog-file-${safeMsg}`,
            type: 'write_file',
            label: `Generated \`${path}\``,
            path,
            timestamp: Date.now(),
            status: 'done',
        };
    }
    if (msg.startsWith('[COMMAND]')) {
        const cmd = msg.replace('[COMMAND]', '').trim();
        return {
            id: `prog-cmd-${safeMsg}`,
            type: 'run_command',
            label: `Running \`${cmd}\``,
            detail: cmd,
            timestamp: Date.now(),
            status: 'running',
        };
    }
    if (msg.startsWith('[OUTPUT]')) {
        return summarizeTerminalOutput(msg.replace('[OUTPUT]', '').trim());
    }
    if (msg.startsWith('[TASK_START]')) {
        const title = msg.replace('[TASK_START]', '').trim();
        return {
            id: `prog-start-${safeMsg}`,
            type: 'explore',
            label: `Exploring — ${title}`,
            taskTitle: title,
            timestamp: Date.now(),
            status: 'running',
        };
    }
    if (msg.startsWith('[MKDIR]')) {
        const path = msg.replace('[MKDIR]', '').trim();
        return {
            id: `prog-mkdir-${safeMsg}`,
            type: 'mkdir',
            label: `Created folder \`${path}/\``,
            path,
            timestamp: Date.now(),
            status: 'done',
        };
    }
    if (msg.startsWith('[TEMPLATE]')) {
        return {
            id: `prog-tmpl-${safeMsg}`,
            type: 'template',
            label: msg.replace('[TEMPLATE]', '').trim() || 'Synced project templates',
            timestamp: Date.now(),
            status: 'done',
        };
    }
    if (msg.startsWith('[TASK_PROGRESS]')) {
        const body = msg.replace('[TASK_PROGRESS]', '').trim();
        const [title, status] = body.split(':').map((s) => s.trim());
        const failed = status?.toLowerCase().includes('fail');
        return {
            id: `prog-task-${safeMsg}`,
            type: failed ? 'task_failed' : 'task_done',
            label: title || body,
            taskTitle: title,
            detail: status,
            timestamp: Date.now(),
            status: failed ? 'failed' : 'done',
        };
    }
    if (msg.startsWith('[RUNNER]')) {
        const body = msg.replace('[RUNNER]', '').trim();
        return {
            id: nextActivityId(),
            type: 'run_command',
            label: body || 'Starting servers',
            timestamp: Date.now(),
            status: 'running',
        };
    }
    return null;
}

export function workspaceOpToActivity(op: {
    op: string;
    path?: string;
    command?: string;
    content?: string;
    packages?: string[];
}): BuildActivity | null {
    // Generate deterministic ID based on op and path so BrainMessages.tsx can correctly deduplicate
    const safePath = op.path ? op.path.replace(/[^a-zA-Z0-9]/g, '-') : '';
    const detId = `op-${op.op}-${safePath}`;

    if (op.op === 'write_file' && op.path) {
        const lineCount = op.content ? op.content.split('\n').length : 0;
        return {
            id: detId,
            type: 'write_file',
            label: `Generated \`${op.path}\``,
            path: op.path,
            timestamp: Date.now(),
            status: 'done',
            linesAdded: lineCount,
        };
    }
    if (op.op === 'mkdir' && op.path) {
        return {
            id: detId,
            type: 'mkdir',
            label: `Created folder \`${op.path}/\``,
            path: op.path,
            timestamp: Date.now(),
            status: 'done',
        };
    }
    if (op.op === 'delete_file' && op.path) {
        return {
            id: detId,
            type: 'edit_file',
            label: `Removed \`${op.path}\``,
            path: op.path,
            timestamp: Date.now(),
            status: 'done',
            linesRemoved: 1, // Placeholder since content is deleted
        };
    }
    if (op.op === 'install_packages' && op.packages?.length) {
        return {
            id: detId,
            type: 'run_command',
            label: `Installing ${op.packages.slice(0, 4).join(', ')}${op.packages.length > 4 ? '…' : ''}`,
            detail: `npm install ${op.packages.join(' ')}`,
            timestamp: Date.now(),
            status: 'running',
        };
    }
    if (op.op === 'run' && op.command) {
        const bg = !!(op as { background?: boolean }).background;
        return {
            id: nextActivityId(),
            type: 'run_command',
            label: `Running \`${op.command}\``,
            detail: op.command,
            timestamp: Date.now(),
            status: bg ? 'running' : 'running',
        };
    }
    return null;
}

export function mapBackendActivity(raw: Record<string, unknown>): BuildActivity | null {
    const type = raw.type as BuildActivityType;
    if (!type) return null;
    const label = (raw.label as string) || 'Working…';
    if (type === 'narration' && isNoisyTerminalLine(label)) return null;
    return {
        id: (raw.id as string) || nextActivityId(),
        type,
        label,
        detail: raw.detail as string | undefined,
        path: raw.path as string | undefined,
        taskTitle: raw.taskTitle as string | undefined,
        status: (raw.status as BuildActivity['status']) || 'done',
        timestamp: (raw.timestamp as number) || Date.now(),
        linesAdded: raw.linesAdded as number | undefined,
        linesRemoved: raw.linesRemoved as number | undefined,
    };
}

export type BuildTodoItem = {
    id?: string;
    title?: string;
    task?: string;
    description?: string;
    status?: string;
    category?: string;
};

export function normalizeTodoStatus(raw?: string): string {
    const s = (raw || '').toLowerCase();
    if (s === 'completed' || s === 'success' || s === 'done') return 'completed';
    if (s === 'failed' || s === 'error') return 'failed';
    if (s === 'executing' || s === 'running' || s === 'pending_confirmation') return 'executing';
    if (s === 'pending' || !s) return 'pending';
    return s;
}

export function enforceSequentialTodos(todos: BuildTodoItem[]): BuildTodoItem[] {
    const next = [...todos];
    let maxExecutingIdx = -1;
    for (let i = 0; i < next.length; i++) {
        const s = normalizeTodoStatus(next[i].status);
        if (s === 'executing' || s === 'running') {
            maxExecutingIdx = i;
        }
    }
    
    // Since tasks run sequentially, any task BEFORE the latest executing/completed task must be completed
    let lastActiveOrDone = maxExecutingIdx;
    for (let i = next.length - 1; i >= 0; i--) {
        if (normalizeTodoStatus(next[i].status) === 'completed') {
            if (i > lastActiveOrDone) lastActiveOrDone = i;
        }
    }

    if (lastActiveOrDone >= 0) {
        for (let i = 0; i < lastActiveOrDone; i++) {
            if (normalizeTodoStatus(next[i].status) !== 'failed') {
                next[i] = { ...next[i], status: 'completed' };
            }
        }
    }
    return next;
}

/** Apply backend plan + optional active index so only one task shows as running. */
export function mergeTodosFromPlan(
    plan: BuildTodoItem[],
    activeIndex?: number,
    buildPhase?: string
): BuildTodoItem[] {
    if (!plan.length) return [];

    const idx =
        typeof activeIndex === 'number' && activeIndex >= 0 ? activeIndex : undefined;

    const merged = plan.map((t, i) => {
        let status = normalizeTodoStatus(t.status);

        if (idx !== undefined) {
            const isRunner = (t.category || '').toLowerCase() === 'runner';
            if (buildPhase === 'runner' && isRunner) {
                status = 'executing';
            } else if (buildPhase === 'complete') {
                status = status === 'failed' ? 'failed' : 'completed';
            } else if (i < idx) {
                status = status === 'failed' ? 'failed' : 'completed';
            } else if (i === idx) {
                status = 'executing';
            } else {
                status = 'pending';
            }
        }

        return {
            ...t,
            title: t.title || t.task || 'Task',
            status,
        };
    });
    
    return enforceSequentialTodos(merged);
}

/** First executing task, else first incomplete, else end of list. */
export function currentTaskIndexFromTodos(todos: BuildTodoItem[]): number {
    if (!todos.length) return 0;
    const executing = todos.findIndex((t) => normalizeTodoStatus(t.status) === 'executing');
    if (executing >= 0) return executing;
    const pending = todos.findIndex((t) => {
        const s = normalizeTodoStatus(t.status);
        return s !== 'completed' && s !== 'failed';
    });
    return pending >= 0 ? pending : todos.length;
}

export function markAllTodosComplete(todos: BuildTodoItem[]): BuildTodoItem[] {
    return todos.map((t) => ({
        ...t,
        title: t.title || t.task || 'Task',
        status: normalizeTodoStatus(t.status) === 'failed' ? 'failed' : 'completed',
    }));
}

const RELOAD_PREVIEW_LABEL = 'Reloaded — restoring preview';

export function isReloadPreviewActivity(a: BuildActivity): boolean {
    return a.type === 'narration' && a.label.includes(RELOAD_PREVIEW_LABEL);
}

/** Keep a single reload row in the activity feed. */
export function dedupeReloadActivities(activities: BuildActivity[]): BuildActivity[] {
    const reloadIndexes = activities
        .map((a, i) => (isReloadPreviewActivity(a) ? i : -1))
        .filter((i) => i >= 0);
    if (reloadIndexes.length <= 1) return activities;
    const keep = reloadIndexes[reloadIndexes.length - 1];
    return activities.filter((a, i) => !isReloadPreviewActivity(a) || i === keep);
}

export function markReloadPreviewDone(activities: BuildActivity[]): BuildActivity[] {
    return dedupeReloadActivities(activities).map((a) =>
        isReloadPreviewActivity(a)
            ? {
                  ...a,
                  status: 'done' as const,
                  label: 'Reloaded — preview restored (npm run dev)',
              }
            : a
    );
}

/** Flip spinners off in the activity feed once dev server / preview is ready. */
export function markRunningActivitiesDone(activities: BuildActivity[]): BuildActivity[] {
    return activities.map((a) =>
        a.status === 'running' ? { ...a, status: 'done' as const } : a
    );
}

function todoTitleKey(t: BuildTodoItem): string {
    return (t.title || t.task || '').trim().toLowerCase();
}

function activityTitleKey(a: BuildActivity): string {
    const raw = a.taskTitle || a.label || '';
    return raw.replace(/^exploring\s*—\s*/i, '').trim().toLowerCase();
}

function findTodoIndex(todos: BuildTodoItem[], activity: BuildActivity): number {
    const key = activityTitleKey(activity);
    if (!key) return -1;
    let idx = todos.findIndex((t) => todoTitleKey(t) === key);
    if (idx >= 0) return idx;
    idx = todos.findIndex(
        (t) => key.includes(todoTitleKey(t)) || todoTitleKey(t).includes(key)
    );
    return idx;
}

/** Update todo statuses from task_start / task_done activities. */
export function applyActivitiesToTodos(
    todos: BuildTodoItem[],
    activities: BuildActivity[]
): BuildTodoItem[] {
    if (!todos.length || !activities.length) return todos;

    const next = todos.map((t) => ({ ...t, title: t.title || t.task || 'Task' }));

    for (const a of activities) {
        const idx = findTodoIndex(next, a);
        if (idx < 0) continue;

        if (a.type === 'task_start' || (a.type === 'explore' && a.status === 'running')) {
            for (let i = 0; i < next.length; i++) {
                if (i < idx && normalizeTodoStatus(next[i].status) !== 'failed') {
                    next[i] = { ...next[i], status: 'completed' };
                }
            }
            next[idx] = { ...next[idx], status: 'executing' };
        }
        if (a.type === 'task_done' || a.type === 'task_failed') {
            next[idx] = {
                ...next[idx],
                status: a.type === 'task_failed' || a.status === 'failed' ? 'failed' : 'completed',
            };
        }
    }

    return enforceSequentialTodos(next);
}

export function isBuildTodosComplete(todos: { status?: string }[]): boolean {
    if (!todos.length) return false;
    return todos.every((t) => {
        const s = normalizeTodoStatus(t.status);
        return s === 'completed' || s === 'failed';
    });
}

