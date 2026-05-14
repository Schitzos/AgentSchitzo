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
    expect(formatLogDate(d)).toBe("01/05/2025 09:03");
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
      plan: ["step1"],
      output: "done",
      logFilePath: logFile,
      now: new Date(2025, 5, 1, 12, 30),
    });
    const content = JSON.parse(fs.readFileSync(logFile, "utf8"));
    expect(content).toHaveLength(1);
    expect(content[0].plan).toBe("step1");
    expect(content[0].output).toBe("done");
    expect(content[0].date).toBe("06/01/2025 12:30");
  });

  it("appends to existing entries", async () => {
    const logFile = path.join(tmpDir, "log.json");
    fs.writeFileSync(logFile, JSON.stringify([{ date: "x", plan: "p", output: "o" }]));
    await appendTaskLog({ plan: "new", output: "out", logFilePath: logFile });
    const content = JSON.parse(fs.readFileSync(logFile, "utf8"));
    expect(content).toHaveLength(2);
  });

  it("uses default now parameter", async () => {
    const logFile = path.join(tmpDir, "defaults.json");
    await appendTaskLog({ plan: "p", output: "o", logFilePath: logFile });
    const content = JSON.parse(fs.readFileSync(logFile, "utf8"));
    expect(content[0].date).toMatch(/\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/);
  });

  it("uses default logFilePath when not provided", async () => {
    const defaultPath = resolveTaskLogPath();
    await appendTaskLog({ plan: "default-test", output: "ok" });
    const content = JSON.parse(fs.readFileSync(defaultPath, "utf8"));
    const entry = content.find((e: { plan: string }) => e.plan === "default-test");
    expect(entry).toBeDefined();
    // Clean up
    const filtered = content.filter((e: { plan: string }) => e.plan !== "default-test");
    if (filtered.length > 0) {
      fs.writeFileSync(defaultPath, JSON.stringify(filtered));
    } else {
      fs.unlinkSync(defaultPath);
    }
  });
});
