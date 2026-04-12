import type {
  TelegramApiDependencies,
  TelegramPayload
} from "../../types/telegram/infrastructure/telegram-api.ts";

export function createTelegramApi({
  fetchFn = fetch,
  token,
  chatId,
  logger = console,
  requestTimeoutMs = 10000
}: TelegramApiDependencies) {
  function buildTelegramUrl(method: string, query = "") {
    return `https://api.telegram.org/bot${token}/${method}${query}`;
  }

  async function fetchWithTimeout(url: string, options: RequestInit = {}) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort(
        new Error(`Telegram request timed out after ${requestTimeoutMs}ms`)
      );
    }, requestTimeoutMs);

    try {
      return await fetchFn(url, {
        ...options,
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async function getUpdates(offset: number) {
    try {
      const res = await fetchWithTimeout(
        buildTelegramUrl("getUpdates", `?offset=${offset + 1}`)
      );
      if (res.ok === false) {
        logger.log("Telegram HTTP error:", res.status, res.statusText);
        return [];
      }

      const data = (await res.json()) as TelegramPayload;

      if (!data.ok) {
        logger.log("Telegram API error:", data);
        return [];
      }

      return data.result || [];
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.log("Fetch error:", message);
      return [];
    }
  }

  async function sendMessage(text: string) {
    try {
      const res = await fetchWithTimeout(buildTelegramUrl("sendMessage"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          chat_id: chatId,
          text
        })
      });

      if (res.ok === false) {
        logger.log("Telegram HTTP error:", res.status, res.statusText);
        return false;
      }

      const data = (await res.json()) as TelegramPayload;

      if (!data.ok) {
        logger.log("Telegram API error:", data);
        return false;
      }

      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.log("Fetch error:", message);
      return false;
    }
  }

  return {
    getUpdates,
    sendMessage
  };
}
