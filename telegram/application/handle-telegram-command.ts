import type { ModelSession } from "../../session/model-session.ts";
import { createModelSession } from "../../session/model-session.ts";
import { getAdapter, listAdapters } from "../../adapters/index.ts";
import { readEnv, readEnvNumber } from "../../utils/env.ts";
import { execSync, spawn } from "child_process";
import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { createTaskQueue, type TaskQueue } from "./task-queue.ts";
import { searchTaskLog, appendTaskLog, formatLogDate, type TaskLogEntry } from "../infrastructure/task-log.ts";
import { classifyRisk, buildApprovalPrompt } from "./approval-gate.ts";
import { createTraceSession, type TraceSession } from "../../tracing/trace-session.ts";
import { loadSchedules, addSchedule, removeSchedule, getDueSchedules, markFired, formatSchedule, type ScheduleType } from "../../scheduler/persistent-scheduler.ts";
import { sessionStore } from "../../server/session-store.ts";
import { emit as wsEmit } from "../../server/ws-emitter.ts";
import { estimateCostUsd } from "../../tracing/model-pricing.ts";

const DESTRUCTIVE_KEYWORDS = /\b(delete|drop|force push|rm -rf|reset --hard)\b/i;
const MAX_MSG_LEN = 4096;

export interface CommandContext {
  session: ModelSession | null;
  source: "telegram" | "web";
  queue: string[];
  taskQueue: TaskQueue | null;
  verbose: boolean;
  history: string[];
  scheduled: { time: number; message: string }[];
  cwd: string;
  adapterName: string;
  pendingConfirmation: string | null;
  loginProc: import("child_process").ChildProcess | null;
  loginExitedAt: number | null;
  lastReplayedUrl: string | null;
  _lastInput: string | null;
  _lastOutput: string | null;
  _lastExitCode: number | null;
  _inputTime: number | null;
  _activeTrace: TraceSession | null;
  _sessionId: string | null;
  _lastSessionAt: number;
  _providerModels: Record<string, string>;
}

export function createCommandContext(): CommandContext {
  return {
    session: null,
    source: "telegram",
    queue: [],
    taskQueue: null,
    verbose: false,
    history: [],
    scheduled: [],
    cwd: process.cwd(),
    adapterName: readEnv("MODEL_ADAPTER", "kiro"),
    pendingConfirmation: null,
    loginProc: null,
    loginExitedAt: null,
    lastReplayedUrl: null,
    _lastInput: null,
    _lastOutput: null,
    _lastExitCode: null,
    _inputTime: null,
    _activeTrace: null,
    _sessionId: null,
    _lastSessionAt: 0,
    _providerModels: {
      kiro: "auto",
      "codex-cli": "gpt-5.5",
      "gemini-cli": "default",
      "local-llm": "default",
    },
  };
}

function getCurrentProviderModel(ctx: CommandContext): string {
  return ctx._providerModels[ctx.adapterName] ?? "default";
}

function setCurrentProviderModel(ctx: CommandContext, model: string): void {
  ctx._providerModels[ctx.adapterName] = model;
}

export function splitMessage(text: string): string[] {
  const parts: string[] = [];
  for (let i = 0; i < text.length; i += MAX_MSG_LEN) {
    parts.push(text.slice(i, i + MAX_MSG_LEN));
  }
  return parts;
}

export interface SendFn {
  (text: string, silent?: boolean): Promise<boolean>;
}

export async function handleCommand(
  text: string,
  ctx: CommandContext,
  send: SendFn
): Promise<void> {
  const trimmed = text.trim();

  // Confirmation flow
  if (ctx.pendingConfirmation) {
    if (trimmed === "/yes") {
      const held = ctx.pendingConfirmation;
      ctx.pendingConfirmation = null;
      // If held input was a pre-execution gate, forward it now
      if (ctx.session && held !== "__output__") {
        await send("✅ Confirmed. Proceeding.");
        ctx._lastInput = held;
        ctx._lastOutput = null;
        ctx._lastExitCode = null;
        ctx._inputTime = Date.now();
        ctx._activeTrace = createTraceSession(ctx.adapterName, ctx.cwd, ctx._sessionId ?? "unknown", getCurrentProviderModel(ctx));
        ctx._activeTrace.begin(held);
        ctx.session.write(held);
      } else {
        await send("✅ Confirmed. Resuming.");
      }
      return;
    }
    if (trimmed === "/no") {
      ctx.pendingConfirmation = null;
      /* istanbul ignore next */ ctx.session?.interrupt();
      await send("❌ Cancelled.");
      return;
    }
  }

  // Commands
  if (trimmed === "/start" || trimmed.startsWith("/start ")) return cmdStart(trimmed, ctx, send);
  if (trimmed === "/stop") return cmdStop(ctx, send);
  if (trimmed === "/interrupt") return cmdInterrupt(ctx, send);
  if (trimmed === "/status") return cmdStatus(ctx, send);
  if (trimmed === "/verbose") return cmdVerbose(ctx, send);
  if (trimmed.startsWith("/history")) return cmdHistory(trimmed, ctx, send);
  if (trimmed === "/help") return cmdHelp(ctx, send);
  if (trimmed.startsWith("/provider")) return cmdProvider(trimmed, ctx, send);
  if (trimmed === "/undo") return cmdUndo(ctx, send);
  if (trimmed.startsWith("/model")) return cmdModel(trimmed, ctx, send);
  if (trimmed.startsWith("/project")) return cmdProject(trimmed, ctx, send);
  if (trimmed.startsWith("/schedule")) return cmdSchedule(trimmed, ctx, send);

  // Forward to session
  const input = trimmed.startsWith("> ") ? trimmed.slice(2) : trimmed;

  // Detect pasted localhost callback URL from login flow
  /* istanbul ignore next -- replayCallbackUrl is integration-tested separately */
  const loginActive = ctx.loginProc || (ctx.loginExitedAt && Date.now() - ctx.loginExitedAt < 30_000);
  if (loginActive && /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(input)) {
    if (ctx.lastReplayedUrl === input) return; // deduplicate
    ctx.lastReplayedUrl = input;
    return replayCallbackUrl(input, ctx, send);
  }

  // If session is active, forward to it (even if loginProc hasn't been GC'd yet)
  if (ctx.session) {
    if (ctx.session.state() === "processing") {
      if (!ctx.taskQueue) ctx.taskQueue = createTaskQueue(send);
      ctx.taskQueue.enqueue(input);
      return;
    }
    // Pre-execution approval gate for high-risk input
    if (classifyRisk(input) === "high") {
      ctx.pendingConfirmation = input;
      await send(buildApprovalPrompt(input));
      return;
    }
    ctx._lastInput = input;
    ctx._lastOutput = null;
    ctx._lastExitCode = null;
    ctx._inputTime = Date.now();
    ctx._activeTrace = createTraceSession(ctx.adapterName, ctx.cwd, ctx._sessionId ?? "unknown", getCurrentProviderModel(ctx));
    ctx._activeTrace.begin(input);
    ctx.session.write(input);
    return;
  }

  if (ctx.loginProc) {
    await send("⏳ Login in progress. Paste the localhost callback URL to complete.");
    return;
  }
  await send("No active session. Send /start to begin.");
}

async function cmdStart(text: string, ctx: CommandContext, send: SendFn) {
  if (ctx.session && ctx.session.state() !== "stopped") {
    await send("Session already running. Send /stop first.");
    return;
  }

  // Parse optional provider: /start codex-cli
  const arg = text.replace("/start", "").trim();
  if (arg) {
    try {
      getAdapter(arg); // validate it exists
      ctx.adapterName = arg;
    } catch {
      await send(`Unknown provider: ${arg}. Available: ${listAdapters().join(", ")}`);
      return;
    }
  }

  // Guard: kill stale loginProc from a previous attempt
  if (ctx.loginProc) {
    ctx.loginProc.kill();
    ctx.loginProc = null;
  }

  if (ctx.adapterName !== "kiro") {
    return startSession(ctx, send);
  }

  // Check if already logged in
  try {
    execSync("kiro-cli whoami", { timeout: 5000, stdio: ["pipe", "pipe", "pipe"] });
    // Exit code 0 means logged in
    return startSession(ctx, send);
  } catch { /* not logged in (exit code 1), proceed with login */ }

  /* istanbul ignore next -- login spawn requires live kiro-cli and browser */
  return spawnLoginFlow(ctx, send);
}

/* istanbul ignore next */
async function spawnLoginFlow(ctx: CommandContext, send: SendFn) {
  await send("🔐 Starting login...");
  const proc = spawn("kiro-cli", ["login", "--license", "pro",
    "--identity-provider", readEnv("KIRO_IDP_URL", "https://d-9667080293.awsapps.com/start/"),
    "--region", readEnv("KIRO_REGION", "ap-southeast-1")], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env },
  });
  ctx.loginProc = proc;

  const timeout = setTimeout(() => {
    proc.kill();
    ctx.loginProc = null;
    send("❌ Login timed out (2 min). Send /start to retry.");
  }, 120_000);

  const adapter = getAdapter(ctx.adapterName);

  // Drain stdout/stderr to prevent pipe buffer deadlock (BUG 4 fix)
  // Also detect login URLs printed by kiro-cli (BUG 2 fix)
  let lastDetectedUrl: string | null = null;
  proc.stdout?.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    if (adapter.detectLoginUrl) {
      const url = adapter.detectLoginUrl(text);
      if (url) { lastDetectedUrl = url; send(`🔑 Open this link to log in:\n${url}\n\nAfter authenticating, paste the failed localhost redirect URL back here.`); }
    }
  });

  proc.stderr?.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    if (adapter.detectLoginUrl) {
      const url = adapter.detectLoginUrl(text);
      if (url) { lastDetectedUrl = url; send(`🔑 Open this link to log in:\n${url}\n\nAfter authenticating, paste the failed localhost redirect URL back here.`); }
    }
  });

  proc.on("exit", (code) => {
    clearTimeout(timeout);
    ctx.loginExitedAt = Date.now();
    if (code === 0 && ctx.loginProc === proc) {
      ctx.loginProc = null;
      ctx.lastReplayedUrl = null;
      send("✅ Login successful!");
      startSession(ctx, send);
    } else if (ctx.loginProc === proc) {
      ctx.loginProc = null;
      ctx.lastReplayedUrl = null;
      // BUG 1 fix: notify user on non-zero exit
      send(`❌ Login failed (exit code: ${code ?? "unknown"}). Send /start to retry.`);
    }
  });

  setTimeout(async () => {
    if (ctx.loginProc !== proc) return;
    const url = lastDetectedUrl || captureLoginUrl();
    if (url) {
      await send(`🔑 Open this link to log in:\n${url}\n\nAfter authenticating, paste the failed localhost redirect URL back here.`);
      closeBrowserTab();
    } else {
      await send("🌐 Waiting for login URL from kiro-cli... If nothing appears, send /stop and try /start again.");
    }
  }, 3000);
}

/* istanbul ignore next -- platform-specific, not unit-testable */
function captureLoginUrl(): string | null {
  if (process.platform === "darwin") {
    const scripts = [
      `tell application "Google Chrome" to get URL of active tab of first window`,
      `tell application "Safari" to get URL of front document`,
    ];
    for (const script of scripts) {
      try {
        const url = execSync(`osascript -e '${script}'`, { timeout: 3000, stdio: ["pipe", "pipe", "pipe"] }).toString().trim();
        if (url.startsWith("http")) return url;
      } catch { /* browser not available */ }
    }
  } else if (process.platform === "win32") {
    // Use PowerShell to get URL from Chrome/Edge via remote debugging or clipboard trick
    const ps = `
$browsers = @('chrome','msedge')
foreach ($name in $browsers) {
  $p = Get-Process $name -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
  if ($p) {
    Add-Type @'
using System;
using System.Runtime.InteropServices;
public class Win32 {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
}
'@
    [Win32]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
    Start-Sleep -Milliseconds 200
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.Clipboard]::Clear()
    [System.Windows.Forms.SendKeys]::SendWait('^l')
    Start-Sleep -Milliseconds 100
    [System.Windows.Forms.SendKeys]::SendWait('^c')
    Start-Sleep -Milliseconds 100
    $url = [System.Windows.Forms.Clipboard]::GetText()
    [System.Windows.Forms.SendKeys]::SendWait('{ESCAPE}')
    if ($url -match '^https?://') { Write-Output $url; exit 0 }
  }
}`;
    try {
      const url = execSync(`powershell -NoProfile -STA -Command "${ps.replace(/"/g, '\\"').replace(/\n/g, " ")}"`, { timeout: 5000, stdio: ["pipe", "pipe", "pipe"] }).toString().trim();
      if (url.startsWith("http")) return url;
    } catch { /* browser not available */ }
  }
  return null;
}

/* istanbul ignore next -- platform-specific, not unit-testable */
function closeBrowserTab(): void {
  if (process.platform === "darwin") {
    const scripts = [
      `tell application "Google Chrome" to close active tab of first window`,
      `tell application "Safari" to close front document`,
    ];
    for (const script of scripts) {
      try {
        execSync(`osascript -e '${script}'`, { timeout: 3000, stdio: ["pipe", "pipe", "pipe"] });
        return;
      } catch { /* browser not available */ }
    }
  } else if (process.platform === "win32") {
    try {
      execSync(`powershell -NoProfile -STA -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('^w')"`, { timeout: 3000, stdio: ["pipe", "pipe", "pipe"] });
    } catch { /* browser not available */ }
  }
}

/* istanbul ignore next -- integration-level login replay, requires live server */
async function replayCallbackUrl(url: string, ctx: CommandContext, send: SendFn) {
  const parsed = new URL(url);
  const port = parsed.port || "3000";
  const localUrl = `http://127.0.0.1:${port}${parsed.pathname}${parsed.search}`;
  await send("🔄 Replaying callback locally...");

  // Retry fetch up to 3 times with 1s delay (BUG 3 fix: port may not be ready yet)
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await fetch(localUrl, { redirect: "manual" });
      lastErr = null;
      break;
    } catch (e) {
      lastErr = e as Error;
      if (attempt < 2) await new Promise((r) => setTimeout(r, 1000));
    }
  }

  if (lastErr) {
    await send(`❌ Failed to reach local server after 3 attempts: ${lastErr.message}`);
    return;
  }

  // If this is the OAuth callback (from IAM IdC), login should complete automatically
  if (parsed.pathname.includes("/oauth/callback") || parsed.searchParams.has("code")) {
    await send("⏳ OAuth callback replayed. Waiting for login to complete...");
    return;
  }
  // First callback (signin) — kiro-cli opens browser with full awsapps.com URL (with token params).
  // Capture it immediately before the browser redirects away.
  await new Promise((r) => setTimeout(r, 1500));
  const fullUrl = captureLoginUrl();
  if (fullUrl && /awsapps\.com/i.test(fullUrl)) {
    await send(`🔑 Now authenticate here:\n${fullUrl}\n\nAfter you authorize, paste the failed localhost URL back here.`);
    closeBrowserTab();
  } else {
    // Retry with longer delays
    for (let i = 0; i < 3; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      const retry = captureLoginUrl();
      if (retry && /awsapps\.com/i.test(retry)) {
        await send(`🔑 Now authenticate here:\n${retry}\n\nAfter you authorize, paste the failed localhost URL back here.`);
        closeBrowserTab();
        return;
      }
    }
    await send("⚠️ Could not capture the auth URL. Check your browser for the AWS login page, authenticate there, then paste the failed localhost redirect URL back here.");
  }
  closeBrowserTab();
}

async function startSession(ctx: CommandContext, send: SendFn) {
  // Guard: don't create a new session if one is already alive
  if (ctx.session && ctx.session.state() !== "stopped") return;
  // Debounce: don't create sessions faster than once per 5 seconds
  const now = Date.now();
  if (now - ctx._lastSessionAt < 5000) return;
  ctx._lastSessionAt = now;
  const adapter = getAdapter(ctx.adapterName);
  const timeoutMs = readEnvNumber("KIRO_TIMEOUT_MS", 300_000);
  ctx._sessionId = randomUUID();
  const model = getCurrentProviderModel(ctx);
  ctx.session = createModelSession({ adapter, cwd: ctx.cwd, model, timeoutMs });
  wireSession(ctx, send);
  ctx.session.start();
  // Register session in store and emit WS event
  const sessionDto = { id: ctx._sessionId, name: ctx.source === "telegram" ? "📱 Telegram" : "New Session", provider: ctx.adapterName, model, cwd: ctx.cwd, startedAt: new Date().toISOString(), active: true };
  sessionStore.upsertSession(sessionDto);
  wsEmit("session.started", sessionDto as Record<string, unknown>);
  await send(`✅ Started ${adapter.name} (${model}) in ${ctx.cwd}`);
}

async function cmdStop(ctx: CommandContext, send: SendFn) {
  if (ctx.loginProc) {
    ctx.loginProc.kill();
    ctx.loginProc = null;
  }
  if (!ctx.session) {
    await send("No active session.");
    return;
  }
  ctx.session.kill();
  ctx.session = null;
  ctx._sessionId = null;
  ctx._lastSessionAt = 0;
  ctx.queue = [];
  if (ctx.taskQueue) ctx.taskQueue.drain();
  try {
    execSync("kiro-cli logout", { timeout: 10_000 });
  } catch {
    /* logout is best-effort */
  }
  await send("🛑 Session stopped and logged out. Next /start will require a new login.");
}

async function cmdInterrupt(ctx: CommandContext, send: SendFn) {
  if (!ctx.session) {
    await send("No active session.");
    return;
  }
  ctx.session.interrupt();
  await send("⚡ Interrupt sent.");
}

async function cmdStatus(ctx: CommandContext, send: SendFn) {
  if (!ctx.session) {
    await send("No active session.");
    return;
  }
  const queueSize = ctx.taskQueue ? ctx.taskQueue.size() : ctx.queue.length;
  const current = ctx.taskQueue?.current();
  const status = current
    ? `Current: #${current.id} (${current.status})\nQueued: ${ctx.taskQueue!.pending().length}`
    : `Queued: ${queueSize}`;
  await send(`Model: ${ctx.session.adapterName()}\nState: ${ctx.session.state()}\n${status}`);
}

async function cmdVerbose(ctx: CommandContext, send: SendFn) {
  ctx.verbose = !ctx.verbose;
  await send(`Verbose mode: ${ctx.verbose ? "ON" : "OFF"}`);
}

async function cmdHistory(text: string, ctx: CommandContext, send: SendFn) {
  const query = text.replace("/history", "").trim();
  let entries: TaskLogEntry[];
  try {
    entries = await searchTaskLog(query);
  } catch {
    await send("Failed to read task history.");
    return;
  }
  if (entries.length === 0) {
    await send(query ? `No tasks matching "${query}".` : "No task history yet.");
    return;
  }
  const lines = entries.map((e) => {
    const date = formatLogDate(new Date(e.timestamp));
    const icon = e.status === "done" ? "✅" : "❌";
    return `${icon} #${e.id} [${date}] ${e.prompt.slice(0, 60)}`;
  });
  await send(lines.join("\n"));
}

async function cmdHelp(_ctx: CommandContext, send: SendFn) {
  await send(
    [
      "/start — spawn model session",
      "/stop — kill session",
      "/interrupt — cancel current task",
      "/status — show state & queue",
      "/provider — list available providers",
      "/model [name] — show or switch adapter",
      "/project <path> — switch working directory",
      "/verbose — toggle raw output streaming",
      "/history [query] — search task history",
      "/schedule <HH:MM> <msg> — deferred command",
      "/undo — revert last change",
      "/help — this message",
      '"> text" — forward literally to model',
    ].join("\n")
  );
}

async function cmdProvider(text: string, ctx: CommandContext, send: SendFn) {
  const providerOrder = ["kiro", "codex-cli", "gemini-cli"];
  const available = new Set(listAdapters());
  const providers = providerOrder.filter((name) => available.has(name));
  const arg = text.replace("/provider", "").trim();

  if (!arg) {
    await send(providers.join("\n"));
    return;
  }

  if (!providers.includes(arg)) {
    await send(`Unknown provider "${arg}".\nAvailable providers:\n${providers.join("\n")}`);
    return;
  }

  if (ctx.loginProc) {
    ctx.loginProc.kill();
    ctx.loginProc = null;
  }

  if (ctx.session && ctx.session.state() !== "stopped") {
    ctx.session.kill();
    ctx.session = null;
  }

  ctx.adapterName = arg;
  ctx._lastSessionAt = 0;
  await send(`Switched provider to ${arg}. Starting session...`);
  await cmdStart("/start", ctx, send);
}

async function cmdUndo(ctx: CommandContext, send: SendFn) {
  if (!ctx.session) {
    await send("No active session.");
    return;
  }
  ctx.session.write("revert the last change you made");
  await send("↩️ Undo requested.", true);
}

const KIRO_MODELS = [
  "auto", "claude-opus-4.6", "claude-sonnet-4.6", "claude-opus-4.5",
  "claude-sonnet-4.5", "claude-sonnet-4", "claude-haiku-4.5",
  "deepseek-3.2", "minimax-m2.5", "minimax-m2.1", "glm-5", "qwen3-coder-next",
];

const CODEX_MODELS = [
  {
    id: "gpt-5.5",
    label: "default",
    description: "Frontier model for complex coding, research, and real-world work.",
  },
  {
    id: "gpt-5.4",
    label: "current",
    description: "Strong model for everyday coding.",
  },
  {
    id: "gpt-5.4-mini",
    label: "",
    description: "Small, fast, and cost-efficient model for simpler coding tasks.",
  },
  {
    id: "gpt-5.3-codex",
    label: "",
    description: "Coding-optimized model.",
  },
  {
    id: "gpt-5.2",
    label: "",
    description: "Optimized for professional work and long-running agents.",
  },
] as const;

function formatCodexModels(activeModel: string): string {
  return CODEX_MODELS.map((model, index) => {
    const marker = model.id === activeModel ? "▸" : "•";
    return `${marker} ${index + 1}. ${model.id}`;
  }).join("\n");
}

async function cmdModel(text: string, ctx: CommandContext, send: SendFn) {
  const arg = text.replace("/model", "").trim();
  if (!arg) {
    let models = "";
    try {
      const out = execSync("kiro-cli chat --list-models --format json", { timeout: 10000, encoding: "utf-8" });
      const data = JSON.parse(out);
      models = data.models.map((m: { model_name: string; rate_multiplier: number; description: string }) =>
        `• ${m.model_name === getCurrentProviderModel(ctx) ? "▸ " : ""}${m.model_name} (${m.rate_multiplier}x) — ${m.description}`
      ).join("\n");
    } catch { /* fallback */ }
    const current = `Adapter: ${ctx.adapterName}\nActive model: ${getCurrentProviderModel(ctx)}`;
    if (ctx.adapterName === "kiro") {
      await send(models ? `${current}\n\n${models}` : current);
      return;
    }
    if (ctx.adapterName === "codex-cli") {
      await send(`${current}\n\n${formatCodexModels(getCurrentProviderModel(ctx))}`);
      return;
    }
    await send(`${current}\n\nSet a model with /model <name>.`);
    return;
  }

  // Check if arg is a kiro model name
  if (ctx.adapterName === "kiro" && KIRO_MODELS.includes(arg)) {
    setCurrentProviderModel(ctx, arg);
    if (ctx.session && ctx.session.state() !== "stopped") {
      ctx.session.kill();
      ctx.session = null;
      ctx._lastSessionAt = 0;
      await send(`Switched to ${arg}. Restarting session...`);
      return cmdStart("/start", ctx, send);
    }
    await send(`Model set to ${arg}. Send /start to begin.`);
    return;
  }

  if (ctx.adapterName !== "kiro") {
    if (ctx.adapterName === "codex-cli" && !CODEX_MODELS.some((model) => model.id === arg)) {
      await send(`Unknown model "${arg}".\nCodex models: ${CODEX_MODELS.map((model) => model.id).join(", ")}`);
      return;
    }
    setCurrentProviderModel(ctx, arg);
    if (ctx.session && ctx.session.state() !== "stopped") {
      ctx.session.kill();
      ctx.session = null;
      ctx._lastSessionAt = 0;
      await send(`Switched to ${arg}. Restarting session...`);
      return cmdStart("/start", ctx, send);
    }
    await send(`Model set to ${arg}. Send /start to begin.`);
    return;
  }

  // Check if arg is an adapter name
  try {
    getAdapter(arg);
  } catch {
    await send(`Unknown model/adapter "${arg}".\nKiro models: ${KIRO_MODELS.join(", ")}\nAdapters: ${listAdapters().join(", ")}`);
    return;
  }
  if (ctx.session && ctx.session.state() !== "stopped") {
    ctx.session.kill();
    ctx.session = null;
  }
  ctx.adapterName = arg;
  await send(`Switched to adapter ${arg}. Send /start to begin.`);
}

async function cmdProject(text: string, ctx: CommandContext, send: SendFn) {
  const dir = text.replace("/project", "").trim();
  /* istanbul ignore next -- unreachable via handleCommand routing */
  if (!dir) {
    await send(`Current: ${ctx.cwd}`);
    return;
  }
  const resolved = path.resolve(dir);
  if (!fs.existsSync(resolved)) {
    await send(`Path not found: ${resolved}`);
    return;
  }
  if (ctx.session && ctx.session.state() !== "stopped") {
    ctx.session.kill();
    ctx.session = null;
  }
  ctx.cwd = resolved;
  await send(`📂 Project set to ${resolved}. Send /start to begin.`);
}

async function cmdSchedule(text: string, _ctx: CommandContext, send: SendFn) {
  const arg = text.replace("/schedule", "").trim();

  // List schedules
  if (!arg) {
    const entries = loadSchedules();
    if (entries.length === 0) {
      await send("No scheduled commands.");
      return;
    }
    await send(entries.map(formatSchedule).join("\n"));
    return;
  }

  // Remove schedule
  const removeMatch = arg.match(/^remove\s+(\d+)$/i);
  if (removeMatch) {
    const removed = removeSchedule(parseInt(removeMatch[1]));
    await send(removed ? "✅ Schedule removed." : "❌ Schedule not found.");
    return;
  }

  // Add schedule: /schedule <type> HH:MM <message>
  // or shorthand: /schedule HH:MM <message> (defaults to "once")
  const fullMatch = arg.match(/^(once|daily|weekdays|weekends)\s+(\d{2}):(\d{2})\s+(.+)$/i);
  const shortMatch = arg.match(/^(\d{2}):(\d{2})\s+(.+)$/);

  if (fullMatch) {
    const type = fullMatch[1].toLowerCase() as ScheduleType;
    const entry = addSchedule(type, parseInt(fullMatch[2]), parseInt(fullMatch[3]), fullMatch[4]);
    await send(`⏰ ${formatSchedule(entry)}`);
    return;
  }

  if (shortMatch) {
    const entry = addSchedule("once", parseInt(shortMatch[1]), parseInt(shortMatch[2]), shortMatch[3]);
    await send(`⏰ ${formatSchedule(entry)}`);
    return;
  }

  await send("Usage:\n/schedule <daily|weekdays|weekends|once> HH:MM <message>\n/schedule HH:MM <message> (one-time)\n/schedule remove <id>\n/schedule (list all)");
}

export function normalizeOutput(text: string): string {
  let out = text;
  /* istanbul ignore next -- regex alternatives counted as branches */
  out = out.replace(/\x1B\[[0-9;]*[A-Za-z]/g, "");
  // Strip markdown headings, bold, italic, code fences, inline code
  out = out.replace(/^#{1,6}\s+/gm, "");
  out = out.replace(/\*{1,3}([^*]+)\*{1,3}/g, "$1");
  out = out.replace(/_{1,3}([^_]+)_{1,3}/g, "$1");
  out = out.replace(/```[\s\S]*?```/g, "");
  out = out.replace(/`([^`]+)`/g, "$1");
  out = out.replace(/\n{3,}/g, "\n\n");
  out = out.trim();
  return out;
}

export function isSummaryOutput(text: string): boolean {
  const lower = text.toLowerCase();
  return /\b(plan|task|done|complete|created|modified|fixed|error|fail|block|issue|result|summary|finished)\b/.test(lower);
}

/**
 * Extract only the human-readable conversational reply from model output.
 * Strips file paths, code blocks, shell commands, diffs, and technical noise.
 */
export function extractHumanReply(text: string): string {
  let out = text;
  // Remove ANSI
  out = out.replace(/\x1B\[[0-9;]*[A-Za-z]/g, "");
  // Remove codex CLI header/metadata
  out = out.replace(/^.*Reading additional input from stdin.*$/gm, "");
  out = out.replace(/^.*OpenAI Codex v[\d.]+.*$/gm, "");
  out = out.replace(/^-{3,}$/gm, "");
  out = out.replace(/^(?:workdir|model|provider|approval|sandbox|reasoning effort|reasoning summaries|session id):.*$/gm, "");
  out = out.replace(/^(?:user|exec)$/gm, "");
  out = out.replace(/^(?:tokens used|warning:).*$/gm, "");
  out = out.replace(/^\d+[\d.]*$/gm, "");
  // Extract codex response: take text between "codex" label and "tokens used" or end
  const codexMatch = out.match(/^codex\n([\s\S]*?)(?:tokens used|$)/m);
  if (codexMatch) out = codexMatch[1].trim();
  // Fallback: strip "tokens used" and everything after it
  out = out.replace(/tokens used[\s\S]*$/m, "").trim();
  // Remove code fences and their content
  out = out.replace(/```[\s\S]*?```/g, "");
  // Remove tool-use / agent progress lines
  out = out.replace(/^[\s]*[-✓•].*(?:using tool|Completed in|Searching for|Updating:|Reading:|Writing:).*$/gm, "");
  out = out.replace(/^[\s]*(?:I'll modify|I'll read|I'll create|I'll update|I'll delete).*$/gm, "");
  out = out.replace(/^[\s]*[-+]\s*\d+\s*:.*$/gm, ""); // diff lines like "- 9: ..." or "+ 9: ..."
  out = out.replace(/^[\s]*Successfully (?:found|created|replaced|inserted).*$/gm, "");
  // Remove lines that look like shell commands
  out = out.replace(/^[\s]*[$>]\s.*$/gm, "");
  // Remove diff headers and hunks
  out = out.replace(/^[\s]*[+-]{3}\s.*$/gm, "");
  out = out.replace(/^[\s]*diff --git.*$/gm, "");
  out = out.replace(/^[\s]*@@.*@@.*$/gm, "");
  // Remove lines that are purely file paths (starting with / or ~)
  out = out.replace(/^[\s]*[\/~][\w\/.@-]+\s*$/gm, "");
  // Remove inline code backticks
  out = out.replace(/`([^`]+)`/g, "$1");
  // Remove markdown formatting
  out = out.replace(/^#{1,6}\s+/gm, "");
  out = out.replace(/\*{1,3}([^*]+)\*{1,3}/g, "$1");
  out = out.replace(/_{1,3}([^_]+)_{1,3}/g, "$1");
  // Collapse whitespace
  out = out.replace(/\n{3,}/g, "\n\n");
  out = out.trim();
  // If nothing meaningful remains, return last paragraph of original
  if (!out || out.length < 5) {
    const paragraphs = text.replace(/\x1B\[[0-9;]*[A-Za-z]/g, "").trim().split(/\n\n+/);
    const last = paragraphs[paragraphs.length - 1]?.trim() || "";
    return last.slice(0, MAX_MSG_LEN);
  }
  return out;
}

function wireSession(ctx: CommandContext, send: SendFn) {
  /* istanbul ignore next -- defensive: called after session creation */
  if (!ctx.session) return;

  function drainQueue() {
    if (ctx.taskQueue) {
      const next = ctx.taskQueue.current();
      if (next && next.status === "running" && ctx.session?.state() === "idle") {
        ctx.session.write(next.prompt);
      }
    } else if (ctx.queue.length > 0 && ctx.session?.state() === "idle") {
      const next = ctx.queue.shift()!;
      ctx.session.write(next);
    }
  }

  ctx.session.onOutput((text) => {

    // Filter out CLI spinner/progress noise — kill session if stuck in login loop
    if (/^[\s▰▱░▓█⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏|\\\/\-]*(?:Opening browser|Press \(\^\)|Waiting|Loading|Connecting)/i.test(text.trim())) {
      if (ctx.session) {
        ctx.session.kill();
        ctx.session = null;
        ctx._sessionId = null;
      }
      send("🛑 Session requires login. Send /start to authenticate.").catch(() => {});
      return;
    }

    // Capture output for tracing
    if (ctx._activeTrace) ctx._activeTrace.captureOutput(text);

    // Emit realtime output event
    wsEmit("session.output", { sessionId: ctx._sessionId, text: text.slice(0, 500) });

    // Destructive action check (output-level, second safety layer)
    if (DESTRUCTIVE_KEYWORDS.test(text) && !ctx.pendingConfirmation) {
      ctx.pendingConfirmation = "__output__";
      const preview = text.slice(0, 200);
      send(`⚠️ Destructive action detected in output:\n${preview}\n\nReply /yes to continue or /no to interrupt.`);
      return;
    }

    ctx.history.push(text.slice(0, 200));
    if (ctx.history.length > 50) ctx.history.shift();
    ctx._lastOutput = text;

    if (ctx.verbose) {
      for (const part of splitMessage(text)) {
        send(part, true).catch(() => {});
      }
    } else {
      const reply = extractHumanReply(text);
      if (reply && reply.length >= 5) {
        // Skip if it's just an echo of the user's input
        const lastInput = ctx._lastInput?.trim();
        if (lastInput && reply.trim() === lastInput) return;
        for (const part of splitMessage(reply)) {
          send(part).catch(() => {});
        }
      }
    }
  });

  ctx.session.onLoginUrl((url) => {
    send(`🔑 Login required:\n${url}`);
  });

  ctx.session.onStderr((text) => {
    if (ctx._activeTrace) ctx._activeTrace.captureStderr(text);

    if (ctx.verbose) {
      const message = `stderr:\n${text}`.trim();
      for (const part of splitMessage(message)) {
        send(part, true).catch(() => {});
      }
    }
  });

  ctx.session.onProcessEnd((code) => {
    if (ctx._activeTrace) {
      const traceId = randomUUID();
      const input = ctx._lastInput ?? "";
      const output = ctx._lastOutput ?? "";
      const durationMs = ctx._inputTime ? Date.now() - ctx._inputTime : 0;
      const model = getCurrentProviderModel(ctx);
      ctx._activeTrace.end(code).then(() => {
        if (ctx._sessionId) {
          const costEstimate = estimateCostUsd(ctx.adapterName, model, input, output, "");
          sessionStore.addTrace({
            id: traceId,
            sessionId: ctx._sessionId,
            input,
            output,
            provider: ctx.adapterName,
            model,
            costUsd: costEstimate.costUsd,
            durationMs,
            diffs: "",
            stderr: "",
            exitCode: code,
            timestamp: new Date().toISOString(),
          });
          wsEmit("trace.updated", { sessionId: ctx._sessionId, traceId, costUsd: costEstimate.costUsd });
          wsEmit("cost.updated", { sessionId: ctx._sessionId, costUsd: costEstimate.costUsd });
        }
      }).catch(() => {});
      ctx._activeTrace = null;
    }
    ctx._lastExitCode = code;

    // Log completed interaction
    if (ctx._lastInput && ctx._lastOutput) {
      appendTaskLog({
        prompt: ctx._lastInput,
        plan: "",
        output: ctx._lastOutput,
        status: code === 0 ? "done" : "failed",
        startedAt: ctx._inputTime ?? undefined,
      }).catch(() => {});
      ctx._lastInput = null;
      ctx._lastOutput = null;
      ctx._lastExitCode = null;
      ctx._inputTime = null;
    }
  });

  ctx.session.onIdle(() => {
    // Mark current task done and promote next
    if (ctx.taskQueue?.current()) {
      if (ctx._lastExitCode === 0 || ctx._lastExitCode === null) {
        ctx.taskQueue.markDone();
      } else {
        ctx.taskQueue.markFailed();
      }
      const next = ctx.taskQueue.current();
      if (next && ctx.session?.state() === "idle") {
        ctx._lastInput = next.prompt;
        ctx._lastOutput = null;
        ctx._lastExitCode = null;
        ctx._inputTime = Date.now();
        ctx._activeTrace = createTraceSession(ctx.adapterName, ctx.cwd, ctx._sessionId ?? "unknown", getCurrentProviderModel(ctx));
        ctx._activeTrace.begin(next.prompt);
        ctx.session.write(next.prompt);
      }
    } else {
      drainQueue();
    }

    ctx._lastExitCode = null;
  });

  ctx.session.onExit((code) => {
    if (ctx._sessionId) {
      sessionStore.endSession(ctx._sessionId, code);
      wsEmit("session.updated", { sessionId: ctx._sessionId, active: false, exitCode: code });
    }
    send(`💀 Session exited (code: ${code ?? "unknown"}).`);
    ctx.session = null;
  });
}

// Scheduler tick — call this periodically
export function tickScheduler(ctx: CommandContext, send?: SendFn) {
  // Legacy in-memory schedules
  const now = Date.now();
  const due = ctx.scheduled.filter((s) => s.time <= now);
  ctx.scheduled = ctx.scheduled.filter((s) => s.time > now);
  for (const job of due) {
    if (ctx.session) {
      if (ctx.session.state() === "processing") {
        ctx.queue.push(job.message);
      } else {
        ctx.session.write(job.message);
      }
    }
  }

  // Persistent recurring schedules
  const dueEntries = getDueSchedules();
  for (const { entry } of dueEntries) {
    markFired(entry.id);
    if (ctx.session) {
      if (send) send(`⏰ Firing scheduled: "${entry.message}"`, true).catch(() => {});
      if (ctx.session.state() === "processing") {
        ctx.queue.push(entry.message);
      } else {
        ctx._lastInput = entry.message;
        ctx._lastOutput = null;
        ctx._lastExitCode = null;
        ctx._inputTime = Date.now();
        if (ctx._sessionId) {
          ctx._activeTrace = createTraceSession(ctx.adapterName, ctx.cwd, ctx._sessionId, getCurrentProviderModel(ctx));
          ctx._activeTrace.begin(entry.message);
        }
        ctx.session.write(entry.message);
      }
    } else if (send) {
      send(`⏰ Scheduled "${entry.message}" fired but no active session. Send /start first.`).catch(() => {});
    }
  }
}
