// @ts-nocheck
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { EventEmitter } from "events";

const spawnMock = jest.fn();
const execFileMock = jest.fn();
const existsSyncMock = jest.fn();
const mkdirMock = jest.fn();
const readFileMock = jest.fn();
const unlinkMock = jest.fn();
const writeFileMock = jest.fn();

jest.unstable_mockModule("child_process", () => ({
  execFile: execFileMock,
  spawn: spawnMock
}));

jest.unstable_mockModule("fs", () => ({
  existsSync: existsSyncMock,
  promises: {
    mkdir: mkdirMock,
    readFile: readFileMock,
    unlink: unlinkMock,
    writeFile: writeFileMock
  }
}));

const consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});
const stdoutWriteSpy = jest
  .spyOn(process.stdout, "write")
  .mockImplementation(() => true);
const stderrWriteSpy = jest
  .spyOn(process.stderr, "write")
  .mockImplementation(() => true);

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
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
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
    writeFileMock.mockReset();
    consoleLogSpy.mockClear();
    stdoutWriteSpy.mockClear();
    stderrWriteSpy.mockClear();
    execFileMock.mockImplementation((command, args, options, callback) => {
      const resolvedCallback =
        typeof options === "function" ? options : callback;
      resolvedCallback(null, "");
    });
    mkdirMock.mockResolvedValue(undefined);
    unlinkMock.mockResolvedValue(undefined);
    writeFileMock.mockResolvedValue(undefined);
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
    readFileMock
      .mockResolvedValueOnce(Buffer.from("before"))
      .mockResolvedValueOnce(Buffer.from("after"))
      .mockResolvedValueOnce("Task executed by Codex");
    execFileMock.mockImplementation((command, args, options, callback) => {
      callback(null, "models/code/codex.ts\0");
    });

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
    expect(writeFileMock).toHaveBeenCalledWith(
      expect.stringMatching(/logs[\\/]+last-codex-run\.json$/),
      JSON.stringify({ changedFiles: ["models/code/codex.ts"] }, null, 2),
      "utf8"
    );
  });

  test("falls back to combined output when no last-message file is available", async () => {
    const child = createChildProcessMock();

    spawnMock.mockReturnValue(child);
    readFileMock
      .mockResolvedValueOnce(Buffer.from("same"))
      .mockResolvedValueOnce(Buffer.from("same"))
      .mockRejectedValueOnce(new Error("missing"));
    execFileMock.mockImplementation((command, args, options, callback) => {
      callback(null, "models/code/codex.ts\0");
    });

    const resultPromise = runCodex("fix bug");
    await flushAsyncSetup();

    child.stdout.emit("data", Buffer.from("stdout text"));
    child.stderr.emit("data", Buffer.from(" stderr text"));
    child.emit("close", 1);

    await expect(resultPromise).resolves.toEqual({
      success: false,
      output: "stdout text stderr text"
    });
    expect(stdoutWriteSpy).toHaveBeenCalledWith(Buffer.from("stdout text"));
    expect(stderrWriteSpy).toHaveBeenCalledWith(Buffer.from(" stderr text"));
  });

  test("stringifies a non-string last-message payload before returning it", async () => {
    const child = createChildProcessMock();

    spawnMock.mockReturnValue(child);
    readFileMock
      .mockResolvedValueOnce(Buffer.from("same"))
      .mockResolvedValueOnce(Buffer.from("same"))
      .mockResolvedValueOnce(Buffer.from("buffer output"));
    execFileMock.mockImplementation((command, args, options, callback) => {
      callback(null, "models/code/codex.ts\0");
    });

    const resultPromise = runCodex("ship it");
    await flushAsyncSetup();

    child.emit("close", 0);

    await expect(resultPromise).resolves.toEqual({
      success: true,
      output: "buffer output"
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
    readFileMock
      .mockResolvedValueOnce(Buffer.from("same"))
      .mockResolvedValueOnce(Buffer.from("same"))
      .mockResolvedValueOnce("bypassed");
    execFileMock.mockImplementation((command, args, options, callback) => {
      callback(null, "models/code/codex.ts\0");
    });

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

  test("adds an extra writable directory when a sandboxed approval grants drive access", async () => {
    const child = createChildProcessMock();

    spawnMock.mockReturnValue(child);
    readFileMock
      .mockResolvedValueOnce(Buffer.from("same"))
      .mockResolvedValueOnce(Buffer.from("same"))
      .mockResolvedValueOnce("sandboxed");
    execFileMock.mockImplementation((command, args, options, callback) => {
      callback(null, "models/code/codex.ts\0");
    });

    const resultPromise = runCodex("clean E drive folder", {
      additionalWritableRoots: ["E:\\"]
    });
    await flushAsyncSetup();
    const [, args] = spawnMock.mock.calls[0];

    expect(args).toContain("--full-auto");
    expect(args).toContain("--add-dir");
    expect(args).toContain("E:\\");
    expect(args).not.toContain("--dangerously-bypass-approvals-and-sandbox");

    child.emit("close", 0);

    await expect(resultPromise).resolves.toEqual({
      success: true,
      output: "sandboxed"
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

  test("continues when the workspace snapshot cannot be listed before Codex starts", async () => {
    const child = createChildProcessMock();

    spawnMock.mockReturnValue(child);
    execFileMock.mockImplementation((command, args, options, callback) => {
      callback(new Error("git failed"));
    });
    readFileMock.mockResolvedValue("done");

    const resultPromise = runCodex("ship it");
    await flushAsyncSetup();

    child.emit("close", 0);

    await expect(resultPromise).resolves.toEqual({
      success: true,
      output: "done"
    });
    expect(writeFileMock).toHaveBeenCalledWith(
      expect.stringMatching(/logs[\\/]+last-codex-run\.json$/),
      JSON.stringify({ changedFiles: [] }, null, 2),
      "utf8"
    );
  });

  test("tracks unreadable repository files as null in workspace snapshots", async () => {
    const child = createChildProcessMock();

    spawnMock.mockReturnValue(child);
    execFileMock.mockImplementation((command, args, options, callback) => {
      callback(null, "missing-file.ts\0");
    });
    readFileMock
      .mockRejectedValueOnce(new Error("missing file"))
      .mockRejectedValueOnce(new Error("missing file"))
      .mockResolvedValueOnce("done");

    const resultPromise = runCodex("ship it");
    await flushAsyncSetup();

    child.emit("close", 0);

    await expect(resultPromise).resolves.toEqual({
      success: true,
      output: "done"
    });
    expect(writeFileMock).toHaveBeenCalledWith(
      expect.stringMatching(/logs[\\/]+last-codex-run\.json$/),
      JSON.stringify({ changedFiles: [] }, null, 2),
      "utf8"
    );
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

  test("continues when it cannot persist the latest changed-file manifest", async () => {
    const child = createChildProcessMock();

    spawnMock.mockReturnValue(child);
    readFileMock
      .mockResolvedValueOnce(Buffer.from("before"))
      .mockResolvedValueOnce(Buffer.from("after"))
      .mockResolvedValueOnce("done");
    writeFileMock.mockRejectedValue(new Error("disk full"));
    execFileMock.mockImplementation((command, args, options, callback) => {
      callback(null, "models/code/codex.ts\0");
    });

    const resultPromise = runCodex("ship it");
    await flushAsyncSetup();

    child.emit("close", 0);

    await expect(resultPromise).resolves.toEqual({
      success: true,
      output: "done"
    });
  });
});
