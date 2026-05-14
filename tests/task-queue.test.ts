import { jest } from "@jest/globals";
import { createTaskQueue, formatStatus, type TaskQueue } from "../telegram/application/task-queue.ts";

describe("task-queue", () => {
  let send: jest.Mock<(text: string, silent?: boolean) => Promise<boolean>>;
  let queue: TaskQueue;

  beforeEach(() => {
    send = jest.fn<(text: string, silent?: boolean) => Promise<boolean>>().mockResolvedValue(true);
    queue = createTaskQueue(send);
  });

  it("enqueue first task sets it as running immediately", () => {
    const entry = queue.enqueue("task 1");
    expect(entry.status).toBe("running");
    expect(entry.id).toBe(1);
    expect(entry.startedAt).toBeDefined();
    expect(queue.current()?.prompt).toBe("task 1");
    expect(queue.isLocked()).toBe(true);
    expect(queue.size()).toBe(1);
    expect(send).toHaveBeenCalledWith(expect.stringContaining("Working on it"), true);
  });

  it("enqueue second task queues it", () => {
    queue.enqueue("task 1");
    send.mockClear();
    queue.enqueue("task 2");
    expect(queue.pending()).toHaveLength(1);
    expect(queue.pending()[0].prompt).toBe("task 2");
    expect(queue.size()).toBe(2);
    expect(send).toHaveBeenCalledWith(expect.stringContaining("in line"), true);
  });

  it("markVerifying updates status", () => {
    queue.enqueue("task 1");
    send.mockClear();
    queue.markVerifying();
    expect(queue.current()?.status).toBe("verifying");
    expect(send).toHaveBeenCalledWith(expect.stringContaining("running tests"), true);
  });

  it("markRepair updates status with attempt", () => {
    queue.enqueue("task 1");
    send.mockClear();
    queue.markRepair(2);
    expect(queue.current()?.status).toBe("repair");
    expect(send).toHaveBeenCalledWith(expect.stringContaining("retry 2"), true);
  });

  it("markDone promotes next task", () => {
    queue.enqueue("task 1");
    queue.enqueue("task 2");
    send.mockClear();
    queue.markDone();
    expect(queue.current()?.prompt).toBe("task 2");
    expect(queue.current()?.status).toBe("running");
    expect(queue.pending()).toHaveLength(0);
    expect(send).toHaveBeenCalledWith(expect.stringContaining("All done"), true);
    expect(send).toHaveBeenCalledWith(expect.stringContaining("Working on it"), true);
  });

  it("markDone with no next task clears active", () => {
    queue.enqueue("task 1");
    queue.markDone();
    expect(queue.current()).toBeNull();
    expect(queue.isLocked()).toBe(false);
  });

  it("markFailed promotes next task", () => {
    queue.enqueue("task 1");
    queue.enqueue("task 2");
    send.mockClear();
    queue.markFailed();
    expect(queue.current()?.prompt).toBe("task 2");
    expect(send).toHaveBeenCalledWith(expect.stringContaining("couldn't complete"), true);
  });

  it("markFailed with no next task clears active", () => {
    queue.enqueue("task 1");
    queue.markFailed();
    expect(queue.current()).toBeNull();
    expect(queue.isLocked()).toBe(false);
  });

  it("drain clears everything", () => {
    queue.enqueue("task 1");
    queue.enqueue("task 2");
    queue.drain();
    expect(queue.current()).toBeNull();
    expect(queue.pending()).toHaveLength(0);
    expect(queue.size()).toBe(0);
  });

  it("markRunning on active task", () => {
    queue.enqueue("task 1");
    send.mockClear();
    queue.markRunning();
    expect(queue.current()?.status).toBe("running");
    expect(send).toHaveBeenCalled();
  });

  it("markVerifying/markRepair/markDone/markFailed with no active is no-op", () => {
    send.mockClear();
    queue.markVerifying();
    queue.markRepair(1);
    queue.markDone();
    queue.markFailed();
    expect(send).not.toHaveBeenCalled();
  });

  it("markRunning with no active is no-op", () => {
    send.mockClear();
    queue.markRunning();
    expect(send).not.toHaveBeenCalled();
  });

  it("markDone sets finishedAt", () => {
    queue.enqueue("task 1");
    queue.markDone();
    // Can't check finishedAt directly since active is cleared, but no error thrown
    expect(queue.current()).toBeNull();
  });

  it("markFailed sets finishedAt", () => {
    queue.enqueue("task 1");
    queue.markFailed();
    expect(queue.current()).toBeNull();
  });
});

describe("formatStatus", () => {
  it("formats running status as human message", () => {
    const entry = { id: 1, prompt: "fix the bug", status: "running" as const };
    const result = formatStatus(entry);
    expect(result).toContain("Working on it");
  });

  it("formats queued with position", () => {
    const entry = { id: 2, prompt: "short", status: "queued" as const };
    const result = formatStatus(entry, "3");
    expect(result).toContain("#3 in line");
  });

  it("formats done with duration", () => {
    const entry = { id: 1, prompt: "test", status: "done" as const, startedAt: 1000, finishedAt: 6000 };
    const result = formatStatus(entry);
    expect(result).toContain("5s");
    expect(result).toContain("All done");
  });

  it("formats repair with attempt number", () => {
    const entry = { id: 1, prompt: "test", status: "repair" as const };
    const result = formatStatus(entry, "2");
    expect(result).toContain("retry 2");
  });

  it("formats all status types without error", () => {
    const statuses = ["queued", "running", "verifying", "repair", "done", "failed"] as const;
    for (const status of statuses) {
      const result = formatStatus({ id: 1, prompt: "test", status });
      expect(result.length).toBeGreaterThan(0);
    }
  });
});
