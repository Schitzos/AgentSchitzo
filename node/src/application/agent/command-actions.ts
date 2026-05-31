import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { getAdapter, listAdapters } from "../../adapters/index.ts";
import { loadSchedules, addSchedule, removeSchedule, formatSchedule, type ScheduleType } from "../../scheduler/persistent-scheduler.ts";
import { searchTaskLog, formatLogDate, type TaskLogEntry } from "../../telegram/infrastructure/task-log.ts";
import { CODEX_MODELS, formatCodexModels, KIRO_MODELS } from "../../domain/agent/model-catalog.ts";
import { getCurrentProviderModel, setCurrentProviderModel, type CommandContext } from "../../domain/agent/command-context.ts";

export interface SendFn {
  (text: string, silent?: boolean): Promise<boolean>;
}

export async function cmdStatus(ctx: CommandContext, send: SendFn) {
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

export async function cmdVerbose(ctx: CommandContext, send: SendFn) {
  ctx.verbose = !ctx.verbose;
  await send(`Verbose mode: ${ctx.verbose ? "ON" : "OFF"}`);
}

export async function cmdHistory(text: string, send: SendFn) {
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
  const lines = entries.map((entry) => {
    const date = formatLogDate(new Date(entry.timestamp));
    const icon = entry.status === "done" ? "✅" : "❌";
    return `${icon} #${entry.id} [${date}] ${entry.prompt.slice(0, 60)}`;
  });
  await send(lines.join("\n"));
}

export async function cmdHelp(send: SendFn) {
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

export async function cmdProvider(
  text: string,
  ctx: CommandContext,
  send: SendFn,
  restart: () => Promise<void>
) {
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
  await restart();
}

export async function cmdUndo(ctx: CommandContext, send: SendFn) {
  if (!ctx.session) {
    await send("No active session.");
    return;
  }
  ctx.session.write("revert the last change you made");
  await send("↩️ Undo requested.", true);
}

export async function cmdModel(
  text: string,
  ctx: CommandContext,
  send: SendFn,
  restart: () => Promise<void>
) {
  const arg = text.replace("/model", "").trim();
  if (!arg) {
    let models = "";
    try {
      const out = execSync("kiro-cli chat --list-models --format json", { timeout: 10000, encoding: "utf-8" });
      const data = JSON.parse(out);
      models = data.models.map((model: { model_name: string; rate_multiplier: number; description: string }) =>
        `• ${model.model_name === getCurrentProviderModel(ctx) ? "▸ " : ""}${model.model_name} (${model.rate_multiplier}x) — ${model.description}`
      ).join("\n");
    } catch {}
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

  if (ctx.adapterName === "kiro" && KIRO_MODELS.includes(arg)) {
    setCurrentProviderModel(ctx, arg);
    if (ctx.session && ctx.session.state() !== "stopped") {
      ctx.session.kill();
      ctx.session = null;
      ctx._lastSessionAt = 0;
      await send(`Switched to ${arg}. Restarting session...`);
      await restart();
      return;
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
      await restart();
      return;
    }
    await send(`Model set to ${arg}. Send /start to begin.`);
    return;
  }

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

export async function cmdProject(text: string, ctx: CommandContext, send: SendFn) {
  const dir = text.replace("/project", "").trim();
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

export async function cmdSchedule(text: string, send: SendFn) {
  const arg = text.replace("/schedule", "").trim();

  if (!arg) {
    const entries = loadSchedules();
    if (entries.length === 0) {
      await send("No scheduled commands.");
      return;
    }
    await send(entries.map(formatSchedule).join("\n"));
    return;
  }

  const removeMatch = arg.match(/^remove\s+(\d+)$/i);
  if (removeMatch) {
    const removed = removeSchedule(parseInt(removeMatch[1]));
    await send(removed ? "✅ Schedule removed." : "❌ Schedule not found.");
    return;
  }

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
