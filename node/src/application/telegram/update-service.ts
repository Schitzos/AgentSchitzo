import http from "http";
import fs from "fs";
import path from "path";
import { createTelegramApi } from "../../telegram/infrastructure/telegram-api.ts";
import {
  handleCommand,
  type CommandContext,
  type SendFn,
} from "../../telegram/application/handle-telegram-command.ts";

export interface TelegramUpdate {
  update_id: number;
  message?: {
    chat?: { id: number };
    text?: string;
    document?: { file_id: string; file_name?: string };
    photo?: { file_id: string }[];
    voice?: { file_id: string };
    reply_to_message?: { text?: string };
  };
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
  fetchFn: typeof fetch = fetch
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
    let input = msg.text;
    if (msg.reply_to_message?.text && !msg.text.trim().startsWith("/")) {
      input = `[Replying to: "${msg.reply_to_message.text}"]\n${msg.text}`;
    }
    await handleCommand(input, ctx, send);
  }
}

export function createWebhookHandler(
  processUpdateFn: (update: TelegramUpdate) => Promise<void>
): http.RequestListener {
  return async (req, res) => {
    if (req.method === "POST") {
      let body = "";
      req.on("data", (chunk: Buffer) => (body += chunk));
      req.on("end", async () => {
        try {
          const update = JSON.parse(body) as TelegramUpdate;
          await processUpdateFn(update);
        } catch {
          // ignore malformed payloads
        }
        res.writeHead(200);
        res.end("ok");
      });
    } else {
      res.writeHead(200);
      res.end("AgentSchitzo webhook active");
    }
  };
}

export function createWebhookServer(
  processUpdateFn: (update: TelegramUpdate) => Promise<void>
): http.Server {
  return http.createServer(createWebhookHandler(processUpdateFn));
}
