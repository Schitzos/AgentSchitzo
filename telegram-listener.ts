import http from "http";
import fs from "fs";
import path from "path";
import { createTelegramApi } from "./telegram/infrastructure/telegram-api.ts";
import {
  handleCommand,
  createCommandContext,
  tickScheduler,
  type CommandContext,
  type SendFn,
} from "./telegram/application/handle-telegram-command.ts";
import { readEnv, readEnvNumber, readRequiredEnv } from "./utils/env.ts";

export interface TelegramUpdate {
  update_id: number;
  message?: {
    chat?: { id: number };
    text?: string;
    document?: { file_id: string; file_name?: string };
    photo?: { file_id: string }[];
    voice?: { file_id: string };
  };
}

export interface AppDependencies {
  token: string;
  chatId: string;
  pollInterval: number;
  mode: string;
  webhookUrl: string;
  webhookPort: number;
  fetchFn?: typeof fetch;
}

export function createSendFn(
  api: ReturnType<typeof createTelegramApi>,
  token: string,
  chatId: string,
  fetchFn: typeof fetch = fetch
): SendFn {
  return async (text: string, silent = false): Promise<boolean> => {
    if (silent) {
      try {
        const res = await fetchFn(
          `https://api.telegram.org/bot${token}/sendMessage`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: chatId,
              text,
              disable_notification: true,
            }),
          }
        );
        return res.ok;
      } catch {
        return false;
      }
    }
    return api.sendMessage(text);
  };
}

export async function downloadFile(
  fileId: string,
  token: string,
  uploadsDir: string,
  /* istanbul ignore next */ fetchFn: typeof fetch = fetch
): Promise<string | null> {
  try {
    const res = await fetchFn(
      `https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`
    );
    const data = (await res.json()) as { ok: boolean; result?: { file_path?: string } };
    if (!data.ok || !data.result?.file_path) return null;

    const fileUrl = `https://api.telegram.org/file/bot${token}/${data.result.file_path}`;
    const fileRes = await fetchFn(fileUrl);
    if (!fileRes.ok) return null;

    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

    const filename = path.basename(data.result.file_path);
    const dest = path.join(uploadsDir, filename);
    const buffer = Buffer.from(await fileRes.arrayBuffer());
    fs.writeFileSync(dest, buffer);
    return dest;
  } catch {
    return null;
  }
}

export async function processUpdate(
  update: TelegramUpdate,
  ctx: CommandContext,
  send: SendFn,
  deps: { token: string; chatId: string; fetchFn?: typeof fetch }
): Promise<void> {
  const msg = update.message;
  if (!msg || String(msg.chat?.id) !== deps.chatId) return;

  const uploadsDir = path.join(ctx.cwd, "uploads");
  const fetchFn = deps.fetchFn ?? fetch;

  if (msg.document) {
    const filePath = await downloadFile(msg.document.file_id, deps.token, uploadsDir, fetchFn);
    if (filePath && ctx.session) {
      ctx.session.write(`User uploaded file: ${filePath}`);
      await send(`📎 File saved: ${filePath}`, true);
    }
    return;
  }
  if (msg.photo && msg.photo.length > 0) {
    const fileId = msg.photo[msg.photo.length - 1].file_id;
    const filePath = await downloadFile(fileId, deps.token, uploadsDir, fetchFn);
    if (filePath && ctx.session) {
      ctx.session.write(`User uploaded photo: ${filePath}`);
      await send(`📷 Photo saved: ${filePath}`, true);
    }
    return;
  }
  if (msg.voice) {
    const filePath = await downloadFile(msg.voice.file_id, deps.token, uploadsDir, fetchFn);
    if (filePath && ctx.session) {
      ctx.session.write(`User uploaded voice: ${filePath}`);
      await send(`🎤 Voice saved: ${filePath}`, true);
    }
    return;
  }

  if (msg.text) {
    await handleCommand(msg.text, ctx, send);
  }
}

export function createWebhookServer(
  processUpdateFn: (update: TelegramUpdate) => Promise<void>
): http.Server {
  return http.createServer(async (req, res) => {
    if (req.method === "POST") {
      let body = "";
      req.on("data", (chunk: Buffer) => (body += chunk));
      req.on("end", async () => {
        try {
          const update = JSON.parse(body) as TelegramUpdate;
          await processUpdateFn(update);
        } catch { /* ignore malformed */ }
        res.writeHead(200);
        res.end("ok");
      });
    } else {
      res.writeHead(200);
      res.end("AgentSchitzo webhook active");
    }
  });
}

// --- Main entrypoint (only runs when executed directly) ---
const isMainModule = process.argv[1]?.endsWith("telegram-listener.ts") ||
  process.argv[1]?.endsWith("telegram-listener.js");

/* istanbul ignore next -- bootstrap code not unit-testable */
if (isMainModule) {
  const LOCK_FILE = path.join(process.cwd(), "logs", ".pid");
  if (fs.existsSync(LOCK_FILE)) {
    const oldPid = parseInt(fs.readFileSync(LOCK_FILE, "utf8"), 10);
    try { process.kill(oldPid, 0); console.error(`Already running (pid ${oldPid}). Exiting.`); process.exit(1); } catch { /* stale lock */ }
  }
  fs.mkdirSync(path.dirname(LOCK_FILE), { recursive: true });
  fs.writeFileSync(LOCK_FILE, String(process.pid));
  process.on("exit", () => { try { fs.unlinkSync(LOCK_FILE); } catch {} });

  const TELEGRAM_TOKEN = readRequiredEnv("TELEGRAM_TOKEN");
  const TELEGRAM_CHAT_ID = readRequiredEnv("TELEGRAM_CHAT_ID");
  const POLL_INTERVAL = readEnvNumber("TELEGRAM_POLL_INTERVAL_MS", 3000);
  const MODE = readEnv("TELEGRAM_MODE", "polling");
  const WEBHOOK_URL = readEnv("TELEGRAM_WEBHOOK_URL", "");
  const WEBHOOK_PORT = readEnvNumber("TELEGRAM_WEBHOOK_PORT", 3000);

  const api = createTelegramApi({ token: TELEGRAM_TOKEN, chatId: TELEGRAM_CHAT_ID });
  const ctx: CommandContext = createCommandContext();
  const send = createSendFn(api, TELEGRAM_TOKEN, TELEGRAM_CHAT_ID);

  setInterval(() => tickScheduler(ctx), 30_000);

  async function startPolling() {
    let offset = 0;

    const stale = (await api.getUpdates(-1)) as TelegramUpdate[];
    if (stale.length > 0) {
      offset = stale[stale.length - 1].update_id;
    }

    async function poll() {
      try {
        const updates = (await api.getUpdates(offset)) as TelegramUpdate[];
        for (const update of updates) {
          offset = update.update_id;
          await processUpdate(update, ctx, send, { token: TELEGRAM_TOKEN, chatId: TELEGRAM_CHAT_ID });
        }
      } catch { /* network error, retry next tick */ }
      setTimeout(poll, POLL_INTERVAL);
    }

    poll();
  }

  async function startWebhook() {
    if (!WEBHOOK_URL) {
      return startPolling();
    }

    try {
      const res = await fetch(
        `https://api.telegram.org/bot${TELEGRAM_TOKEN}/setWebhook`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: WEBHOOK_URL }),
        }
      );
      const data = (await res.json()) as { ok: boolean; description?: string };
      if (!data.ok) {
        return startPolling();
      }
    } catch {
      return startPolling();
    }

    const server = createWebhookServer((update) =>
      processUpdate(update, ctx, send, { token: TELEGRAM_TOKEN, chatId: TELEGRAM_CHAT_ID })
    );

    server.listen(WEBHOOK_PORT, () => {
    });
  }

  if (MODE === "webhook") {
    startWebhook();
  } else {
    startPolling();
  }

  process.on("SIGINT", () => {
    if (ctx.session) ctx.session.kill();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    if (ctx.session) ctx.session.kill();
    process.exit(0);
  });
}
