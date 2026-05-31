import { jest } from "@jest/globals";
import { EventEmitter } from "events";
import { Readable } from "stream";

// Must mock before importing the module under test
jest.unstable_mockModule("../src/session/model-session.ts", () => ({
  createModelSession: jest.fn(() => ({
    state: jest.fn(() => "idle"),
    adapterName: jest.fn(() => "kiro"),
    write: jest.fn().mockReturnValue(true) as unknown as (input: string) => boolean,
    interrupt: jest.fn(),
    kill: jest.fn(),
    start: jest.fn(),
    onOutput: jest.fn(),
    onStderr: jest.fn(),
    onLoginUrl: jest.fn(),
    onProcessEnd: jest.fn(),
    onExit: jest.fn(),
    onIdle: jest.fn(),
  })),
}));

jest.unstable_mockModule("child_process", () => ({
  execSync: jest.fn(),
  spawn: jest.fn(() => {
    const proc = Object.assign(new EventEmitter(), {
      stdout: new Readable({ read() {} }),
      stderr: new Readable({ read() {} }),
      kill: jest.fn(),
    });
    process.nextTick(() => proc.emit("exit", 0));
    return proc;
  }),
}));

let mockSchedules: Array<{ id: number; type: string; hour: number; minute: number; message: string; lastFired?: string }> = [];
jest.unstable_mockModule("../src/scheduler/persistent-scheduler.ts", () => ({
  loadSchedules: jest.fn(() => mockSchedules),
  saveSchedules: jest.fn((entries: typeof mockSchedules) => { mockSchedules = entries; }),
  addSchedule: jest.fn((type: string, hour: number, minute: number, message: string) => {
    const id = mockSchedules.length + 1;
    const entry = { id, type, hour, minute, message };
    mockSchedules.push(entry);
    return entry;
  }),
  removeSchedule: jest.fn((id: number) => {
    const len = mockSchedules.length;
    mockSchedules = mockSchedules.filter((e) => e.id !== id);
    return mockSchedules.length < len;
  }),
  getDueSchedules: jest.fn(() => []),
  markFired: jest.fn(),
  formatSchedule: jest.fn((e: { id: number; type: string; hour: number; minute: number; message: string }) =>
    `#${e.id} [${e.type}] ${String(e.hour).padStart(2, "0")}:${String(e.minute).padStart(2, "0")} — ${e.message}`
  ),
}));

const { handleCommand, createCommandContext, splitMessage, tickScheduler, normalizeOutput, isSummaryOutput } =
  await import("../src/telegram/application/handle-telegram-command.ts");

describe("handleCommand", () => {
  let ctx: ReturnType<typeof createCommandContext>;
  let send: jest.Mock<(text: string, silent?: boolean) => Promise<boolean>>;

  beforeEach(() => {
    ctx = createCommandContext();
    send = jest.fn<(text: string, silent?: boolean) => Promise<boolean>>().mockResolvedValue(true);
    mockSchedules = [];
  });

  it("replies with no session message when no session", async () => {
    await handleCommand("hello", ctx, send);
    expect(send).toHaveBeenCalledWith("No active session. Send /start to begin.");
  });

  it("/help lists commands", async () => {
    await handleCommand("/help", ctx, send);
    expect(send).toHaveBeenCalledWith(expect.stringContaining("/start"));
    expect(send).toHaveBeenCalledWith(expect.stringContaining("/stop"));
  });

  it("/provider lists supported providers", async () => {
    await handleCommand("/provider", ctx, send);
    expect(send).toHaveBeenCalledWith("kiro\ncodex-cli\ngemini-cli");
  });

  it("/provider switches to codex-cli and starts a new session", async () => {
    await handleCommand("/start", ctx, send);
    const oldSession = ctx.session;
    send.mockClear();

    await handleCommand("/provider codex-cli", ctx, send);

    expect(oldSession?.kill).toHaveBeenCalled();
    expect(ctx.adapterName).toBe("codex-cli");
    expect(ctx.session).not.toBeNull();
    expect(send).toHaveBeenCalledWith("Switched provider to codex-cli. Starting session...");
    expect(send).toHaveBeenCalledWith(expect.stringContaining("Started codex-cli"));
  });

  it("/start creates a session", async () => {
    await handleCommand("/start", ctx, send);
    expect(ctx.session).not.toBeNull();
    expect(send).toHaveBeenCalledWith(expect.stringContaining("Started kiro"));
  });

  it("/start when session already running", async () => {
    await handleCommand("/start", ctx, send);
    send.mockClear();
    await handleCommand("/start", ctx, send);
    expect(send).toHaveBeenCalledWith("Session already running. Send /stop first.");
  });

  it("/stop kills session", async () => {
    await handleCommand("/start", ctx, send);
    await handleCommand("/stop", ctx, send);
    expect(ctx.session).toBeNull();
    expect(send).toHaveBeenCalledWith("🛑 Session stopped and logged out. Next /start will require a new login.");
  });

  it("/stop with no session", async () => {
    await handleCommand("/stop", ctx, send);
    expect(send).toHaveBeenCalledWith("No active session.");
  });

  it("/interrupt with session", async () => {
    await handleCommand("/start", ctx, send);
    send.mockClear();
    await handleCommand("/interrupt", ctx, send);
    expect(send).toHaveBeenCalledWith("⚡ Interrupt sent.");
  });

  it("/interrupt with no session", async () => {
    await handleCommand("/interrupt", ctx, send);
    expect(send).toHaveBeenCalledWith("No active session.");
  });

  it("/status with session", async () => {
    await handleCommand("/start", ctx, send);
    send.mockClear();
    await handleCommand("/status", ctx, send);
    expect(send).toHaveBeenCalledWith(expect.stringContaining("Model:"));
    expect(send).toHaveBeenCalledWith(expect.stringContaining("State:"));
  });

  it("/status with no session", async () => {
    await handleCommand("/status", ctx, send);
    expect(send).toHaveBeenCalledWith("No active session.");
  });

  it("/verbose toggles", async () => {
    await handleCommand("/verbose", ctx, send);
    expect(ctx.verbose).toBe(true);
    expect(send).toHaveBeenCalledWith("Verbose mode: ON");
    send.mockClear();
    await handleCommand("/verbose", ctx, send);
    expect(ctx.verbose).toBe(false);
    expect(send).toHaveBeenCalledWith("Verbose mode: OFF");
  });

  it("/history shows empty", async () => {
    await handleCommand("/history nonexistent_xyz_query_12345", ctx, send);
    expect(send).toHaveBeenCalledWith(expect.stringContaining("No tasks matching"));
  });

  it("/history shows items", async () => {
    // The new /history reads from task-log.json via searchTaskLog
    // With no log file, it shows empty
    await handleCommand("/history search term", ctx, send);
    expect(send).toHaveBeenCalledWith(expect.stringContaining("No tasks matching"));
  });

  it("/model shows current", async () => {
    await handleCommand("/model", ctx, send);
    expect(send).toHaveBeenCalledWith(expect.stringContaining("kiro"));
  });

  it("/model follows the current provider", async () => {
    await handleCommand("/provider codex-cli", ctx, send);
    send.mockClear();

    await handleCommand("/model", ctx, send);

    expect(send).toHaveBeenCalledWith(
      "Adapter: codex-cli\nActive model: gpt-5.5\n\n▸ 1. gpt-5.5\n• 2. gpt-5.4\n• 3. gpt-5.4-mini\n• 4. gpt-5.3-codex\n• 5. gpt-5.2"
    );
  });

  it("/model sets the current provider model and restarts the session", async () => {
    await handleCommand("/provider codex-cli", ctx, send);
    const oldSession = ctx.session;
    send.mockClear();

    await handleCommand("/model gpt-5.2", ctx, send);

    expect(oldSession?.kill).toHaveBeenCalled();
    expect(ctx.session).not.toBeNull();
    expect(send).toHaveBeenCalledWith("Switched to gpt-5.2. Restarting session...");
    expect(send).toHaveBeenCalledWith(expect.stringContaining("Started codex-cli (gpt-5.2)"));
  });

  it("/model unknown errors", async () => {
    await handleCommand("/model nope", ctx, send);
    expect(send).toHaveBeenCalledWith(expect.stringContaining("Unknown model/adapter"));
  });

  it("/model switches adapter", async () => {
    await handleCommand("/model gemini-cli", ctx, send);
    expect(ctx.adapterName).toBe("gemini-cli");
    expect(send).toHaveBeenCalledWith(expect.stringContaining("Switched to adapter gemini-cli"));
  });

  it("/model kills active session before switching", async () => {
    await handleCommand("/start", ctx, send);
    expect(ctx.session).not.toBeNull();
    await handleCommand("/model codex-cli", ctx, send);
    expect(ctx.session).toBeNull();
    expect(ctx.adapterName).toBe("codex-cli");
  });

  it("/project changes to valid path", async () => {
    await handleCommand("/project .", ctx, send);
    expect(send).toHaveBeenCalledWith(expect.stringContaining("Project set to"));
  });

  it("/project changes directory", async () => {
    await handleCommand("/project /tmp", ctx, send);
    expect(ctx.cwd).toBe("/tmp");
    expect(send).toHaveBeenCalledWith(expect.stringContaining("/tmp"));
  });

  it("/project with nonexistent path", async () => {
    await handleCommand("/project /nonexistent_xyz_123", ctx, send);
    expect(send).toHaveBeenCalledWith(expect.stringContaining("Path not found"));
  });

  it("/project kills active session", async () => {
    await handleCommand("/start", ctx, send);
    await handleCommand("/project /tmp", ctx, send);
    expect(ctx.session).toBeNull();
  });

  it("/schedule with no args shows empty", async () => {
    await handleCommand("/schedule", ctx, send);
    expect(send).toHaveBeenCalledWith("No scheduled commands.");
  });

  it("/schedule adds a job", async () => {
    await handleCommand("/schedule 23:59 test msg", ctx, send);
    expect(send).toHaveBeenCalledWith(expect.stringContaining("23:59"));
    expect(send).toHaveBeenCalledWith(expect.stringContaining("test msg"));
  });

  it("/schedule with type adds recurring job", async () => {
    await handleCommand("/schedule weekdays 10:00 ai news", ctx, send);
    expect(send).toHaveBeenCalledWith(expect.stringContaining("weekdays"));
    expect(send).toHaveBeenCalledWith(expect.stringContaining("ai news"));
  });

  it("/schedule shows existing jobs", async () => {
    await handleCommand("/schedule daily 14:30 do thing", ctx, send);
    send.mockClear();
    await handleCommand("/schedule", ctx, send);
    expect(send).toHaveBeenCalledWith(expect.stringContaining("do thing"));
  });

  it("/schedule with bad format", async () => {
    await handleCommand("/schedule badformat", ctx, send);
    expect(send).toHaveBeenCalledWith(expect.stringContaining("Usage"));
  });

  it("/undo with session", async () => {
    await handleCommand("/start", ctx, send);
    send.mockClear();
    await handleCommand("/undo", ctx, send);
    expect(send).toHaveBeenCalledWith("↩️ Undo requested.", true);
  });

  it("/undo with no session", async () => {
    await handleCommand("/undo", ctx, send);
    expect(send).toHaveBeenCalledWith("No active session.");
  });

  it("queues message when session is processing", async () => {
    await handleCommand("/start", ctx, send);
    // Override state to processing
    ctx.session!.state = () => "processing";
    send.mockClear();
    await handleCommand("do something", ctx, send);
    expect(ctx.taskQueue).not.toBeNull();
    expect(ctx.taskQueue!.current()?.prompt).toBe("do something");
  });

  it("blocks high-risk input with approval gate", async () => {
    await handleCommand("/start", ctx, send);
    send.mockClear();
    await handleCommand("delete the production database", ctx, send);
    expect(ctx.pendingConfirmation).toBe("delete the production database");
    expect(send).toHaveBeenCalledWith(expect.stringContaining("high-risk"));
    expect(ctx.session!.write).not.toHaveBeenCalled();
  });

  it("writes to session when idle", async () => {
    await handleCommand("/start", ctx, send);
    send.mockClear();
    await handleCommand("do something", ctx, send);
    expect(ctx.session!.write).toHaveBeenCalledWith("do something");
  });

  it("strips > prefix before forwarding", async () => {
    await handleCommand("/start", ctx, send);
    send.mockClear();
    await handleCommand("> literal text", ctx, send);
    expect(ctx.session!.write).toHaveBeenCalledWith("literal text");
  });

  it("/yes confirms pending action and forwards held input", async () => {
    await handleCommand("/start", ctx, send);
    ctx.pendingConfirmation = "delete the production database";
    send.mockClear();
    await handleCommand("/yes", ctx, send);
    expect(ctx.pendingConfirmation).toBeNull();
    expect(send).toHaveBeenCalledWith("✅ Confirmed. Proceeding.");
    expect(ctx.session!.write).toHaveBeenCalledWith("delete the production database");
  });

  it("/yes confirms output-level detection", async () => {
    ctx.pendingConfirmation = "__output__";
    await handleCommand("/yes", ctx, send);
    expect(ctx.pendingConfirmation).toBeNull();
    expect(send).toHaveBeenCalledWith("✅ Confirmed. Resuming.");
  });

  it("/no cancels pending action with session", async () => {
    await handleCommand("/start", ctx, send);
    ctx.pendingConfirmation = "some action";
    send.mockClear();
    await handleCommand("/no", ctx, send);
    expect(ctx.pendingConfirmation).toBeNull();
    expect(send).toHaveBeenCalledWith("❌ Cancelled.");
  });

  it("/no cancels pending action without session", async () => {
    ctx.pendingConfirmation = "some action";
    await handleCommand("/no", ctx, send);
    expect(ctx.pendingConfirmation).toBeNull();
    expect(send).toHaveBeenCalledWith("❌ Cancelled.");
  });

  it("falls through when pending confirmation but message is not /yes or /no", async () => {
    ctx.pendingConfirmation = "some action";
    await handleCommand("/help", ctx, send);
    // pendingConfirmation remains set
    expect(ctx.pendingConfirmation).toBe("some action");
  });

  it("shows login message when loginProc is active", async () => {
    ctx.loginProc = { kill: jest.fn() } as any;
    await handleCommand("hello", ctx, send);
    expect(send).toHaveBeenCalledWith(expect.stringContaining("Login in progress"));
  });

  it("/stop kills loginProc", async () => {
    const killFn = jest.fn();
    ctx.loginProc = { kill: killFn } as any;
    await handleCommand("/stop", ctx, send);
    expect(killFn).toHaveBeenCalled();
    expect(ctx.loginProc).toBeNull();
  });
});

describe("splitMessage", () => {
  it("splits long text", () => {
    const text = "a".repeat(5000);
    const parts = splitMessage(text);
    expect(parts.length).toBe(2);
    expect(parts[0].length).toBe(4096);
    expect(parts[1].length).toBe(904);
  });

  it("does not split short text", () => {
    expect(splitMessage("short")).toEqual(["short"]);
  });
});

describe("tickScheduler", () => {
  it("drains due jobs to idle session", () => {
    const ctx = createCommandContext();
    ctx.session = {
      state: () => "idle",
      adapterName: () => "kiro",
      write: jest.fn().mockReturnValue(true) as unknown as (input: string) => boolean,
      interrupt: jest.fn(),
      kill: jest.fn(),
      start: jest.fn(),
      onOutput: jest.fn(),
      onStderr: jest.fn(),
      onLoginUrl: jest.fn(),
      onProcessEnd: jest.fn(),
      onExit: jest.fn(),
      onIdle: jest.fn(),
    };
    ctx.scheduled = [{ time: Date.now() - 1000, message: "do it" }];
    tickScheduler(ctx);
    expect(ctx.session!.write).toHaveBeenCalledWith("do it");
    expect(ctx.scheduled.length).toBe(0);
  });

  it("queues due jobs when session is processing", () => {
    const ctx = createCommandContext();
    ctx.session = {
      state: () => "processing",
      adapterName: () => "kiro",
      write: jest.fn().mockReturnValue(true) as unknown as (input: string) => boolean,
      interrupt: jest.fn(),
      kill: jest.fn(),
      start: jest.fn(),
      onOutput: jest.fn(),
      onStderr: jest.fn(),
      onLoginUrl: jest.fn(),
      onProcessEnd: jest.fn(),
      onExit: jest.fn(),
      onIdle: jest.fn(),
    };
    ctx.scheduled = [{ time: Date.now() - 1000, message: "queued" }];
    tickScheduler(ctx);
    expect(ctx.queue).toContain("queued");
    expect(ctx.session!.write).not.toHaveBeenCalled();
  });

  it("does nothing when no session", () => {
    const ctx = createCommandContext();
    ctx.scheduled = [{ time: Date.now() - 1000, message: "lost" }];
    tickScheduler(ctx);
    expect(ctx.scheduled.length).toBe(0);
  });

  it("keeps future jobs", () => {
    const ctx = createCommandContext();
    ctx.scheduled = [{ time: Date.now() + 60000, message: "future" }];
    tickScheduler(ctx);
    expect(ctx.scheduled.length).toBe(1);
  });
});

describe("normalizeOutput", () => {
  it("strips ANSI codes", () => {
    expect(normalizeOutput("\x1B[32mhello\x1B[0m")).toBe("hello");
  });

  it("strips markdown headers", () => {
    expect(normalizeOutput("## Title\ncontent")).toBe("Title\ncontent");
  });

  it("strips bold/italic", () => {
    expect(normalizeOutput("**bold** and *italic*")).toBe("bold and italic");
  });

  it("strips code fences entirely", () => {
    expect(normalizeOutput("```js\ncode\n```")).toBe("");
    expect(normalizeOutput("before\n```js\ncode\n```\nafter")).toBe("before\n\nafter");
  });

  it("strips inline backticks", () => {
    expect(normalizeOutput("use `foo` here")).toBe("use foo here");
  });

  it("collapses multiple blank lines", () => {
    expect(normalizeOutput("a\n\n\n\nb")).toBe("a\n\nb");
  });

  it("strips underscore emphasis", () => {
    expect(normalizeOutput("___strong___")).toBe("strong");
  });

  it("returns empty for whitespace-only", () => {
    expect(normalizeOutput("   ")).toBe("");
  });
});

describe("isSummaryOutput", () => {
  it("returns true for summary-like text", () => {
    expect(isSummaryOutput("Plan: refactor the module")).toBe(true);
    expect(isSummaryOutput("Task complete")).toBe(true);
    expect(isSummaryOutput("Error: something failed")).toBe(true);
  });

  it("returns false for non-summary text", () => {
    expect(isSummaryOutput("reading file contents")).toBe(false);
  });
});

describe("wireSession via /start", () => {
  it("wires output callback that sends to telegram", async () => {
    const ctx = createCommandContext();
    const send = jest.fn<(text: string, silent?: boolean) => Promise<boolean>>().mockResolvedValue(true);
    await handleCommand("/start", ctx, send);

    // Get the mock session and trigger its onOutput callback
    const mockSession = ctx.session!;
    const onOutputCall = (mockSession.onOutput as jest.Mock).mock.calls[0];
    expect(onOutputCall).toBeDefined();

    // Trigger the output callback
    const outputCb = onOutputCall[0] as (text: string) => void;
    outputCb("hello world");

    // Should have pushed to history
    expect(ctx.history).toContain("hello world");
  });

  it("wires output callback that detects destructive actions", async () => {
    const ctx = createCommandContext();
    const send = jest.fn<(text: string, silent?: boolean) => Promise<boolean>>().mockResolvedValue(true);
    await handleCommand("/start", ctx, send);

    const mockSession = ctx.session!;
    const outputCb = (mockSession.onOutput as jest.Mock).mock.calls[0][0] as (text: string) => void;
    send.mockClear();
    outputCb("running rm -rf /tmp/stuff");

    expect(ctx.pendingConfirmation).toBe("__output__");
    expect(send).toHaveBeenCalledWith(expect.stringContaining("Destructive action detected in output"));
  });

  it("wires output callback in verbose mode", async () => {
    const ctx = createCommandContext();
    ctx.verbose = true;
    const send = jest.fn<(text: string, silent?: boolean) => Promise<boolean>>().mockResolvedValue(true);
    await handleCommand("/start", ctx, send);

    const mockSession = ctx.session!;
    const outputCb = (mockSession.onOutput as jest.Mock).mock.calls[0][0] as (text: string) => void;
    send.mockClear();
    outputCb("verbose output");

    expect(send).toHaveBeenCalledWith("verbose output", true);
  });

  it("catches send rejection in verbose mode", async () => {
    const ctx = createCommandContext();
    ctx.verbose = true;
    const send = jest.fn<(text: string, silent?: boolean) => Promise<boolean>>().mockResolvedValue(true);
    await handleCommand("/start", ctx, send);

    const mockSession = ctx.session!;
    const outputCb = (mockSession.onOutput as jest.Mock).mock.calls[0][0] as (text: string) => void;
    send.mockClear();
    send.mockRejectedValue(new Error("fail"));
    outputCb("verbose output");
    // Should not throw — .catch swallows it
  });

  it("catches send rejection in non-verbose mode", async () => {
    const ctx = createCommandContext();
    const send = jest.fn<(text: string, silent?: boolean) => Promise<boolean>>().mockResolvedValue(true);
    await handleCommand("/start", ctx, send);

    const mockSession = ctx.session!;
    const outputCb = (mockSession.onOutput as jest.Mock).mock.calls[0][0] as (text: string) => void;
    send.mockClear();
    send.mockRejectedValue(new Error("fail"));
    outputCb("some meaningful reply text here");
    // Should not throw — .catch swallows it
  });

  it("wires loginUrl callback", async () => {
    const ctx = createCommandContext();
    const send = jest.fn<(text: string, silent?: boolean) => Promise<boolean>>().mockResolvedValue(true);
    await handleCommand("/start", ctx, send);

    const mockSession = ctx.session!;
    const loginUrlCb = (mockSession.onLoginUrl as jest.Mock).mock.calls[0][0] as (url: string) => void;
    send.mockClear();
    loginUrlCb("https://login.example.com");

    expect(send).toHaveBeenCalledWith(expect.stringContaining("https://login.example.com"));
  });

  it("wires exit callback", async () => {
    const ctx = createCommandContext();
    const send = jest.fn<(text: string, silent?: boolean) => Promise<boolean>>().mockResolvedValue(true);
    await handleCommand("/start", ctx, send);

    const mockSession = ctx.session!;
    const exitCb = (mockSession.onExit as jest.Mock).mock.calls[0][0] as (code: number | null) => void;
    send.mockClear();
    exitCb(1);

    expect(send).toHaveBeenCalledWith(expect.stringContaining("Session exited"));
    expect(ctx.session).toBeNull();
  });

  it("wires exit callback with null code", async () => {
    const ctx = createCommandContext();
    const send = jest.fn<(text: string, silent?: boolean) => Promise<boolean>>().mockResolvedValue(true);
    await handleCommand("/start", ctx, send);

    const mockSession = ctx.session!;
    const exitCb = (mockSession.onExit as jest.Mock).mock.calls[0][0] as (code: number | null) => void;
    send.mockClear();
    exitCb(null);

    expect(send).toHaveBeenCalledWith(expect.stringContaining("unknown"));
  });

  it("drains queue when session becomes idle", async () => {
    const ctx = createCommandContext();
    const send = jest.fn<(text: string, silent?: boolean) => Promise<boolean>>().mockResolvedValue(true);
    await handleCommand("/start", ctx, send);

    const mockSession = ctx.session!;
    ctx.queue = ["next task"];
    (mockSession.state as jest.Mock).mockReturnValue("idle");

    const idleCb = (mockSession.onIdle as jest.Mock).mock.calls[0][0] as () => void;
    idleCb();

    expect(mockSession.write).toHaveBeenCalledWith("next task");
    expect(ctx.queue).toHaveLength(0);
  });

  it("does not drain when queue is empty on idle", async () => {
    const ctx = createCommandContext();
    const send = jest.fn<(text: string, silent?: boolean) => Promise<boolean>>().mockResolvedValue(true);
    await handleCommand("/start", ctx, send);

    const mockSession = ctx.session!;
    (mockSession.state as jest.Mock).mockReturnValue("idle");

    const idleCb = (mockSession.onIdle as jest.Mock).mock.calls[0][0] as () => void;
    idleCb();

    expect(mockSession.write).not.toHaveBeenCalled();
  });

  it("trims history when it exceeds 50 items", async () => {
    const ctx = createCommandContext();
    ctx.history = Array.from({ length: 50 }, (_, i) => `item${i}`);
    const send = jest.fn<(text: string, silent?: boolean) => Promise<boolean>>().mockResolvedValue(true);
    await handleCommand("/start", ctx, send);

    const mockSession = ctx.session!;
    const outputCb = (mockSession.onOutput as jest.Mock).mock.calls[0][0] as (text: string) => void;
    outputCb("new item");

    expect(ctx.history).toHaveLength(50);
    expect(ctx.history[ctx.history.length - 1]).toBe("new item");
    expect(ctx.history[0]).toBe("item1"); // item0 was shifted out
  });

  it("output callback skips empty normalized output", async () => {
    const ctx = createCommandContext();
    const send = jest.fn<(text: string, silent?: boolean) => Promise<boolean>>().mockResolvedValue(true);
    await handleCommand("/start", ctx, send);

    const mockSession = ctx.session!;
    const outputCb = (mockSession.onOutput as jest.Mock).mock.calls[0][0] as (text: string) => void;
    send.mockClear();
    outputCb("   "); // whitespace only normalizes to empty

    // send should not be called for empty output (after history push)
    // Actually history still gets pushed, but send is not called
    const sendCalls = send.mock.calls.filter(c => !String(c[0]).includes("Started"));
    expect(sendCalls).toHaveLength(0);
  });
});
