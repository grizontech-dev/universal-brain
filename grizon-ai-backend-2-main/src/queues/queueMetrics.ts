import type { Queue } from "bullmq";

import { chatQueue } from "./chat.queue.js";
import { fileQueue } from "./file.queue.js";
import { notificationQueue } from "./notification.queue.js";

export async function snapshotQueue(queue: Queue, name: string) {
  const counts = await queue.getJobCounts("active", "waiting", "completed", "failed", "delayed");
  return {
    name,
    active: Number(counts.active ?? 0),
    waiting: Number(counts.waiting ?? 0),
    completed: Number(counts.completed ?? 0),
    failed: Number(counts.failed ?? 0),
    delayed: Number(counts.delayed ?? 0),
  };
}

export async function snapshotAllQueues() {
  return Promise.all([
    snapshotQueue(chatQueue, "chat"),
    snapshotQueue(fileQueue, "file"),
    snapshotQueue(notificationQueue, "notification"),
  ]);
}
