import { afterEach, describe, expect, test } from "@jest/globals";
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
      plan: ["Install the package"]
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
});
