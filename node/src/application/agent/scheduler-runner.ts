import { getDueSchedules, markFired } from "../../scheduler/persistent-scheduler.ts";
import type { CommandContext } from "../../domain/agent/command-context.ts";
import { createTraceSession } from "../../tracing/trace-session.ts";
import { getCurrentProviderModel } from "../../domain/agent/command-context.ts";

export interface SendFn {
  (text: string, silent?: boolean): Promise<boolean>;
}

export function tickScheduler(ctx: CommandContext, send?: SendFn) {
  const now = Date.now();
  const due = ctx.scheduled.filter((schedule) => schedule.time <= now);
  ctx.scheduled = ctx.scheduled.filter((schedule) => schedule.time > now);
  for (const job of due) {
    if (ctx.session) {
      if (ctx.session.state() === "processing") {
        ctx.queue.push(job.message);
      } else {
        ctx.session.write(job.message);
      }
    }
  }

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
