import fs from "fs";
import path from "path";
import { createTelegramApi } from "../../telegram/infrastructure/telegram-api.ts";
import {
  createCommandContext,
  tickScheduler,
  type CommandContext,
  type SendFn,
} from "../../telegram/application/handle-telegram-command.ts";
import { readEnv, readEnvNumber, readRequiredEnv } from "../../utils/env.ts";
import { scheduleDailyClearUploads } from "../../cron/clear-uploads.ts";
import { startApiServer } from "../../interfaces/http/http-server.ts";
import { createSendFn, createWebhookServer, processUpdate, type TelegramUpdate } from "../../interfaces/telegram/update-handler.ts";
import { setGlobalNotify } from "../agent/notify-registry.ts";
import { initializeWebBridgeRuntime } from "../web/web-bridge-runtime.ts";

function installLockFile(): void {
  const lockFile = path.join(process.cwd(), "logs", ".pid");
  if (fs.existsSync(lockFile)) {
    const oldPid = parseInt(fs.readFileSync(lockFile, "utf8"), 10);
    try {
      process.kill(oldPid, 0);
      console.error(`Already running (pid ${oldPid}). Exiting.`);
      process.exit(1);
    } catch {
      // stale lock
    }
  }
  fs.mkdirSync(path.dirname(lockFile), { recursive: true });
  fs.writeFileSync(lockFile, String(process.pid));
  process.on("exit", () => {
    try {
      fs.unlinkSync(lockFile);
    } catch {}
  });
}

async function startPolling(
  api: ReturnType<typeof createTelegramApi>,
  ctx: CommandContext,
  send: SendFn,
  token: string,
  chatId: string,
  pollInterval: number
) {
  let offset = 0;
  const stale = (await api.getUpdates(-1)) as TelegramUpdate[];
  if (stale.length > 0) {
    // getUpdates adds +1 internally, so pass the last update_id to skip it
    offset = stale[stale.length - 1].update_id;
  }

  const seen = new Set<number>();
  const seenOrder: number[] = [];

  async function poll() {
    try {
      const updates = (await api.getUpdates(offset)) as TelegramUpdate[];
      for (const update of updates) {
        if (seen.has(update.update_id)) continue;
        seen.add(update.update_id);
        seenOrder.push(update.update_id);
        if (seenOrder.length > 200) seen.delete(seenOrder.shift()!);
        try {
          await processUpdate(update, ctx, send, { token, chatId });
        } catch (err) {
          console.error("[poll] processUpdate error:", err instanceof Error ? err.message : err);
        }
        offset = update.update_id;
      }
    } catch {}
    setTimeout(poll, pollInterval);
  }

  poll();
}

async function startWebhook(
  ctx: CommandContext,
  send: SendFn,
  token: string,
  chatId: string,
  webhookUrl: string,
  webhookPort: number,
  fallback: () => Promise<void>
) {
  if (!webhookUrl) {
    return fallback();
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: webhookUrl }),
    });
    const data = (await res.json()) as { ok: boolean };
    if (!data.ok) {
      return fallback();
    }
  } catch {
    return fallback();
  }

  const server = createWebhookServer((update) =>
    processUpdate(update, ctx, send, { token, chatId })
  );
  server.listen(webhookPort, () => {});
}

export async function runAgentRuntime(): Promise<void> {
  installLockFile();

  const telegramToken = readRequiredEnv("TELEGRAM_TOKEN");
  const telegramChatId = readRequiredEnv("TELEGRAM_CHAT_ID");
  const pollInterval = readEnvNumber("TELEGRAM_POLL_INTERVAL_MS", 3000);
  const mode = readEnv("TELEGRAM_MODE", "polling");
  const webhookUrl = readEnv("TELEGRAM_WEBHOOK_URL", "");
  const webhookPort = readEnvNumber("TELEGRAM_WEBHOOK_PORT", 3000);

  const api = createTelegramApi({ token: telegramToken, chatId: telegramChatId });
  const telegramCtx = createCommandContext();
  const telegramSend = createSendFn(api, telegramToken, telegramChatId);
  setGlobalNotify((msg) => { telegramSend(msg).catch(() => {}); });

  setInterval(() => tickScheduler(telegramCtx, telegramSend), 30_000);
  scheduleDailyClearUploads();
  startApiServer();

  initializeWebBridgeRuntime();

  const fallbackPolling = () =>
    startPolling(api, telegramCtx, telegramSend, telegramToken, telegramChatId, pollInterval);

  if (mode === "webhook") {
    await startWebhook(
      telegramCtx,
      telegramSend,
      telegramToken,
      telegramChatId,
      webhookUrl,
      webhookPort,
      fallbackPolling
    );
  } else {
    await fallbackPolling();
  }

  process.on("SIGINT", () => {
    if (telegramCtx.session) telegramCtx.session.kill();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    if (telegramCtx.session) telegramCtx.session.kill();
    process.exit(0);
  });
}
