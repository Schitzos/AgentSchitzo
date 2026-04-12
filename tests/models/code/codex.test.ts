// @ts-nocheck
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { EventEmitter } from "events";

const spawnMock = jest.fn();
const execFileMock = jest.fn();
const existsSyncMock = jest.fn();
const mkdirMock = jest.fn();
const readFileMock = jest.fn();
const unlinkMock = jest.fn();

jest.unstable_mockModule("child_process", () => ({
  execFile: execFileMock,
  spawn: spawnMock
}));

jest.unstable_mockModule("fs", () => ({
  existsSync: existsSyncMock,
  promises: {
    mkdir: mkdirMock,
    readFile: readFileMock,
    unlink: unlinkMock
  }
}));

const consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});

const { isCodexRunning, runCodex } = await import(
  "../../../models/code/codex.js"
);

function createChildProcessMock() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { end: jest.fn() };
  return child;
}

async function flushAsyncSetup() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("runCodex", () => {
  const originalPlatform = process.platform;
  const originalPath = process.env.PATH;
  const originalHome = process.env.HOME;

  beforeEach(() => {
    spawnMock.mockReset();
    execFileMock.mockReset();
    existsSyncMock.mockReset();
    mkdirMock.mockReset();
    readFileMock.mockReset();
    unlinkMock.mockReset();
    consoleLogSpy.mockClear();
    mkdirMock.mockResolvedValue(undefined);
    unlinkMock.mockResolvedValue(undefined);
    Object.defineProperty(process, "platform", { value: originalPlatform });
    process.env.PATH = originalPath;
    process.env.HOME = originalHome;
  });

  test("runs codex exec non-interactively and returns the last message", async () => {
    const prompt = 'generate tests for "quoted" input';
    const child = createChildProcessMock();

    existsSyncMock.mockImplementation(
      (filePath) => filePath === "C:\\nvm4w\\nodejs\\codex.cmd"
    );
    spawnMock.mockReturnValue(child);
    readFileMock.mockResolvedValue("Task executed by Codex");

    const resultPromise = runCodex(prompt);

    await flushAsyncSetup();
    expect(consoleLogSpy).toHaveBeenNthCalledWith(1, "Running Codex...");
    expect(spawnMock).toHaveBeenCalledTimes(1);

    const [command, args, options] = spawnMock.mock.calls[0];
    expect(command).toBe("C:\\nvm4w\\nodejs\\codex.cmd");
    expect(args.slice(0, 5)).toEqual([
      "exec",
      "--full-auto",
      "--skip-git-repo-check",
      "--output-last-message",
      expect.any(String)
    ]);
    expect(args[5]).toBe("-");
    expect(options).toEqual({ shell: true, stdio: ["pipe", "pipe", "pipe"] });
    expect(child.stdin.end).toHaveBeenCalledWith(prompt);
    expect(mkdirMock).toHaveBeenCalledTimes(1);

    child.emit("close", 0);

    await expect(resultPromise).resolves.toEqual({
      success: true,
      output: "Task executed by Codex"
    });
    expect(unlinkMock).toHaveBeenCalledTimes(1);
  });

  test("falls back to combined output when no last-message file is available", async () => {
    const child = createChildProcessMock();

    spawnMock.mockReturnValue(child);
    readFileMock.mockRejectedValue(new Error("missing"));

    const resultPromise = runCodex("fix bug");
    await flushAsyncSetup();

    child.stdout.emit("data", Buffer.from("stdout text"));
    child.stderr.emit("data", Buffer.from(" stderr text"));
    child.emit("close", 1);

    await expect(resultPromise).resolves.toEqual({
      success: false,
      output: "stdout text stderr text"
    });
  });

  test("resolves with the spawn error message", async () => {
    const child = createChildProcessMock();

    spawnMock.mockReturnValue(child);

    const resultPromise = runCodex("fix bug");
    await flushAsyncSetup();

    child.emit("error", new Error("codex failed"));

    await expect(resultPromise).resolves.toEqual({
      success: false,
      output: "codex failed"
    });
  });

  test("uses the bare codex command on non-Windows platforms", async () => {
    const child = createChildProcessMock();

    Object.defineProperty(process, "platform", { value: "linux" });
    spawnMock.mockReturnValue(child);
    readFileMock.mockResolvedValue("done");

    const resultPromise = runCodex("ship it");
    await flushAsyncSetup();
    const [command, , options] = spawnMock.mock.calls[0];

    expect(command).toBe("codex");
    expect(options).toEqual({ shell: false, stdio: ["pipe", "pipe", "pipe"] });

    child.emit("close", 0);

    await expect(resultPromise).resolves.toEqual({
      success: true,
      output: "done"
    });
  });

  test("resolves codex from PATH on macOS without shell execution", async () => {
    const child = createChildProcessMock();

    Object.defineProperty(process, "platform", { value: "darwin" });
    process.env.PATH = "/Users/test/.local/bin:/usr/bin";
    existsSyncMock.mockImplementation(
      (filePath) => filePath === "/Users/test/.local/bin/codex"
    );
    spawnMock.mockReturnValue(child);
    readFileMock.mockResolvedValue("done");

    const resultPromise = runCodex("ship it");
    await flushAsyncSetup();
    const [command, , options] = spawnMock.mock.calls[0];

    expect(command).toBe("/Users/test/.local/bin/codex");
    expect(options).toEqual({ shell: false, stdio: ["pipe", "pipe", "pipe"] });

    child.emit("close", 0);

    await expect(resultPromise).resolves.toEqual({
      success: true,
      output: "done"
    });
  });

  test("falls back to common macOS install directories when PATH is missing codex", async () => {
    const child = createChildProcessMock();

    Object.defineProperty(process, "platform", { value: "darwin" });
    process.env.PATH = "/usr/bin";
    process.env.HOME = "/Users/test";
    existsSyncMock.mockImplementation(
      (filePath) => filePath === "/opt/homebrew/bin/codex"
    );
    spawnMock.mockReturnValue(child);
    readFileMock.mockResolvedValue("done");

    const resultPromise = runCodex("ship it");
    await flushAsyncSetup();
    const [command, , options] = spawnMock.mock.calls[0];

    expect(command).toBe("/opt/homebrew/bin/codex");
    expect(options).toEqual({ shell: false, stdio: ["pipe", "pipe", "pipe"] });

    child.emit("close", 0);

    await expect(resultPromise).resolves.toEqual({
      success: true,
      output: "done"
    });
  });

  test("checks only shared macOS fallback directories when HOME is unavailable", async () => {
    const child = createChildProcessMock();

    Object.defineProperty(process, "platform", { value: "darwin" });
    process.env.PATH = "/usr/bin";
    delete process.env.HOME;
    existsSyncMock.mockImplementation(
      (filePath) => filePath === "/usr/local/bin/codex"
    );
    spawnMock.mockReturnValue(child);
    readFileMock.mockResolvedValue("done");

    const resultPromise = runCodex("ship it");
    await flushAsyncSetup();

    expect(existsSyncMock).toHaveBeenCalledWith("/opt/homebrew/bin/codex");
    expect(existsSyncMock).toHaveBeenCalledWith("/usr/local/bin/codex");
    expect(existsSyncMock).toHaveBeenCalledTimes(3);

    child.emit("close", 0);

    await expect(resultPromise).resolves.toEqual({
      success: true,
      output: "done"
    });
  });

  test("prefers codex.exe when codex.cmd is unavailable and ignores empty PATH entries", async () => {
    const child = createChildProcessMock();

    Object.defineProperty(process, "platform", { value: "win32" });
    process.env.PATH = ";C:\\tools";
    existsSyncMock.mockImplementation(
      (filePath) => filePath === "C:\\tools\\codex.exe"
    );
    spawnMock.mockReturnValue(child);
    readFileMock.mockRejectedValue(new Error("missing"));

    const resultPromise = runCodex("build");
    await flushAsyncSetup();
    const [command, , options] = spawnMock.mock.calls[0];

    expect(command).toBe("C:\\tools\\codex.exe");
    expect(options).toEqual({ shell: false, stdio: ["pipe", "pipe", "pipe"] });

    child.stdout.emit("data", Buffer.from("from exe"));
    child.emit("close", 0);

    await expect(resultPromise).resolves.toEqual({
      success: true,
      output: "from exe"
    });
  });

  test("falls back to shell execution when PATH is unset on Windows", async () => {
    const child = createChildProcessMock();

    Object.defineProperty(process, "platform", { value: "win32" });
    delete process.env.PATH;
    spawnMock.mockReturnValue(child);
    readFileMock.mockResolvedValue("fallback");

    const resultPromise = runCodex("fallback");
    await flushAsyncSetup();
    const [command, , options] = spawnMock.mock.calls[0];

    expect(command).toBe("codex");
    expect(options).toEqual({ shell: true, stdio: ["pipe", "pipe", "pipe"] });

    child.emit("close", 0);

    await expect(resultPromise).resolves.toEqual({
      success: true,
      output: "fallback"
    });
    expect(process.env.PATH).toBeUndefined();
  });

  test("skips duplicate PATH entries when resolving the codex executable", async () => {
    const child = createChildProcessMock();

    Object.defineProperty(process, "platform", { value: "linux" });
    process.env.PATH = "/usr/local/bin:/usr/local/bin:/opt/bin";
    existsSyncMock.mockImplementation(
      (filePath) => filePath === "/opt/bin/codex"
    );
    spawnMock.mockReturnValue(child);
    readFileMock.mockResolvedValue("done");

    const resultPromise = runCodex("ship it");
    await flushAsyncSetup();

    expect(existsSyncMock).toHaveBeenCalledTimes(2);
    expect(existsSyncMock).toHaveBeenCalledWith("/usr/local/bin/codex");
    expect(existsSyncMock).toHaveBeenCalledWith("/opt/bin/codex");

    child.emit("close", 0);

    await expect(resultPromise).resolves.toEqual({
      success: true,
      output: "done"
    });
  });

  test("adds the dangerous bypass flag when approvals are temporarily granted", async () => {
    const child = createChildProcessMock();

    spawnMock.mockReturnValue(child);
    readFileMock.mockResolvedValue("bypassed");

    const resultPromise = runCodex("install package", {
      bypassApprovals: true
    });
    await flushAsyncSetup();
    const [, args] = spawnMock.mock.calls[0];

    expect(args).toContain("--dangerously-bypass-approvals-and-sandbox");
    expect(args).not.toContain("--full-auto");

    child.emit("close", 0);

    await expect(resultPromise).resolves.toEqual({
      success: true,
      output: "bypassed"
    });
  });

  test("ignores close events after the promise is already settled by an error", async () => {
    const child = createChildProcessMock();

    spawnMock.mockReturnValue(child);
    readFileMock.mockResolvedValue("ignored");

    const resultPromise = runCodex("fix bug");
    await flushAsyncSetup();

    child.stderr.emit("data", Buffer.from("stderr text"));
    child.emit("error", new Error("codex failed"));
    child.emit("close", 0);

    await expect(resultPromise).resolves.toEqual({
      success: false,
      output: "codex failed"
    });
  });

  test("returns a failure result when the logs directory cannot be created", async () => {
    mkdirMock.mockRejectedValue(new Error("mkdir blocked"));

    await expect(runCodex("fix bug")).resolves.toEqual({
      success: false,
      output: "mkdir blocked"
    });
    expect(spawnMock).not.toHaveBeenCalled();
  });

  test("reports codex as running when the local runner currently has an active process", async () => {
    const child = createChildProcessMock();

    spawnMock.mockReturnValue(child);
    readFileMock.mockResolvedValue("done");

    const resultPromise = runCodex("ship it");
    await flushAsyncSetup();

    await expect(isCodexRunning()).resolves.toBe(true);

    child.emit("close", 0);
    await resultPromise;
  });

  test("checks the OS process list when no local codex run is active", async () => {
    execFileMock.mockImplementation((command, args, callback) => {
      callback(null, '"codex.exe","123","Console","1","10,000 K"');
    });

    await expect(isCodexRunning()).resolves.toBe(true);
    expect(execFileMock).toHaveBeenCalledWith(
      "tasklist",
      ["/FO", "CSV"],
      expect.any(Function)
    );
  });

  test("checks the non-Windows process list and returns false when codex is absent", async () => {
    Object.defineProperty(process, "platform", { value: "linux" });
    execFileMock.mockImplementation((command, args, callback) => {
      callback(null, "node\nbash\n");
    });

    await expect(isCodexRunning()).resolves.toBe(false);
    expect(execFileMock).toHaveBeenCalledWith(
      "ps",
      ["-A", "-o", "comm="],
      expect.any(Function)
    );
  });

  test("treats a missing process-list stdout value as not running", async () => {
    Object.defineProperty(process, "platform", { value: "linux" });
    execFileMock.mockImplementation((command, args, callback) => {
      callback(null);
    });

    await expect(isCodexRunning()).resolves.toBe(false);
  });

  test("treats process list lookup errors as not running", async () => {
    execFileMock.mockImplementation((command, args, callback) => {
      callback(new Error("tasklist failed"));
    });

    await expect(isCodexRunning()).resolves.toBe(false);
  });
});
