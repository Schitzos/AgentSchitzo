import { execSync, spawn } from "child_process";
import { randomUUID } from "crypto";
import { getAdapter, listAdapters } from "../../adapters/index.ts";
import { createModelSession } from "../../session/model-session.ts";
import { readEnv, readEnvNumber } from "../../utils/env.ts";
import { createTaskQueue } from "../../telegram/application/task-queue.ts";
import { classifyRisk, buildApprovalPrompt } from "../../telegram/application/approval-gate.ts";
import { createTraceSession } from "../../tracing/trace-session.ts";
import { getCurrentProviderModel, type CommandContext } from "../../domain/agent/command-context.ts";
import { sessionCommandRepository } from "../../server/session-command-repository.ts";
import { emit as wsEmit } from "../../server/ws-emitter.ts";
import { wireSession } from "./session-events.ts";

export interface SendFn {
  (text: string, silent?: boolean): Promise<boolean>;
}

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
      } catch {}
    }
  } else if (process.platform === "win32") {
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
    } catch {}
  }
  return null;
}

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
      } catch {}
    }
  } else if (process.platform === "win32") {
    try {
      execSync(`powershell -NoProfile -STA -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('^w')"`, { timeout: 3000, stdio: ["pipe", "pipe", "pipe"] });
    } catch {}
  }
}

export async function replayCallbackUrl(url: string, ctx: CommandContext, send: SendFn) {
  const parsed = new URL(url);
  const port = parsed.port || "3000";
  const localUrl = `http://127.0.0.1:${port}${parsed.pathname}${parsed.search}`;
  await send("🔄 Replaying callback locally...");

  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await fetch(localUrl, { redirect: "manual" });
      lastErr = null;
      break;
    } catch (error) {
      lastErr = error as Error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  if (lastErr) {
    await send(`❌ Failed to reach local server after 3 attempts: ${lastErr.message}`);
    return;
  }

  if (parsed.pathname.includes("/oauth/callback") || parsed.searchParams.has("code")) {
    await send("⏳ OAuth callback replayed. Waiting for login to complete...");
    return;
  }

  await new Promise((resolve) => setTimeout(resolve, 1500));
  const fullUrl = captureLoginUrl();
  if (fullUrl && /awsapps\.com/i.test(fullUrl)) {
    await send(`🔑 Now authenticate here:\n${fullUrl}\n\nAfter you authorize, paste the failed localhost URL back here.`);
    closeBrowserTab();
    return;
  }

  for (let i = 0; i < 3; i++) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const retry = captureLoginUrl();
    if (retry && /awsapps\.com/i.test(retry)) {
      await send(`🔑 Now authenticate here:\n${retry}\n\nAfter you authorize, paste the failed localhost URL back here.`);
      closeBrowserTab();
      return;
    }
  }

  await send("⚠️ Could not capture the auth URL. Check your browser for the AWS login page, authenticate there, then paste the failed localhost redirect URL back here.");
  closeBrowserTab();
}

async function spawnLoginFlow(ctx: CommandContext, send: SendFn, startSession: () => Promise<void>) {
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
  let lastDetectedUrl: string | null = null;

  proc.stdout?.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    if (adapter.detectLoginUrl) {
      const url = adapter.detectLoginUrl(text);
      if (url) {
        lastDetectedUrl = url;
        send(`🔑 Open this link to log in:\n${url}\n\nAfter authenticating, paste the failed localhost redirect URL back here.`);
      }
    }
  });

  proc.stderr?.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    if (adapter.detectLoginUrl) {
      const url = adapter.detectLoginUrl(text);
      if (url) {
        lastDetectedUrl = url;
        send(`🔑 Open this link to log in:\n${url}\n\nAfter authenticating, paste the failed localhost redirect URL back here.`);
      }
    }
  });

  proc.on("exit", (code) => {
    clearTimeout(timeout);
    ctx.loginExitedAt = Date.now();
    if (code === 0 && ctx.loginProc === proc) {
      ctx.loginProc = null;
      ctx.lastReplayedUrl = null;
      send("✅ Login successful!");
      startSession();
    } else if (ctx.loginProc === proc) {
      ctx.loginProc = null;
      ctx.lastReplayedUrl = null;
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

export async function startSession(ctx: CommandContext, send: SendFn) {
  if (ctx.session && ctx.session.state() !== "stopped") return;
  const now = Date.now();
  if (now - ctx._lastSessionAt < 5000) {
    await send("⏳ Session is starting, please wait...");
    return;
  }
  ctx._lastSessionAt = now;
  const adapter = getAdapter(ctx.adapterName);
  const timeoutMs = readEnvNumber("KIRO_TIMEOUT_MS", 300_000);
  const sessionId = randomUUID();
  ctx._sessionId = sessionId;
  const model = getCurrentProviderModel(ctx);
  ctx.session = createModelSession({ adapter, cwd: ctx.cwd, model, timeoutMs });
  wireSession(ctx, send);
  ctx.session.start();

  const sessionDto = {
    id: sessionId,
    name: ctx.source === "telegram" ? "📱 Telegram" : "New Session",
    provider: ctx.adapterName,
    model,
    cwd: ctx.cwd,
    startedAt: new Date().toISOString(),
    active: true,
  };
  sessionCommandRepository.upsertSession(sessionDto);
  wsEmit("session.started", sessionDto as Record<string, unknown>);
  await send(`✅ Started ${adapter.name} (${model}) in ${ctx.cwd}`);
}

export async function cmdStart(text: string, ctx: CommandContext, send: SendFn) {
  if (ctx.session && ctx.session.state() !== "stopped") {
    await send("Session already running. Send /stop first.");
    return;
  }

  const arg = text.replace("/start", "").trim();
  if (arg) {
    try {
      getAdapter(arg);
      ctx.adapterName = arg;
    } catch {
      await send(`Unknown provider: ${arg}. Available: ${listAdapters().join(", ")}`);
      return;
    }
  }

  if (ctx.loginProc) {
    ctx.loginProc.kill();
    ctx.loginProc = null;
  }

  if (ctx.adapterName !== "kiro") {
    await startSession(ctx, send);
    return;
  }

  try {
    execSync("kiro-cli whoami", { timeout: 5000, stdio: ["pipe", "pipe", "pipe"] });
    await startSession(ctx, send);
    return;
  } catch {}

  await spawnLoginFlow(ctx, send, () => startSession(ctx, send));
}

export async function cmdStop(ctx: CommandContext, send: SendFn) {
  if (ctx.loginProc) {
    ctx.loginProc.kill();
    ctx.loginProc = null;
  }
  if (!ctx.session) {
    await send("No active session.");
    return;
  }
  // Mark session ended in DB before clearing _sessionId so onExit doesn't miss it
  if (ctx._sessionId) {
    sessionCommandRepository.endSession(ctx._sessionId, 0);
    wsEmit("session.updated", { sessionId: ctx._sessionId, active: false, exitCode: 0 });
  }
  ctx.session.kill();
  ctx.session = null;
  ctx._sessionId = null;
  ctx._lastSessionAt = 0;
  ctx.queue = [];
  if (ctx.taskQueue) ctx.taskQueue.drain();
  if (ctx.adapterName === "kiro") {
    try {
      execSync("kiro-cli logout", { timeout: 10_000 });
    } catch {}
  }
  await send("🛑 Session stopped and logged out. Next /start will require a new login.");
}

export async function cmdInterrupt(ctx: CommandContext, send: SendFn) {
  if (!ctx.session) {
    await send("No active session.");
    return;
  }
  ctx.session.interrupt();
  await send("⚡ Interrupt sent.");
}

export async function forwardInput(input: string, ctx: CommandContext, send: SendFn) {
  const loginActive = ctx.loginProc || (ctx.loginExitedAt && Date.now() - ctx.loginExitedAt < 30_000);
  if (loginActive && /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(input)) {
    if (ctx.lastReplayedUrl === input) return;
    ctx.lastReplayedUrl = input;
    await replayCallbackUrl(input, ctx, send);
    return;
  }

  if (ctx.session) {
    if (ctx.session.state() === "processing") {
      if (!ctx.taskQueue) ctx.taskQueue = createTaskQueue(send, () => ctx.session?.state() === "idle");
      ctx.taskQueue.enqueue(input);
      return;
    }
    if (classifyRisk(input) === "high") {
      ctx.pendingConfirmation = input;
      await send(buildApprovalPrompt(input));
      return;
    }
    ctx._lastInput = input;
    ctx._lastOutput = null;
    ctx._lastExitCode = null;
    ctx._inputTime = Date.now();
    ctx._activeTrace = createTraceSession(
      ctx.adapterName,
      ctx.cwd,
      ctx._sessionId ?? "unknown",
      getCurrentProviderModel(ctx)
    );
    ctx._activeTrace.begin(input);
    const accepted = ctx.session.write(input);
    if (!accepted) {
      ctx._activeTrace = null;
      ctx._lastInput = null;
      ctx._inputTime = null;
    }
    return;
  }

  if (ctx.loginProc) {
    await send("⏳ Login in progress. Paste the localhost callback URL to complete.");
    return;
  }

  await send("No active session. Send /start to begin.");
}
