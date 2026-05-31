import fs from "fs";
import path from "path";
import {
  createCommandContext,
  handleCommand,
  type CommandContext,
  type SendFn,
} from "../../telegram/application/handle-telegram-command.ts";
import {
  setChatBridge,
  setProjectBridge,
  setProviderBridge,
  setSessionDeleteBridge,
  setSessionNewBridge,
  setSessionStartBridge,
} from "../api/bridge-registry.ts";
import { sessionCommandRepository } from "../../server/session-command-repository.ts";
import { sessionRepository } from "../../server/session-repository.ts";

function createWebSend(ctx: CommandContext): SendFn {
  return async (text: string) => {
    const { emit: wsEmit } = await import("../../server/ws-emitter.ts");
    wsEmit("command.response", {
      sessionId: ctx._sessionId ?? "web",
      text,
    });
    return true;
  };
}

export function initializeWebBridgeRuntime(): { webCtx: CommandContext; webSend: SendFn } {
  const webCtx = createCommandContext();
  webCtx.source = "web";
  const webSend = createWebSend(webCtx);

  let startingSession: Promise<void> | null = null;

  async function ensureSession() {
    if (webCtx.session && webCtx.session.state() !== "stopped") return;
    if (startingSession) {
      await startingSession;
      return;
    }
    startingSession = handleCommand("/start", webCtx, webSend);
    try {
      await startingSession;
    } finally {
      startingSession = null;
    }
  }

  setSessionStartBridge(async () => {
    if (webCtx.session && webCtx.session.state() !== "stopped") {
      return { ok: true, message: "Session already active" };
    }
    await ensureSession();
    return { ok: true, message: "Session started" };
  });

  setSessionNewBridge(async () => {
    if (webCtx.session && webCtx.session.state() !== "stopped") {
      await handleCommand("/stop", webCtx, webSend);
    }
    await handleCommand("/start", webCtx, webSend);
    return { ok: true, sessionId: webCtx._sessionId, message: "New session started" };
  });

  setProviderBridge(async (provider: string) => {
    if (webCtx.session && webCtx.session.state() !== "stopped") {
      await handleCommand("/stop", webCtx, webSend);
    }
    webCtx.adapterName = provider;
    webCtx._lastSessionAt = 0;
    await handleCommand("/start", webCtx, webSend);
    return { ok: true, sessionId: webCtx._sessionId, message: `Started ${provider} session` };
  });

  setSessionDeleteBridge((id: string) => {
    if (webCtx._sessionId === id && webCtx.session && webCtx.session.state() !== "stopped") {
      webCtx.session.kill();
      webCtx.session = null;
      webCtx._sessionId = null;
      webCtx._lastSessionAt = 0;
      webCtx._lastInput = null;
      webCtx._lastOutput = null;
      webCtx._lastExitCode = null;
      webCtx._inputTime = null;
      webCtx._activeTrace = null;
      webCtx.pendingConfirmation = null;
      if (webCtx.taskQueue) { webCtx.taskQueue.drain(); webCtx.taskQueue = null; }
      webCtx.queue = [];
    }
  });

  setProjectBridge((dir: string) => {
    if (!dir) return { ok: true, cwd: webCtx.cwd, message: "" };
    const resolved = path.resolve(dir);
    if (!fs.existsSync(resolved)) {
      return { ok: false, cwd: webCtx.cwd, message: `Path not found: ${resolved}` };
    }
    if (webCtx.session && webCtx.session.state() !== "stopped") {
      webCtx.session.kill();
      webCtx.session = null;
    }
    webCtx.cwd = resolved;
    return { ok: true, cwd: resolved, message: `Project set to ${resolved}` };
  });

  setChatBridge(async (prompt: string, sessionId?: string) => {
    await ensureSession();
    if (!webCtx.session) {
      return { queued: false, sessionActive: false, message: "Failed to start session" };
    }
    if (sessionId && sessionId !== webCtx._sessionId) {
      // If session is processing, queue the switch — don't reassign mid-flight
      if (webCtx.session.state() === "processing") {
        // Just update the ID reference; the current process output will be attributed
        // to the old session (correct), and the new prompt goes to the new session context
        webCtx._sessionId = sessionId;
        const existing = sessionRepository.getSession(sessionId);
        if (existing) sessionCommandRepository.upsertSession({ ...existing, active: true, endedAt: undefined });
      } else {
        webCtx._sessionId = sessionId;
        const existing = sessionRepository.getSession(sessionId);
        if (existing) sessionCommandRepository.upsertSession({ ...existing, active: true, endedAt: undefined });
      }
    }
    await handleCommand(prompt, webCtx, webSend);
    return {
      queued: webCtx.session.state() === "processing",
      sessionActive: true,
      sessionId: webCtx._sessionId ?? undefined,
      message: "Sent",
    };
  });

  return { webCtx, webSend };
}
