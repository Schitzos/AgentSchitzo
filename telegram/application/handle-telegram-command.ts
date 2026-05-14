import type { ModelSession } from "../../session/model-session.ts";
import { createModelSession } from "../../session/model-session.ts";
import { getAdapter, listAdapters } from "../../adapters/index.ts";
import { readEnv, readEnvNumber } from "../../utils/env.ts";
import { execSync, spawn } from "child_process";
import fs from "fs";
import path from "path";
import { createTaskQueue, type TaskQueue } from "./task-queue.ts";
import { searchTaskLog, appendTaskLog, type TaskLogEntry } from "../infrastructure/task-log.ts";

const DESTRUCTIVE_KEYWORDS = /\b(delete|drop|force push|rm -rf|reset --hard)\b/i;
const MAX_MSG_LEN = 4096;

export interface CommandContext {
  session: ModelSession | null;
  queue: string[];
  taskQueue: TaskQueue | null;
  verbose: boolean;
  history: string[];
  scheduled: { time: number; message: string }[];
  cwd: string;
  adapterName: string;
  pendingConfirmation: string | null;
  loginProc: import("child_process").ChildProcess | null;
  lastReplayedUrl: string | null;
  _lastInput: string | null;
  _lastOutput: string | null;
  _inputTime: number | null;
}

export function createCommandContext(): CommandContext {
  return {
    session: null,
    queue: [],
    taskQueue: null,
    verbose: false,
    history: [],
    scheduled: [],
    cwd: process.cwd(),
    adapterName: readEnv("MODEL_ADAPTER", "kiro"),
    pendingConfirmation: null,
    loginProc: null,
    lastReplayedUrl: null,
    _lastInput: null,
    _lastOutput: null,
    _inputTime: null,
  };
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
      ctx.pendingConfirmation = null;
      await send("✅ Confirmed. Resuming.");
      return;
    }
    if (trimmed === "/no") {
      ctx.pendingConfirmation = null;
      /* istanbul ignore next */ ctx.session?.interrupt();
      await send("❌ Cancelled. Sent interrupt.");
      return;
    }
  }

  // Commands
  if (trimmed === "/start") return cmdStart(ctx, send);
  if (trimmed === "/stop") return cmdStop(ctx, send);
  if (trimmed === "/interrupt") return cmdInterrupt(ctx, send);
  if (trimmed === "/status") return cmdStatus(ctx, send);
  if (trimmed === "/verbose") return cmdVerbose(ctx, send);
  if (trimmed.startsWith("/history")) return cmdHistory(trimmed, ctx, send);
  if (trimmed === "/help") return cmdHelp(ctx, send);
  if (trimmed === "/undo") return cmdUndo(ctx, send);
  if (trimmed.startsWith("/model")) return cmdModel(trimmed, ctx, send);
  if (trimmed.startsWith("/project ")) return cmdProject(trimmed, ctx, send);
  if (trimmed.startsWith("/schedule")) return cmdSchedule(trimmed, ctx, send);

  // Forward to session
  const input = trimmed.startsWith("> ") ? trimmed.slice(2) : trimmed;

  // Detect pasted localhost callback URL from login flow
  /* istanbul ignore next -- replayCallbackUrl is integration-tested separately */
  if (ctx.loginProc && /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(input)) {
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
    ctx._lastInput = input;
    ctx._lastOutput = null;
    ctx._inputTime = Date.now();
    ctx.session.write(input);
    return;
  }

  if (ctx.loginProc) {
    await send("⏳ Login in progress. Paste the localhost callback URL to complete.");
    return;
  }
  await send("No active session. Send /start to begin.");
}

async function cmdStart(ctx: CommandContext, send: SendFn) {
  if (ctx.session && ctx.session.state() !== "stopped") {
    await send("Session already running. Send /stop first.");
    return;
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

  proc.on("exit", (code) => {
    clearTimeout(timeout);
    if (code === 0 && ctx.loginProc === proc) {
      ctx.loginProc = null;
      ctx.lastReplayedUrl = null;
      send("✅ Login successful!");
      startSession(ctx, send);
    } else if (ctx.loginProc === proc) {
      ctx.loginProc = null;
      ctx.lastReplayedUrl = null;
    }
  });

  setTimeout(async () => {
    if (ctx.loginProc !== proc) return;
    const url = captureLoginUrl();
    if (url) {
      await send(`🔑 Open this link to log in:\n${url}\n\nAfter authenticating, paste the failed localhost redirect URL back here.`);
      closeBrowserTab();
    } else {
      await send("🌐 Browser opened. Copy the signin URL from your browser, authenticate on your phone, then paste the failed localhost URL back here.");
    }
  }, 3000);
}

/* istanbul ignore next -- platform-specific AppleScript, not unit-testable */
function captureLoginUrl(): string | null {
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
  return null;
}

/* istanbul ignore next -- platform-specific AppleScript, not unit-testable */
function closeBrowserTab(): void {
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
}

/* istanbul ignore next -- integration-level login replay, requires live server */
async function replayCallbackUrl(url: string, ctx: CommandContext, send: SendFn) {
  const parsed = new URL(url);
  const port = parsed.port || "3128";
  const localUrl = `http://127.0.0.1:${port}${parsed.pathname}${parsed.search}`;
  await send("🔄 Replaying callback locally...");
  try {
    await fetch(localUrl, { redirect: "manual" });
    // If this is the OAuth callback (from IAM IdC), login should complete automatically
    if (parsed.pathname.includes("/oauth/callback") || parsed.searchParams.has("code")) {
      await send("⏳ OAuth callback replayed. Waiting for login to complete...");
      return;
    }
    // First callback (signin) — poll for the IAM IdC URL that opens in browser
    let attempts = 0;
    const maxAttempts = 10;
    const interval = setInterval(async () => {
      attempts++;
      if (!ctx.loginProc || attempts > maxAttempts) {
        clearInterval(interval);
        if (attempts > maxAttempts && ctx.loginProc) {
          await send("⏳ Waiting for login to complete...");
        }
        return;
      }
      const nextUrl = captureLoginUrl();
      if (nextUrl && nextUrl.includes("awsapps.com/start")) {
        clearInterval(interval);
        await send(`🔑 Now authenticate here:\n${nextUrl}\n\nAfter you authorize, paste the failed localhost URL back here.`);
        closeBrowserTab();
      }
    }, 2000);
  } catch (e) {
    await send(`❌ Failed to reach local server: ${(e as Error).message}`);
  }
}

async function startSession(ctx: CommandContext, send: SendFn) {
  const adapter = getAdapter(ctx.adapterName);
  const timeoutMs = readEnvNumber("KIRO_TIMEOUT_MS", 300_000);
  ctx.session = createModelSession({ adapter, cwd: ctx.cwd, timeoutMs });
  wireSession(ctx, send);
  ctx.session.start();
  await send(`✅ Started ${adapter.name} session in ${ctx.cwd}`);
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
    const dur = e.durationMs ? `${(e.durationMs / 1000).toFixed(1)}s` : "?";
    const icon = e.status === "done" ? "✅" : "❌";
    return `${icon} #${e.id} [${dur}] ${e.prompt.slice(0, 60)}`;
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

async function cmdUndo(ctx: CommandContext, send: SendFn) {
  if (!ctx.session) {
    await send("No active session.");
    return;
  }
  ctx.session.write("revert the last change you made");
  await send("↩️ Undo requested.", true);
}

async function cmdModel(text: string, ctx: CommandContext, send: SendFn) {
  const arg = text.replace("/model", "").trim();
  if (!arg) {
    await send(
      `Current: ${ctx.adapterName}\nAvailable: ${listAdapters().join(", ")}`
    );
    return;
  }
  // Validate adapter exists
  try {
    getAdapter(arg);
  } catch {
    await send(`Unknown adapter "${arg}". Available: ${listAdapters().join(", ")}`);
    return;
  }
  // Hot-swap
  if (ctx.session && ctx.session.state() !== "stopped") {
    ctx.session.kill();
    ctx.session = null;
  }
  ctx.adapterName = arg;
  await send(`Switched to ${arg}. Send /start to begin.`);
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

async function cmdSchedule(text: string, ctx: CommandContext, send: SendFn) {
  const arg = text.replace("/schedule", "").trim();
  if (!arg) {
    if (ctx.scheduled.length === 0) {
      await send("No scheduled commands.");
      return;
    }
    const list = ctx.scheduled
      .map((s) => {
        const d = new Date(s.time);
        return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")} — ${s.message}`;
      })
      .join("\n");
    await send(list);
    return;
  }
  const match = arg.match(/^(\d{2}):(\d{2})\s+(.+)$/);
  if (!match) {
    await send("Usage: /schedule HH:MM <message>");
    return;
  }
  const now = new Date();
  const target = new Date(now);
  target.setHours(parseInt(match[1]), parseInt(match[2]), 0, 0);
  if (target.getTime() <= now.getTime()) target.setDate(target.getDate() + 1);
  ctx.scheduled.push({ time: target.getTime(), message: match[3] });
  await send(`⏰ Scheduled for ${match[1]}:${match[2]}: "${match[3]}"`);
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
  // Remove code fences and their content
  out = out.replace(/```[\s\S]*?```/g, "");
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

    // Destructive action check
    if (DESTRUCTIVE_KEYWORDS.test(text) && !ctx.pendingConfirmation) {
      ctx.pendingConfirmation = text;
      const preview = text.slice(0, 200);
      send(`⚠️ Destructive action detected:\n${preview}\n\nReply /yes or /no`);
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
        for (const part of splitMessage(reply)) {
          send(part).catch(() => {});
        }
      }
    }
  });

  ctx.session.onLoginUrl((url) => {
    send(`🔑 Login required:\n${url}`);
  });

  ctx.session.onIdle(() => {
    // Log completed interaction
    if (ctx._lastInput && ctx._lastOutput) {
      appendTaskLog({
        prompt: ctx._lastInput,
        plan: "",
        output: ctx._lastOutput,
        status: "done",
        startedAt: ctx._inputTime ?? undefined,
      }).catch(() => {});
      ctx._lastInput = null;
      ctx._lastOutput = null;
      ctx._inputTime = null;
    }

    // Mark current task done and promote next
    if (ctx.taskQueue?.current()) {
      ctx.taskQueue.markDone();
      const next = ctx.taskQueue.current();
      if (next && ctx.session?.state() === "idle") {
        ctx._lastInput = next.prompt;
        ctx._lastOutput = null;
        ctx._inputTime = Date.now();
        ctx.session.write(next.prompt);
      }
    } else {
      drainQueue();
    }
  });

  ctx.session.onExit((code) => {
    if (ctx.taskQueue?.current()) {
      ctx.taskQueue.markFailed();
    }
    send(`💀 Session exited (code: ${code ?? "unknown"}).`);
    ctx.session = null;
  });
}

// Scheduler tick — call this periodically
export function tickScheduler(ctx: CommandContext) {
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
}
