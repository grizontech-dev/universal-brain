import { brainApiFetch } from './brainApiBase';

export interface ProjectData {
  id: string;
  name: string;
  description?: string | null;
  frontend?: string | null;
  backend?: string | null;
  database?: string | null;
  css_framework?: string | null;
  auth_method?: string | null;
  folder_structure?: Record<string, unknown> | null;
  requirements: string[];
  roadmap?: Record<string, unknown> | null;
  status: string;
  owner_id?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface CreateProjectInput {
  name: string;
  description?: string;
  frontend?: string;
  backend?: string;
  database?: string;
  css_framework?: string;
  auth_method?: string;
  folder_structure?: Record<string, unknown>;
  requirements?: string[];
  roadmap?: Record<string, unknown>;
  owner_id?: string;
}

export async function createProject(data: CreateProjectInput): Promise<ProjectData> {
  const res = await brainApiFetch('projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res?.ok) throw new Error('Failed to create project');
  return res.json();
}

export async function getProject(id: string): Promise<ProjectData> {
  const res = await brainApiFetch(`projects/${id}`);
  if (!res?.ok) throw new Error('Project not found');
  return res.json();
}

export async function listProjects(ownerId: string): Promise<ProjectData[]> {
  const res = await brainApiFetch(`projects?owner_id=${encodeURIComponent(ownerId)}`);
  if (!res?.ok) throw new Error('Failed to list projects');
  return res.json();
}

export async function updateProjectStack(id: string, updates: Partial<CreateProjectInput>): Promise<void> {
  const res = await brainApiFetch(`projects/${id}/stack`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  if (!res?.ok) throw new Error('Failed to update project stack');
}

export async function appendRequirement(id: string, requirement: string): Promise<void> {
  const res = await brainApiFetch(`projects/${id}/requirements`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requirement }),
  });
  if (!res?.ok) throw new Error('Failed to append requirement');
}
