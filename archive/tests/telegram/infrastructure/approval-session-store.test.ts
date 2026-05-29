import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { promises as fs } from "fs";
import path from "path";
import {
  createApprovalSessionStore,
  resolveApprovalSessionPath
} from "../../../telegram/infrastructure/approval-session-store.js";

describe("telegram/infrastructure/approval-session-store", () => {
  const sessionFilePath = path.join(
    process.cwd(),
    "logs",
    "approval-session-store.test.json"
  );

  afterEach(async () => {
    await fs.unlink(sessionFilePath).catch(() => {});
  });

  test("uses the logs directory for the default approval-session path", () => {
    expect(resolveApprovalSessionPath()).toBe(
      path.join(process.cwd(), "logs", "pending-approval.json")
    );
  });

  test("persists a pending approval session across store instances", async () => {
    const initialStore = createApprovalSessionStore({ sessionFilePath });
    const savedSession = {
      command: "install a new lib",
      prompt: "codex prompt",
      permission: {
        action: "install dependencies",
        reason:
          "The task needs to add or install packages, which changes project dependencies."
      },
      plan: ["Install the package"],
      runOptions: {
        additionalWritableRoots: ["E:\\"]
      }
    };

    await initialStore.set(savedSession);

    const reloadedStore = createApprovalSessionStore({ sessionFilePath });

    await expect(reloadedStore.get()).resolves.toEqual(savedSession);
    await expect(reloadedStore.clear()).resolves.toEqual(savedSession);
    await expect(reloadedStore.get()).resolves.toBeNull();
  });

  test("ignores invalid persisted approval sessions", async () => {
    await fs.mkdir(path.dirname(sessionFilePath), { recursive: true });
    await fs.writeFile(
      sessionFilePath,
      JSON.stringify({
        command: "install a new lib",
        prompt: "codex prompt",
        permission: {},
        plan: "not-an-array"
      }),
      "utf8"
    );

    const store = createApprovalSessionStore({ sessionFilePath });

    await expect(store.get()).resolves.toBeNull();
  });

  test("accepts persisted approval sessions that only use bypass approvals", async () => {
    const savedSession = {
      command: "install a new lib",
      prompt: "codex prompt",
      permission: {
        action: "install dependencies",
        reason: "reason"
      },
      plan: ["Install the package"],
      runOptions: {
        bypassApprovals: true
      }
    };

    await fs.mkdir(path.dirname(sessionFilePath), { recursive: true });
    await fs.writeFile(sessionFilePath, JSON.stringify(savedSession), "utf8");

    const store = createApprovalSessionStore({ sessionFilePath });

    await expect(store.get()).resolves.toEqual(savedSession);
  });

  test("ignores persisted approval sessions with invalid run options", async () => {
    await fs.mkdir(path.dirname(sessionFilePath), { recursive: true });
    await fs.writeFile(
      sessionFilePath,
      JSON.stringify({
        command: "delete E:\\temp\\old.txt",
        prompt: "codex prompt",
        permission: {
          action: "access drive E:\\",
          reason: "reason"
        },
        plan: ["Delete the file"],
        runOptions: {
          additionalWritableRoots: "E:\\"
        }
      }),
      "utf8"
    );

    const store = createApprovalSessionStore({ sessionFilePath });

    await expect(store.get()).resolves.toBeNull();
  });

  test("ignores persisted approval sessions with a non-boolean bypass flag", async () => {
    await fs.mkdir(path.dirname(sessionFilePath), { recursive: true });
    await fs.writeFile(
      sessionFilePath,
      JSON.stringify({
        command: "install a new lib",
        prompt: "codex prompt",
        permission: {
          action: "install dependencies",
          reason: "reason"
        },
        plan: ["Install the package"],
        runOptions: {
          bypassApprovals: "yes"
        }
      }),
      "utf8"
    );

    const store = createApprovalSessionStore({ sessionFilePath });

    await expect(store.get()).resolves.toBeNull();
  });

  test("caches the loaded session state after the first read", async () => {
    const store = createApprovalSessionStore({ sessionFilePath });

    await expect(store.get()).resolves.toBeNull();

    const savedSession = {
      command: "install a new lib",
      prompt: "codex prompt",
      permission: {
        action: "install dependencies",
        reason: "reason"
      },
      plan: ["Install the package"]
    };

    await fs.mkdir(path.dirname(sessionFilePath), { recursive: true });
    await fs.writeFile(sessionFilePath, JSON.stringify(savedSession), "utf8");

    await expect(store.get()).resolves.toBeNull();
  });

  test("clears the in-memory session even if the persisted file is already missing", async () => {
    const savedSession = {
      command: "install a new lib",
      prompt: "codex prompt",
      permission: {
        action: "install dependencies",
        reason: "reason"
      },
      plan: ["Install the package"]
    };
    const fileSystem = {
      readFile: async () => JSON.stringify(savedSession),
      mkdir: jest.fn(),
      writeFile: jest.fn(),
      unlink: jest.fn(async () => {
        throw new Error("missing");
      })
    } as unknown as typeof fs;
    const store = createApprovalSessionStore({
      sessionFilePath,
      fileSystem
    });

    await expect(store.clear()).resolves.toEqual(savedSession);
    await expect(store.get()).resolves.toBeNull();
    expect(fileSystem.unlink).toHaveBeenCalledWith(sessionFilePath);
  });
});
