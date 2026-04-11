import { afterEach, describe, expect, test } from "@jest/globals";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import {
  appendTaskLog,
  resolveTaskLogPath
} from "../../../telegram/infrastructure/task-log.js";

describe("telegram/infrastructure/task-log", () => {
  let tempDir = null;

  afterEach(async () => {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  test("appends plan and output lines to a txt log file", async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "task-log-"));
    const logFilePath = path.join(tempDir, "logs", "task-log.txt");

    await appendTaskLog({
      plan: ["Write tests", "Run verification"],
      output: "Task executed by Codex",
      logFilePath,
      now: new Date("2026-11-14T14:58:00")
    });

    await appendTaskLog({
      plan: ["Write tests", "Run verification"],
      output: "Coverage increased to 91%",
      logFilePath,
      now: new Date("2026-11-14T15:00:00")
    });

    await expect(fs.readFile(logFilePath, "utf8")).resolves.toBe(
      [
        "date:11/14/2026 14:58",
        "plan:Write tests, Run verification",
        "output:Task executed by Codex",
        "",
        "date:11/14/2026 15:00",
        "plan:Write tests, Run verification",
        "output:Coverage increased to 91%",
        "",
        ""
      ].join("\n")
    );
  });

  test("defaults to <cwd>/logs/task-log.txt", () => {
    expect(resolveTaskLogPath()).toBe(path.join(process.cwd(), "logs", "task-log.txt"));
  });

  test("normalizes empty and multiline plan and output values", async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "task-log-"));
    const logFilePath = path.join(tempDir, "logs", "task-log.txt");

    await appendTaskLog({
      plan: null,
      output: "first line\n\nsecond line",
      logFilePath,
      now: new Date("2026-11-14T15:01:00")
    });

    await appendTaskLog({
      plan: ["  step 1  ", "", "step 2\nnext"],
      output: null,
      logFilePath,
      now: new Date("2026-11-14T15:02:00")
    });

    await expect(fs.readFile(logFilePath, "utf8")).resolves.toBe(
      [
        "date:11/14/2026 15:01",
        "plan:",
        "output:first line second line",
        "",
        "date:11/14/2026 15:02",
        "plan:step 1 , , step 2 next",
        "output:",
        "",
        ""
      ].join("\n")
    );
  });

  test("uses the default log path and current date when not provided", async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "task-log-"));
    const originalCwd = process.cwd();

    process.chdir(tempDir);

    try {
      await appendTaskLog({
        plan: "Ship it",
        output: "Done"
      });

      const content = await fs.readFile(path.join(tempDir, "logs", "task-log.txt"), "utf8");

      expect(content).toContain("plan:Ship it");
      expect(content).toContain("output:Done");
    } finally {
      process.chdir(originalCwd);
    }
  });
});
