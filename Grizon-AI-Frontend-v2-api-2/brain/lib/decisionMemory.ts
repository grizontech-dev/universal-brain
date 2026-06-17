import { brainApiFetch } from './brainApiBase';

export interface DecisionItem {
  id: string;
  project_id: string;
  category: string;
  decision_key: string;
  decision_val: string;
  reason?: string | null;
  approved_at?: string | null;
  approved_by: string;
  is_active: boolean;
}

export interface ActiveDecisionsResponse {
  project_id: string;
  decisions: Record<string, string>;
  items: DecisionItem[];
}

export async function getActiveDecisions(projectId: string): Promise<ActiveDecisionsResponse> {
  const res = await brainApiFetch(`decisions/${encodeURIComponent(projectId)}`);
  if (!res?.ok) throw new Error('Failed to fetch decisions');
  return res.json();
}

export async function storeDecisions(projectId: string, decisions: Record<string, string>): Promise<void> {
  const res = await brainApiFetch('decisions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project_id: projectId, decisions }),
  });
  if (!res?.ok) throw new Error('Failed to store decisions');
}

export async function overrideDecision(
  projectId: string,
  decisionKey: string,
  newValue: string,
  reason?: string
): Promise<void> {
  const res = await brainApiFetch('decisions/override', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project_id: projectId, decision_key: decisionKey, new_value: newValue, reason }),
  });
  if (!res?.ok) throw new Error('Failed to override decision');
}
