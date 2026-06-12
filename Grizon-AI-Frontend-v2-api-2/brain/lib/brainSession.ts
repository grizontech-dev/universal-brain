'use client';

import { getBrainApiUrl, brainApiFetch } from './brainApiBase';

export interface SessionState {
  workflow_state?: string;
  current_agent?: string;
  current_task_id?: string;
  current_task_label?: string;
  task_index?: number;
  total_tasks?: number;
  project_id?: string;
  started_at?: string;
  last_active?: string;
  [key: string]: unknown;
}

export interface SessionResponse {
  session_id: string;
  data: SessionState;
  exists: boolean;
}

export async function fetchSession(sessionId: string): Promise<SessionResponse | null> {
  const res = await brainApiFetch(`memory/session/${sessionId}`);
  if (!res || !res.ok) return null;
  return res.json();
}

export async function updateSessionField(sessionId: string, field: string, value: string): Promise<boolean> {
  const res = await brainApiFetch(`memory/session/${sessionId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ field, value }),
  });
  return res?.ok ?? false;
}

export async function updateWorkflowState(sessionId: string, state: string, agent: string): Promise<boolean> {
  const params = new URLSearchParams({ state, agent });
  const res = await brainApiFetch(`memory/session/${sessionId}/workflow?${params}`, {
    method: 'PUT',
  });
  return res?.ok ?? false;
}

export async function clearSession(sessionId: string): Promise<boolean> {
  const res = await brainApiFetch(`memory/session/${sessionId}`, {
    method: 'DELETE',
  });
  return res?.ok ?? false;
}

export function workflowPhaseLabel(workflowState?: string): string {
  const labels: Record<string, string> = {
    starting: 'Starting...',
    planning: 'Planning',
    clarifying: 'Clarifying Requirements',
    todo_generation: 'Generating Tasks',
    building: 'Building',
    reviewing: 'Reviewing',
    done: 'Complete',
    error: 'Error',
  };
  return labels[workflowState ?? ''] ?? workflowState ?? 'Unknown';
}

export function workflowPhaseColor(workflowState?: string): string {
  const colors: Record<string, string> = {
    starting: 'text-yellow-400',
    planning: 'text-blue-400',
    clarifying: 'text-purple-400',
    todo_generation: 'text-cyan-400',
    building: 'text-green-400',
    reviewing: 'text-orange-400',
    done: 'text-emerald-400',
    error: 'text-red-400',
  };
  return colors[workflowState ?? ''] ?? 'text-gray-400';
}
