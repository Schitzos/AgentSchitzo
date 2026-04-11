import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { createTelegramApi } from "../../../telegram/infrastructure/telegram-api.js";

describe("telegram/infrastructure/telegram-api", () => {
  const fetchFn = jest.fn();
  const logger = { log: jest.fn() };

  beforeEach(() => {
    fetchFn.mockReset();
    logger.log.mockReset();
  });

  test("getUpdates returns telegram results for the next offset", async () => {
    const api = createTelegramApi({
      fetchFn,
      token: "token",
      chatId: "chat-id",
      logger
    });

    fetchFn.mockResolvedValue({
      json: async () => ({ ok: true, result: [{ update_id: 10 }] })
    });

    await expect(api.getUpdates(9)).resolves.toEqual([{ update_id: 10 }]);
    expect(fetchFn).toHaveBeenCalledWith(
      "https://api.telegram.org/bottoken/getUpdates?offset=10"
    );
  });

  test("getUpdates returns empty array on telegram api errors", async () => {
    const api = createTelegramApi({
      fetchFn,
      token: "token",
      chatId: "chat-id",
      logger
    });

    fetchFn.mockResolvedValue({
      json: async () => ({ ok: false, error_code: 500 })
    });

    await expect(api.getUpdates(0)).resolves.toEqual([]);
    expect(logger.log).toHaveBeenCalledWith("Telegram API error:", { ok: false, error_code: 500 });
  });

  test("getUpdates returns empty array when telegram omits the result list", async () => {
    const api = createTelegramApi({
      fetchFn,
      token: "token",
      chatId: "chat-id",
      logger
    });

    fetchFn.mockResolvedValue({
      json: async () => ({ ok: true })
    });

    await expect(api.getUpdates(0)).resolves.toEqual([]);
  });

  test("getUpdates returns empty array on fetch failures", async () => {
    const api = createTelegramApi({
      fetchFn,
      token: "token",
      chatId: "chat-id",
      logger
    });

    fetchFn.mockRejectedValue(new Error("offline"));

    await expect(api.getUpdates(0)).resolves.toEqual([]);
    expect(logger.log).toHaveBeenCalledWith("Fetch error:", "offline");
  });

  test("sendMessage posts the chat id and text", async () => {
    const api = createTelegramApi({
      fetchFn,
      token: "token",
      chatId: "chat-id",
      logger
    });

    fetchFn.mockResolvedValue({ ok: true });

    await api.sendMessage("hello");

    expect(fetchFn).toHaveBeenCalledWith(
      "https://api.telegram.org/bottoken/sendMessage",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: "chat-id",
          text: "hello"
        })
      })
    );
  });

  test("uses the global fetch and default logger when dependencies are omitted", async () => {
    const originalFetch = global.fetch;
    const defaultLoggerSpy = jest.spyOn(console, "log").mockImplementation(() => {});

    global.fetch = jest.fn().mockResolvedValue({
      json: async () => ({ ok: false, error_code: 401 })
    });

    try {
      const api = createTelegramApi({
        token: "token",
        chatId: "chat-id"
      });

      await expect(api.getUpdates(4)).resolves.toEqual([]);
      expect(global.fetch).toHaveBeenCalledWith(
        "https://api.telegram.org/bottoken/getUpdates?offset=5"
      );
      expect(defaultLoggerSpy).toHaveBeenCalledWith("Telegram API error:", {
        ok: false,
        error_code: 401
      });
    } finally {
      global.fetch = originalFetch;
      defaultLoggerSpy.mockRestore();
    }
  });
});
