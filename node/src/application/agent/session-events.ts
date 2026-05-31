import { randomUUID } from "crypto";
import { appendTaskLog } from "../../telegram/infrastructure/task-log.ts";
import { estimateCostUsd } from "../../tracing/model-pricing.ts";
import { sessionCommandRepository } from "../../server/session-command-repository.ts";
import { emit as wsEmit } from "../../server/ws-emitter.ts";
import { getCurrentProviderModel, type CommandContext } from "../../domain/agent/command-context.ts";
import { createTraceSession } from "../../tracing/trace-session.ts";
import { extractHumanReply, splitMessage } from "./output-utils.ts";
import { checkBudget } from "./budget.ts";
import { globalNotify } from "./notify-registry.ts";
import { getProviderTotalCost } from "../../server/db.ts";

const DESTRUCTIVE_KEYWORDS = /\b(delete|drop|force push|rm -rf|reset --hard)\b/i;

export interface SendFn {
  (text: string, silent?: boolean): Promise<boolean>;
}

export function wireSession(ctx: CommandContext, send: SendFn) {
  if (!ctx.session) return;

  function drainQueue() {
    if (ctx.taskQueue) {
      const next = ctx.taskQueue.current();
      if (next && next.status === "running" && ctx.session?.state() === "idle") {
        ctx._lastInput = next.prompt;
        ctx._lastOutput = null;
        ctx._lastExitCode = null;
        ctx._inputTime = Date.now();
        ctx._activeTrace = createTraceSession(ctx.adapterName, ctx.cwd, ctx._sessionId ?? "unknown", getCurrentProviderModel(ctx));
        ctx._activeTrace.begin(next.prompt);
        ctx.session.write(next.prompt);
      }
    } else if (ctx.queue.length > 0 && ctx.session?.state() === "idle") {
      const next = ctx.queue.shift()!;
      ctx._lastInput = next;
      ctx._lastOutput = null;
      ctx._lastExitCode = null;
      ctx._inputTime = Date.now();
      if (ctx._sessionId) {
        ctx._activeTrace = createTraceSession(ctx.adapterName, ctx.cwd, ctx._sessionId, getCurrentProviderModel(ctx));
        ctx._activeTrace.begin(next);
      }
      ctx.session.write(next);
    }
  }

  ctx.session.onOutput((text) => {
    if (/^[\s▰▱░▓█⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏|\\\/\-]*(?:Opening browser|Press \(\^\)|Waiting|Loading|Connecting)/i.test(text.trim())) {
      if (ctx.session) {
        ctx.session.kill();
        ctx.session = null;
        ctx._sessionId = null;
      }
      // Clean up dangling trace and task queue
      if (ctx._activeTrace) {
        ctx._activeTrace.end(null).catch(() => {});
        ctx._activeTrace = null;
      }
      if (ctx.taskQueue) { ctx.taskQueue.drain(); ctx.taskQueue = null; }
      ctx.queue = [];
      ctx._lastInput = null;
      ctx._lastOutput = null;
      ctx._lastExitCode = null;
      ctx._inputTime = null;
      send("🛑 Session requires login. Send /start to authenticate.").catch(() => {});
      return;
    }

    if (ctx._activeTrace) ctx._activeTrace.captureOutput(text);

    wsEmit("session.output", { sessionId: ctx._sessionId, text: text.slice(0, 500) });

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
    } else if (ctx.source !== "web") {
      const reply = extractHumanReply(text);
      if (reply && reply.length >= 5) {
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
    const traceId = randomUUID();
    const input = ctx._lastInput ?? "";
    const output = ctx._lastOutput ?? "";
    const durationMs = ctx._inputTime ? Date.now() - ctx._inputTime : 0;
    const model = getCurrentProviderModel(ctx);

    const finalize = (trace: typeof ctx._activeTrace) => {
      const endPromise = trace ? trace.end(code) : Promise.resolve();
      endPromise.then(() => {
        if (ctx._sessionId) {
          const costEstimate = estimateCostUsd(ctx.adapterName, model, input, output, "");
          sessionCommandRepository.addTrace({
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
          // Budget check — monthly spend for this provider
          checkBudget(ctx.adapterName, getProviderTotalCost, globalNotify);
        }
      }).catch(() => {
        // Still emit trace.updated even if trace finalization fails
        if (ctx._sessionId) {
          const costEstimate = estimateCostUsd(ctx.adapterName, model, input, output, "");
          sessionCommandRepository.addTrace({
            id: traceId, sessionId: ctx._sessionId, input, output,
            provider: ctx.adapterName, model, costUsd: costEstimate.costUsd,
            durationMs, diffs: "", stderr: "", exitCode: code,
            timestamp: new Date().toISOString(),
          });
          wsEmit("trace.updated", { sessionId: ctx._sessionId, traceId, costUsd: costEstimate.costUsd });
        }
      });
    };

    finalize(ctx._activeTrace);
    ctx._activeTrace = null;

    ctx._lastExitCode = code;
    if (input && output) {
      appendTaskLog({ prompt: input, plan: "", output, status: code === 0 ? "done" : "failed", startedAt: ctx._inputTime ?? undefined }).catch(() => {});
    }
    ctx._lastInput = null;
    ctx._lastOutput = null;
    ctx._inputTime = null;
  });

  ctx.session.onIdle(() => {
    if (ctx.taskQueue?.current()) {
      // Read exit code before clearing it
      const exitCode = ctx._lastExitCode;
      ctx._lastExitCode = null;
      if (exitCode === 0 || exitCode === null) {
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
      ctx._lastExitCode = null;
      drainQueue();
    }
  });

  ctx.session.onExit((code) => {
    if (ctx._sessionId) {
      sessionCommandRepository.endSession(ctx._sessionId, code);
      wsEmit("session.updated", { sessionId: ctx._sessionId, active: false, exitCode: code });
    }
    send(`💀 Session exited (code: ${code ?? "unknown"}).`);
    ctx.session = null;
  });
}
