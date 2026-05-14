import { jest } from "@jest/globals";
import fs from "fs";
import path from "path";
import os from "os";
import {
  resolveTaskLogPath,
  normalizeText,
  normalizePlan,
  formatLogDate,
  readTaskLogEntries,
  appendTaskLog,
  searchTaskLog,
} from "../telegram/infrastructure/task-log.ts";

describe("resolveTaskLogPath", () => {
  it("returns logs/task-log.json in cwd", () => {
    expect(resolveTaskLogPath()).toBe(path.join(process.cwd(), "logs", "task-log.json"));
  });
});

describe("normalizeText", () => {
  it("collapses whitespace and newlines", () => {
    expect(normalizeText("hello\n\nworld  foo")).toBe("hello world foo");
  });

  it("handles null/undefined", () => {
    expect(normalizeText(null)).toBe("");
    expect(normalizeText(undefined)).toBe("");
  });

  it("trims result", () => {
    expect(normalizeText("  hi  ")).toBe("hi");
  });
});

describe("normalizePlan", () => {
  it("joins array", () => {
    expect(normalizePlan(["a", "b"])).toBe("a, b");
  });

  it("handles string", () => {
    expect(normalizePlan("single")).toBe("single");
  });

  it("handles null", () => {
    expect(normalizePlan(null)).toBe("");
  });
});

describe("formatLogDate", () => {
  it("formats date correctly", () => {
    const d = new Date(2025, 0, 5, 9, 3); // Jan 5, 2025 09:03
    expect(formatLogDate(d)).toBe("05 Jan 2025");
  });
});

describe("readTaskLogEntries", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tasklog-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it("returns empty array for missing file", async () => {
    const result = await readTaskLogEntries(path.join(tmpDir, "nope.json"));
    expect(result).toEqual([]);
  });

  it("returns empty array for empty file", async () => {
    const f = path.join(tmpDir, "empty.json");
    fs.writeFileSync(f, "  ");
    expect(await readTaskLogEntries(f)).toEqual([]);
  });

  it("returns entries from valid JSON array", async () => {
    const f = path.join(tmpDir, "log.json");
    fs.writeFileSync(f, JSON.stringify([{ a: 1 }]));
    expect(await readTaskLogEntries(f)).toEqual([{ a: 1 }]);
  });

  it("returns empty array for non-array JSON", async () => {
    const f = path.join(tmpDir, "obj.json");
    fs.writeFileSync(f, JSON.stringify({ a: 1 }));
    expect(await readTaskLogEntries(f)).toEqual([]);
  });

  it("throws on invalid JSON (not ENOENT)", async () => {
    const f = path.join(tmpDir, "bad.json");
    fs.writeFileSync(f, "not json{{{");
    await expect(readTaskLogEntries(f)).rejects.toThrow();
  });
});

describe("appendTaskLog", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tasklog-append-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it("creates file and appends entry", async () => {
    const logFile = path.join(tmpDir, "sub", "log.json");
    await appendTaskLog({
      prompt: "fix bug",
      plan: ["step1"],
      output: "done",
      logFilePath: logFile,
      now: new Date(2025, 5, 1, 12, 30),
    });
    const content = JSON.parse(fs.readFileSync(logFile, "utf8"));
    expect(content).toHaveLength(1);
    expect(content[0].plan).toBe("step1");
    expect(content[0].output).toBe("done");
    expect(content[0].prompt).toBe("fix bug");
    expect(content[0].timestamp).toBeDefined();
    expect(content[0].status).toBe("done");
  });

  it("appends to existing entries", async () => {
    const logFile = path.join(tmpDir, "log.json");
    fs.writeFileSync(logFile, JSON.stringify([{ id: 1, timestamp: "x", prompt: "old", plan: "p", output: "o", status: "done", filesChanged: [], testsPassed: null, durationMs: 0 }]));
    await appendTaskLog({ prompt: "new prompt", plan: "new", output: "out", logFilePath: logFile });
    const content = JSON.parse(fs.readFileSync(logFile, "utf8"));
    expect(content).toHaveLength(2);
  });

  it("uses default now parameter", async () => {
    const logFile = path.join(tmpDir, "defaults.json");
    await appendTaskLog({ prompt: "test", plan: "p", output: "o", logFilePath: logFile });
    const content = JSON.parse(fs.readFileSync(logFile, "utf8"));
    expect(content[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("uses default logFilePath when not provided", async () => {
    const defaultPath = resolveTaskLogPath();
    await appendTaskLog({ prompt: "default-test", plan: "default-test", output: "ok" });
    const content = JSON.parse(fs.readFileSync(defaultPath, "utf8"));
    const entry = content.find((e: { prompt: string }) => e.prompt === "default-test");
    expect(entry).toBeDefined();
    // Clean up
    const filtered = content.filter((e: { prompt: string }) => e.prompt !== "default-test");
    if (filtered.length > 0) {
      fs.writeFileSync(defaultPath, JSON.stringify(filtered));
    } else {
      fs.unlinkSync(defaultPath);
    }
  });
});

describe("searchTaskLog", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tasklog-search-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it("returns last N entries when no query", async () => {
    const logFile = path.join(tmpDir, "log.json");
    const entries = Array.from({ length: 10 }, (_, i) => ({
      id: i + 1, timestamp: new Date().toISOString(), prompt: `task ${i}`,
      plan: "plan", output: "out", status: "done", filesChanged: [], testsPassed: true, durationMs: 100,
    }));
    fs.writeFileSync(logFile, JSON.stringify(entries));
    const results = await searchTaskLog("", logFile, 3);
    expect(results).toHaveLength(3);
    expect(results[0].id).toBe(8);
  });

  it("filters by query in prompt", async () => {
    const logFile = path.join(tmpDir, "log.json");
    const entries = [
      { id: 1, timestamp: "", prompt: "fix auth bug", plan: "", output: "", status: "done", filesChanged: [], testsPassed: true, durationMs: 0 },
      { id: 2, timestamp: "", prompt: "add feature", plan: "", output: "", status: "done", filesChanged: [], testsPassed: true, durationMs: 0 },
    ];
    fs.writeFileSync(logFile, JSON.stringify(entries));
    const results = await searchTaskLog("auth", logFile);
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe(1);
  });

  it("returns empty for non-existent file", async () => {
    const results = await searchTaskLog("", path.join(tmpDir, "nope.json"));
    expect(results).toHaveLength(0);
  });
});
