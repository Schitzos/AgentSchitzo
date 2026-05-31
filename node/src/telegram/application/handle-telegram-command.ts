import {
  createCommandContext as createAgentCommandContext,
  getCurrentProviderModel,
  type CommandContext,
} from "../../domain/agent/command-context.ts";
import {
  extractHumanReply as extractHumanReplyValue,
  isSummaryOutput as isSummaryOutputValue,
  normalizeOutput as normalizeOutputValue,
  splitMessage as splitMessageValue,
} from "../../application/agent/output-utils.ts";
import { tickScheduler as runScheduler, type SendFn as SchedulerSendFn } from "../../application/agent/scheduler-runner.ts";
import {
  cmdHelp,
  cmdHistory,
  cmdModel,
  cmdProject,
  cmdProvider,
  cmdSchedule,
  cmdStatus,
  cmdUndo,
  cmdVerbose,
} from "../../application/agent/command-actions.ts";
import {
  cmdInterrupt,
  cmdStart,
  cmdStop,
  forwardInput,
} from "../../application/agent/session-lifecycle.ts";
import { createTraceSession } from "../../tracing/trace-session.ts";

export function createCommandContext(): CommandContext {
  return createAgentCommandContext();
}

export type { CommandContext };

export const splitMessage = splitMessageValue;
export const normalizeOutput = normalizeOutputValue;
export const isSummaryOutput = isSummaryOutputValue;
export const extractHumanReply = extractHumanReplyValue;

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
        const trace = createTraceSession(ctx.adapterName, ctx.cwd, ctx._sessionId ?? "unknown", getCurrentProviderModel(ctx));
        ctx._activeTrace = trace;
        trace.begin(held);
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
  if (trimmed.startsWith("/history")) return cmdHistory(trimmed, send);
  if (trimmed === "/help") return cmdHelp(send);
  if (trimmed.startsWith("/provider")) return cmdProvider(trimmed, ctx, send, () => cmdStart("/start", ctx, send));
  if (trimmed === "/undo") return cmdUndo(ctx, send);
  if (trimmed.startsWith("/model")) return cmdModel(trimmed, ctx, send, () => cmdStart("/start", ctx, send));
  if (trimmed.startsWith("/project")) return cmdProject(trimmed, ctx, send);
  if (trimmed.startsWith("/schedule")) return cmdSchedule(trimmed, send);

  const input = trimmed.startsWith("> ") ? trimmed.slice(2) : trimmed;
  return forwardInput(input, ctx, send);
}

// Scheduler tick — call this periodically
export function tickScheduler(ctx: CommandContext, send?: SendFn) {
  runScheduler(ctx, send as SchedulerSendFn | undefined);
}
