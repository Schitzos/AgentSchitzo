import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { EventEmitter } from "events";

const spawnMock = jest.fn();
const existsSyncMock = jest.fn();
const readFileMock = jest.fn();
const unlinkMock = jest.fn();

jest.unstable_mockModule("child_process", () => ({
  spawn: spawnMock
}));

jest.unstable_mockModule("fs", () => ({
  existsSync: existsSyncMock,
  promises: {
    readFile: readFileMock,
    unlink: unlinkMock
  }
}));

const consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});
const processStdoutWriteSpy = jest.spyOn(process.stdout, "write").mockImplementation(() => true);
const processStderrWriteSpy = jest.spyOn(process.stderr, "write").mockImplementation(() => true);

const { runCodex } = await import("../../../models/code/codex.js");

function createChildProcessMock() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { end: jest.fn() };
  return child;
}

describe("runCodex", () => {
  const originalPlatform = process.platform;
  const originalPath = process.env.PATH;

  beforeEach(() => {
    spawnMock.mockReset();
    existsSyncMock.mockReset();
    readFileMock.mockReset();
    unlinkMock.mockReset();
    consoleLogSpy.mockClear();
    processStdoutWriteSpy.mockClear();
    processStderrWriteSpy.mockClear();
    unlinkMock.mockResolvedValue(undefined);
    Object.defineProperty(process, "platform", { value: originalPlatform });
    process.env.PATH = originalPath;
  });

  test("runs codex exec non-interactively and returns the last message", async () => {
    const prompt = 'generate tests for "quoted" input';
    const child = createChildProcessMock();

    existsSyncMock.mockImplementation((filePath) => filePath === "C:\\nvm4w\\nodejs\\codex.cmd");
    spawnMock.mockReturnValue(child);
    readFileMock.mockResolvedValue("Task executed by Codex");

    const resultPromise = runCodex(prompt);

    expect(consoleLogSpy).toHaveBeenNthCalledWith(1, "Running Codex...");
    expect(consoleLogSpy).toHaveBeenNthCalledWith(2, "codex prompt:", prompt);
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
    const [command, , options] = spawnMock.mock.calls[0];

    expect(command).toBe("codex");
    expect(options).toEqual({ shell: false, stdio: ["pipe", "pipe", "pipe"] });

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
    existsSyncMock.mockImplementation((filePath) => filePath === "C:\\tools\\codex.exe");
    spawnMock.mockReturnValue(child);
    readFileMock.mockRejectedValue(new Error("missing"));

    const resultPromise = runCodex("build");
    const [command, , options] = spawnMock.mock.calls[0];

    expect(command).toBe("C:\\tools\\codex.exe");
    expect(options).toEqual({ shell: false, stdio: ["pipe", "pipe", "pipe"] });

    child.stdout.emit("data", Buffer.from("from exe"));
    child.emit("close", 0);

    await expect(resultPromise).resolves.toEqual({
      success: true,
      output: "from exe"
    });
    expect(processStdoutWriteSpy).toHaveBeenCalled();
  });

  test("falls back to shell execution when PATH is unset on Windows", async () => {
    const child = createChildProcessMock();

    Object.defineProperty(process, "platform", { value: "win32" });
    delete process.env.PATH;
    spawnMock.mockReturnValue(child);
    readFileMock.mockResolvedValue("fallback");

    const resultPromise = runCodex("fallback");
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

  test("adds the dangerous bypass flag when approvals are temporarily granted", async () => {
    const child = createChildProcessMock();

    spawnMock.mockReturnValue(child);
    readFileMock.mockResolvedValue("bypassed");

    const resultPromise = runCodex("install package", {
      bypassApprovals: true
    });
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

    child.stderr.emit("data", Buffer.from("stderr text"));
    child.emit("error", new Error("codex failed"));
    child.emit("close", 0);

    await expect(resultPromise).resolves.toEqual({
      success: false,
      output: "codex failed"
    });
    expect(processStderrWriteSpy).toHaveBeenCalled();
  });
});
