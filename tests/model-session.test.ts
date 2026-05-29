import { jest } from "@jest/globals";
import { EventEmitter } from "events";

// Mock child_process
const mockProc = () => {
  const proc = Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    stdin: { write: jest.fn() },
    kill: jest.fn(),
    pid: 1234,
  });
  return proc;
};

let spawnedProc: ReturnType<typeof mockProc>;

jest.unstable_mockModule("child_process", () => ({
  spawn: jest.fn(() => {
    spawnedProc = mockProc();
    return spawnedProc;
  }),
}));

const { createModelSession } = await import("../session/model-session.ts");

describe("createModelSession", () => {
  const adapter = {
    name: "test-adapter",
    command: "test-cmd",
    buildArgs: (_cwd: string) => ["--flag"],
    detectLoginUrl: (output: string) => {
      const m = output.match(/https:\/\/login\.\S+/);
      return m?.[0] ?? null;
    },
  };

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("starts in idle state", () => {
    const session = createModelSession({ adapter, cwd: "/tmp" });
    session.start();
    expect(session.state()).toBe("idle");
    expect(session.adapterName()).toBe("test-adapter");
  });

  it("transitions to processing on write", () => {
    const session = createModelSession({ adapter, cwd: "/tmp", debounceMs: 50 });
    session.start();
    session.write("hello");
    expect(session.state()).toBe("processing");
  });

  it("calls output callback when stdout emits data", () => {
    const session = createModelSession({ adapter, cwd: "/tmp", debounceMs: 50 });
    const outputCb = jest.fn();
    session.onOutput(outputCb);
    session.start();
    session.write("hello");

    spawnedProc.stdout.emit("data", Buffer.from("response text"));
    jest.advanceTimersByTime(50);

    expect(outputCb).toHaveBeenCalledWith("response text");
  });

  it("detects login URL from stdout", () => {
    const session = createModelSession({ adapter, cwd: "/tmp", debounceMs: 50 });
    const loginCb = jest.fn();
    session.onLoginUrl(loginCb);
    session.start();
    session.write("go");

    spawnedProc.stdout.emit("data", Buffer.from("Visit https://login.example.com/auth to continue"));

    expect(loginCb).toHaveBeenCalledWith("https://login.example.com/auth");
  });

  it("detects login URL from stderr", () => {
    const session = createModelSession({ adapter, cwd: "/tmp", debounceMs: 50 });
    const loginCb = jest.fn();
    session.onLoginUrl(loginCb);
    session.start();
    session.write("go");

    spawnedProc.stderr.emit("data", Buffer.from("Visit https://login.example.com/auth to continue"));

    expect(loginCb).toHaveBeenCalledWith("https://login.example.com/auth");
  });

  it("returns to idle on process exit", () => {
    const session = createModelSession({ adapter, cwd: "/tmp", debounceMs: 50 });
    session.start();
    session.write("go");
    expect(session.state()).toBe("processing");

    spawnedProc.emit("exit", 0);
    expect(session.state()).toBe("idle");
  });

  it("interrupt sends SIGINT", () => {
    const session = createModelSession({ adapter, cwd: "/tmp", debounceMs: 50 });
    session.start();
    session.write("go");
    session.interrupt();

    expect(spawnedProc.kill).toHaveBeenCalledWith("SIGINT");
    expect(session.state()).toBe("idle");
  });

  it("kill sends SIGTERM and calls exit callback", () => {
    const session = createModelSession({ adapter, cwd: "/tmp", debounceMs: 50 });
    const exitCb = jest.fn();
    session.onExit(exitCb);
    session.start();
    session.write("go");
    session.kill();

    expect(spawnedProc.kill).toHaveBeenCalledWith("SIGTERM");
    expect(session.state()).toBe("stopped");
    expect(exitCb).toHaveBeenCalledWith(0);
  });

  it("ignores write when stopped", () => {
    const session = createModelSession({ adapter, cwd: "/tmp", debounceMs: 50 });
    session.start();
    session.kill();
    session.write("should be ignored");
    expect(session.state()).toBe("stopped");
  });

  it("ignores write when already processing", () => {
    const session = createModelSession({ adapter, cwd: "/tmp", debounceMs: 50 });
    session.start();
    session.write("first");
    session.write("second"); // should be ignored
    expect(session.state()).toBe("processing");
  });

  it("fires timeout warning when silent too long", () => {
    const session = createModelSession({ adapter, cwd: "/tmp", debounceMs: 50, timeoutMs: 5000 });
    const outputCb = jest.fn();
    session.onOutput(outputCb);
    session.start();
    session.write("go");

    jest.advanceTimersByTime(5000);
    expect(outputCb).toHaveBeenCalledWith(expect.stringContaining("silent"));
  });

  it("resets silence timer on stdout data", () => {
    const session = createModelSession({ adapter, cwd: "/tmp", debounceMs: 50, timeoutMs: 5000 });
    const outputCb = jest.fn();
    session.onOutput(outputCb);
    session.start();
    session.write("go");

    // Advance to just before timeout
    jest.advanceTimersByTime(4000);
    // Emit data to reset timer
    spawnedProc.stdout.emit("data", Buffer.from("partial"));
    // Flush the debounce
    jest.advanceTimersByTime(50);
    outputCb.mockClear();

    // Advance another 4000ms — should not trigger timeout since it was reset
    jest.advanceTimersByTime(4000);
    const timeoutCalls = outputCb.mock.calls.filter(
      (c) => typeof c[0] === "string" && (c[0] as string).includes("silent")
    );
    expect(timeoutCalls).toHaveLength(0);
  });

  it("does not detect login URL when adapter has no detectLoginUrl", () => {
    const simpleAdapter = {
      name: "simple",
      command: "cmd",
      buildArgs: () => [] as string[],
    };
    const session = createModelSession({ adapter: simpleAdapter, cwd: "/tmp", debounceMs: 50 });
    const loginCb = jest.fn();
    session.onLoginUrl(loginCb);
    session.start();
    session.write("go");

    spawnedProc.stdout.emit("data", Buffer.from("https://login.example.com"));
    spawnedProc.stderr.emit("data", Buffer.from("https://login.example.com"));
    expect(loginCb).not.toHaveBeenCalled();
  });

  it("clears silence timer on exit", () => {
    const session = createModelSession({ adapter, cwd: "/tmp", debounceMs: 50, timeoutMs: 5000 });
    const outputCb = jest.fn();
    session.onOutput(outputCb);
    session.start();
    session.write("go");

    spawnedProc.emit("exit", 0);
    jest.advanceTimersByTime(10000);

    const timeoutCalls = outputCb.mock.calls.filter(
      (c) => typeof c[0] === "string" && (c[0] as string).includes("silent")
    );
    expect(timeoutCalls).toHaveLength(0);
  });

  it("does not set silence timer when timeoutMs is 0", () => {
    const session = createModelSession({ adapter, cwd: "/tmp", debounceMs: 50, timeoutMs: 0 });
    const outputCb = jest.fn();
    session.onOutput(outputCb);
    session.start();
    session.write("go");

    // Exit without a silence timer set
    spawnedProc.emit("exit", 0);

    jest.advanceTimersByTime(999999);
    const timeoutCalls = outputCb.mock.calls.filter(
      (c) => typeof c[0] === "string" && (c[0] as string).includes("silent")
    );
    expect(timeoutCalls).toHaveLength(0);
  });

  it("interrupt with no active process does nothing", () => {
    const session = createModelSession({ adapter, cwd: "/tmp", debounceMs: 50 });
    session.start();
    // No write, so no proc
    session.interrupt();
    expect(session.state()).toBe("idle");
  });

  it("kill with no active process still changes state", () => {
    const session = createModelSession({ adapter, cwd: "/tmp", debounceMs: 50 });
    const exitCb = jest.fn();
    session.onExit(exitCb);
    session.start();
    session.kill();
    expect(session.state()).toBe("stopped");
    expect(exitCb).toHaveBeenCalledWith(0);
  });

  it("uses default debounceMs and timeoutMs", () => {
    const session = createModelSession({ adapter, cwd: "/tmp" });
    session.start();
    expect(session.state()).toBe("idle");
  });

  it("timeout does not fire if state changed to idle", () => {
    const session = createModelSession({ adapter, cwd: "/tmp", debounceMs: 50, timeoutMs: 5000 });
    const outputCb = jest.fn();
    session.onOutput(outputCb);
    session.start();
    session.write("go");

    // Process exits before timeout
    spawnedProc.emit("exit", 0);
    outputCb.mockClear();

    jest.advanceTimersByTime(10000);
    const timeoutCalls = outputCb.mock.calls.filter(
      (c) => typeof c[0] === "string" && (c[0] as string).includes("silent")
    );
    expect(timeoutCalls).toHaveLength(0);
  });

  it("stdout login URL detection with no match returns null", () => {
    const session = createModelSession({ adapter, cwd: "/tmp", debounceMs: 50 });
    const loginCb = jest.fn();
    session.onLoginUrl(loginCb);
    session.start();
    session.write("go");

    spawnedProc.stdout.emit("data", Buffer.from("no url here"));
    expect(loginCb).not.toHaveBeenCalled();
  });

  it("stderr login URL detection with no match returns null", () => {
    const session = createModelSession({ adapter, cwd: "/tmp", debounceMs: 50 });
    const loginCb = jest.fn();
    session.onLoginUrl(loginCb);
    session.start();
    session.write("go");

    spawnedProc.stderr.emit("data", Buffer.from("just some error text"));
    expect(loginCb).not.toHaveBeenCalled();
  });

  it("stdout with no loginUrlCb does not crash", () => {
    const session = createModelSession({ adapter, cwd: "/tmp", debounceMs: 50 });
    session.start();
    session.write("go");

    // No onLoginUrl registered
    spawnedProc.stdout.emit("data", Buffer.from("Visit https://login.example.com/auth"));
    // Should not throw
  });

  it("stdout with no outputCb does not crash", () => {
    const session = createModelSession({ adapter, cwd: "/tmp", debounceMs: 50 });
    // No onOutput registered
    session.start();
    session.write("go");

    spawnedProc.stdout.emit("data", Buffer.from("some output"));
    jest.advanceTimersByTime(50);
    // Should not throw
  });

  it("stderr with no loginUrlCb does not crash", () => {
    const session = createModelSession({ adapter, cwd: "/tmp", debounceMs: 50 });
    session.start();
    session.write("go");

    spawnedProc.stderr.emit("data", Buffer.from("Visit https://login.example.com/auth"));
    // Should not throw
  });

  it("calls onIdle callback after process exits", async () => {
    jest.useRealTimers();
    const session = createModelSession({ adapter, cwd: "/tmp", debounceMs: 50 });
    const idleCb = jest.fn();
    session.onIdle(idleCb);
    session.start();
    session.write("go");

    spawnedProc.emit("exit", 0);
    await new Promise((r) => setImmediate(r));
    expect(idleCb).toHaveBeenCalled();
  });
});
