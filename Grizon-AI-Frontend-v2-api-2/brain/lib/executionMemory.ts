import { brainApiFetch } from './brainApiBase';

export interface ExecutionLog {
  id: string;
  project_id: string;
  todo_id?: string | null;
  task_name: string;
  task_type?: string | null;
  agent?: string | null;
  status: string;
  output_files: string[];
  error_message?: string | null;
  retry_count: number;
  started_at?: string | null;
  completed_at?: string | null;
  duration_ms?: number | null;
  token_count?: number | null;
}

export interface ExecutionSummary {
  project_id: string;
  summary: { status: string; count: number; total_tokens: number | null }[];
}

export async function startTask(
  projectId: string,
  taskName: string,
  agent: string,
  todoId?: string
): Promise<{ id: string; task_name: string; status: string }> {
  const res = await brainApiFetch('execution/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project_id: projectId, task_name: taskName, agent, todo_id: todoId }),
  });
  if (!res?.ok) throw new Error('Failed to start task');
  return res.json();
}

export async function completeTask(
  logId: string,
  outputFiles?: string[],
  tokenCount?: number
): Promise<void> {
  const res = await brainApiFetch(`execution/${encodeURIComponent(logId)}/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ output_files: outputFiles ?? [], token_count: tokenCount ?? 0 }),
  });
  if (!res?.ok) throw new Error('Failed to complete task');
}

export async function failTask(logId: string, errorMessage: string): Promise<void> {
  const res = await brainApiFetch(`execution/${encodeURIComponent(logId)}/fail`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ error_message: errorMessage }),
  });
  if (!res?.ok) throw new Error('Failed to mark task failed');
}

export async function isAlreadyDone(projectId: string, taskName: string): Promise<boolean> {
  const res = await brainApiFetch(
    `execution/check/${encodeURIComponent(projectId)}/${encodeURIComponent(taskName)}`
  );
  if (!res?.ok) throw new Error('Failed to check task');
  const data = await res.json();
  return data.already_done;
}

export async function getFailedTasks(projectId: string): Promise<ExecutionLog[]> {
  const res = await brainApiFetch(`execution/failed/${encodeURIComponent(projectId)}`);
  if (!res?.ok) throw new Error('Failed to fetch failed tasks');
  return res.json();
}

export async function getExecutionSummary(projectId: string): Promise<ExecutionSummary> {
  const res = await brainApiFetch(`execution/summary/${encodeURIComponent(projectId)}`);
  if (!res?.ok) throw new Error('Failed to fetch execution summary');
  return res.json();
}
