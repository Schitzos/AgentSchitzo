import type { SendFn } from "./handle-telegram-command.ts";

export type TaskStatus = "queued" | "running" | "verifying" | "repair" | "done" | "failed";

export interface TaskEntry {
  id: number;
  prompt: string;
  status: TaskStatus;
  startedAt?: number;
  finishedAt?: number;
}

export interface TaskQueue {
  enqueue(prompt: string): TaskEntry;
  current(): TaskEntry | null;
  pending(): TaskEntry[];
  size(): number;
  markRunning(): void;
  markVerifying(): void;
  markRepair(attempt: number): void;
  markDone(): void;
  markFailed(): void;
  drain(): void;
  isLocked(): boolean;
}

const STATUS_MESSAGES: Record<TaskStatus, string> = {
  queued: "⏳ Got it! Your request is in line, I'll get to it shortly.",
  running: "🔨 Working on it now...",
  verifying: "🧪 Almost done — just running tests to make sure everything works.",
  repair: "🔄 Found some issues, fixing them up...",
  done: "✅ All done!",
  failed: "❌ Sorry, I couldn't complete this one.",
};

export function formatStatus(entry: TaskEntry, extra?: string): string {
  let msg = STATUS_MESSAGES[entry.status];
  if (entry.status === "queued" && extra) {
    msg = `⏳ Got it! You're #${extra} in line, I'll get to it soon.`;
  }
  if (entry.status === "repair" && extra) {
    msg = `🔄 Found some issues — retry ${extra}, fixing them up...`;
  }
  if (entry.status === "done" && entry.startedAt && entry.finishedAt) {
    const secs = ((entry.finishedAt - entry.startedAt) / 1000).toFixed(0);
    msg = `✅ All done! Took ${secs}s.`;
  }
  return msg;
}

export function createTaskQueue(send: SendFn): TaskQueue {
  const queue: TaskEntry[] = [];
  let active: TaskEntry | null = null;
  let nextId = 1;

  function notify(entry: TaskEntry, extra?: string) {
    send(formatStatus(entry, extra), true).catch(() => {});
  }

  return {
    enqueue(prompt: string): TaskEntry {
      const entry: TaskEntry = { id: nextId++, prompt, status: "queued" };
      if (!active) {
        active = entry;
        active.status = "running";
        active.startedAt = Date.now();
        notify(active);
      } else {
        queue.push(entry);
        notify(entry, `${queue.length}`);
      }
      return entry;
    },

    current: () => active,
    pending: () => [...queue],
    size: () => queue.length + (active ? 1 : 0),
    isLocked: () => active !== null,

    markRunning() {
      if (active) {
        active.status = "running";
        active.startedAt = active.startedAt || Date.now();
        notify(active);
      }
    },

    markVerifying() {
      if (active) {
        active.status = "verifying";
        notify(active);
      }
    },

    markRepair(attempt: number) {
      if (active) {
        active.status = "repair";
        notify(active, `${attempt}`);
      }
    },

    markDone() {
      if (active) {
        active.status = "done";
        active.finishedAt = Date.now();
        notify(active);
        active = null;
        // Promote next
        if (queue.length > 0) {
          active = queue.shift()!;
          active.status = "running";
          active.startedAt = Date.now();
          notify(active);
        }
      }
    },

    markFailed() {
      if (active) {
        active.status = "failed";
        active.finishedAt = Date.now();
        notify(active);
        active = null;
        if (queue.length > 0) {
          active = queue.shift()!;
          active.status = "running";
          active.startedAt = Date.now();
          notify(active);
        }
      }
    },

    drain() {
      queue.length = 0;
      active = null;
    },
  };
}
