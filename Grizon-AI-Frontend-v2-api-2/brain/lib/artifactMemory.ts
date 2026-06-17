import { brainApiFetch } from './brainApiBase';

export interface ArtifactItem {
  id: string;
  project_id: string;
  name: string;
  artifact_type: string;
  file_path: string;
  version: number;
  content_hash?: string | null;
  dependencies: string[];
  exports: string[];
  language?: string | null;
  size_bytes?: number | null;
  is_active: boolean;
  created_by?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export async function registerArtifact(projectId: string, artifact: {
  name: string;
  type: string;
  filePath: string;
  contentHash?: string;
  dependencies?: string[];
  exports?: string[];
  language?: string;
  sizeBytes?: number;
  createdBy?: string;
}): Promise<ArtifactItem> {
  const res = await brainApiFetch('artifacts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project_id: projectId, ...artifact }),
  });
  if (!res?.ok) throw new Error('Failed to register artifact');
  return res.json();
}

export async function getAllArtifacts(projectId: string): Promise<ArtifactItem[]> {
  const res = await brainApiFetch(`artifacts/${encodeURIComponent(projectId)}`);
  if (!res?.ok) throw new Error('Failed to fetch artifacts');
  return res.json();
}

export async function checkArtifactExists(projectId: string, filePath: string): Promise<boolean> {
  const res = await brainApiFetch(
    `artifacts/${encodeURIComponent(projectId)}/check?path=${encodeURIComponent(filePath)}`
  );
  if (!res?.ok) throw new Error('Failed to check artifact');
  const data = await res.json();
  return data.exists;
}

export async function getArtifactsByType(projectId: string, artifactType: string): Promise<ArtifactItem[]> {
  const res = await brainApiFetch(
    `artifacts/${encodeURIComponent(projectId)}/type/${encodeURIComponent(artifactType)}`
  );
  if (!res?.ok) throw new Error('Failed to fetch artifacts by type');
  return res.json();
}

export async function deactivateArtifact(artifactId: string): Promise<void> {
  const res = await brainApiFetch(`artifacts/${encodeURIComponent(artifactId)}`, {
    method: 'DELETE',
  });
  if (!res?.ok) throw new Error('Failed to deactivate artifact');
}
