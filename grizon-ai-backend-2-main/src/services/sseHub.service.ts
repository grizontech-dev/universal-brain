type SseEventName =
  | "queued"
  | "processing"
  | "status"
  | "chunk"
  | "tool_call"
  | "tool_result"
  | "artifact"
  | "usage"
  | "done"
  | "error"
  | "cancelled"
  | "heartbeat";

export type SseEvent = {
  event: SseEventName;
  data: Record<string, unknown>;
  ts: number;
};

type Subscriber = (event: SseEvent) => void;

const MAX_REPLAY_EVENTS = 256;
const RETENTION_MS = 5 * 60 * 1000;

class SseHubService {
  private subscribers = new Map<string, Set<Subscriber>>();
  private ringBuffers = new Map<string, SseEvent[]>();
  private cleanupTimers = new Map<string, NodeJS.Timeout>();

  subscribe(jobId: string, fn: Subscriber): () => void {
    const set = this.subscribers.get(jobId) ?? new Set<Subscriber>();
    set.add(fn);
    this.subscribers.set(jobId, set);

    const buffered = this.ringBuffers.get(jobId) ?? [];
    for (const event of buffered) {
      fn(event);
    }

    return () => {
      const current = this.subscribers.get(jobId);
      if (!current) return;
      current.delete(fn);
      if (current.size === 0) {
        this.subscribers.delete(jobId);
      }
    };
  }

  publish(jobId: string, event: SseEventName, data: Record<string, unknown>) {
    const payload: SseEvent = { event, data, ts: Date.now() };
    const ring = this.ringBuffers.get(jobId) ?? [];
    ring.push(payload);
    if (ring.length > MAX_REPLAY_EVENTS) {
      ring.splice(0, ring.length - MAX_REPLAY_EVENTS);
    }
    this.ringBuffers.set(jobId, ring);

    const subscribers = this.subscribers.get(jobId);
    if (!subscribers?.size) return;
    for (const subscriber of subscribers) {
      subscriber(payload);
    }
  }

  close(jobId: string) {
    const existingTimer = this.cleanupTimers.get(jobId);
    if (existingTimer) clearTimeout(existingTimer);

    const timer = setTimeout(() => {
      this.ringBuffers.delete(jobId);
      this.subscribers.delete(jobId);
      this.cleanupTimers.delete(jobId);
    }, RETENTION_MS);
    this.cleanupTimers.set(jobId, timer);
  }
}

export const sseHub = new SseHubService();
