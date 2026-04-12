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

  test("appends plan and output entries to a json log file", async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "task-log-"));
    const logFilePath = path.join(tempDir, "logs", "task-log.json");

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
      JSON.stringify(
        [
          {
            date: "11/14/2026 14:58",
            plan: "Write tests, Run verification",
            output: "Task executed by Codex"
          },
          {
            date: "11/14/2026 15:00",
            plan: "Write tests, Run verification",
            output: "Coverage increased to 91%"
          }
        ],
        null,
        2
      )
    );
  });

  test("defaults to <cwd>/logs/task-log.json", () => {
    expect(resolveTaskLogPath()).toBe(
      path.join(process.cwd(), "logs", "task-log.json")
    );
  });

  test("normalizes empty and multiline plan and output values", async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "task-log-"));
    const logFilePath = path.join(tempDir, "logs", "task-log.json");

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
      JSON.stringify(
        [
          {
            date: "11/14/2026 15:01",
            plan: "",
            output: "first line second line"
          },
          {
            date: "11/14/2026 15:02",
            plan: "step 1 , , step 2 next",
            output: ""
          }
        ],
        null,
        2
      )
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

      const content = await fs.readFile(
        path.join(tempDir, "logs", "task-log.json"),
        "utf8"
      );

      expect(content).toContain('"plan": "Ship it"');
      expect(content).toContain('"output": "Done"');
    } finally {
      process.chdir(originalCwd);
    }
  });

  test("treats an empty log file as having no existing entries", async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "task-log-"));
    const logFilePath = path.join(tempDir, "logs", "task-log.json");

    await fs.mkdir(path.dirname(logFilePath), { recursive: true });
    await fs.writeFile(logFilePath, "   \n", "utf8");

    await appendTaskLog({
      plan: "Bootstrap coverage",
      output: "First entry",
      logFilePath,
      now: new Date("2026-11-14T15:03:00")
    });

    await expect(fs.readFile(logFilePath, "utf8")).resolves.toBe(
      JSON.stringify(
        [
          {
            date: "11/14/2026 15:03",
            plan: "Bootstrap coverage",
            output: "First entry"
          }
        ],
        null,
        2
      )
    );
  });

  test("replaces non-array json content with a new entry list", async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "task-log-"));
    const logFilePath = path.join(tempDir, "logs", "task-log.json");

    await fs.mkdir(path.dirname(logFilePath), { recursive: true });
    await fs.writeFile(logFilePath, JSON.stringify({ stale: true }), "utf8");

    await appendTaskLog({
      plan: "Normalize state",
      output: "Recovered from invalid shape",
      logFilePath,
      now: new Date("2026-11-14T15:04:00")
    });

    await expect(fs.readFile(logFilePath, "utf8")).resolves.toBe(
      JSON.stringify(
        [
          {
            date: "11/14/2026 15:04",
            plan: "Normalize state",
            output: "Recovered from invalid shape"
          }
        ],
        null,
        2
      )
    );
  });

  test("propagates json parsing errors for malformed existing log files", async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "task-log-"));
    const logFilePath = path.join(tempDir, "logs", "task-log.json");

    await fs.mkdir(path.dirname(logFilePath), { recursive: true });
    await fs.writeFile(logFilePath, "{invalid json", "utf8");

    await expect(
      appendTaskLog({
        plan: "Should fail",
        output: "Bad input",
        logFilePath,
        now: new Date("2026-11-14T15:05:00")
      })
    ).rejects.toThrow(SyntaxError);
  });
});
