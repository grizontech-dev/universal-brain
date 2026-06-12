export interface BenchmarkJobPayload {
  runId: string;
  caseId: string;
  prompt: string;
  agentSlug: string;
  modelId: string | null;
}
