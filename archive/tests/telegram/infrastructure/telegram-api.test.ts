// @ts-nocheck
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
      "https://api.telegram.org/bottoken/getUpdates?offset=10",
      expect.objectContaining({
        signal: expect.any(Object)
      })
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
    expect(logger.log).toHaveBeenCalledWith("Telegram API error:", {
      ok: false,
      error_code: 500
    });
  });

  test("getUpdates returns empty array on http failures", async () => {
    const api = createTelegramApi({
      fetchFn,
      token: "token",
      chatId: "chat-id",
      logger
    });

    fetchFn.mockResolvedValue({
      ok: false,
      status: 502,
      statusText: "Bad Gateway"
    });

    await expect(api.getUpdates(0)).resolves.toEqual([]);
    expect(logger.log).toHaveBeenCalledWith(
      "Telegram HTTP error:",
      502,
      "Bad Gateway"
    );
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

  test("getUpdates stringifies non-Error fetch failures", async () => {
    const api = createTelegramApi({
      fetchFn,
      token: "token",
      chatId: "chat-id",
      logger
    });

    fetchFn.mockRejectedValue("offline");

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

    fetchFn.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, result: { message_id: 1 } })
    });

    await expect(api.sendMessage("hello")).resolves.toBe(true);

    expect(fetchFn).toHaveBeenCalledWith(
      "https://api.telegram.org/bottoken/sendMessage",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: "chat-id",
          text: "hello"
        }),
        signal: expect.any(Object)
      })
    );
  });

  test("sendMessage returns false on telegram api errors", async () => {
    const api = createTelegramApi({
      fetchFn,
      token: "token",
      chatId: "chat-id",
      logger
    });

    fetchFn.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: false, error_code: 400 })
    });

    await expect(api.sendMessage("hello")).resolves.toBe(false);
    expect(logger.log).toHaveBeenCalledWith("Telegram API error:", {
      ok: false,
      error_code: 400
    });
  });

  test("sendMessage returns false on http failures", async () => {
    const api = createTelegramApi({
      fetchFn,
      token: "token",
      chatId: "chat-id",
      logger
    });

    fetchFn.mockResolvedValue({
      ok: false,
      status: 503,
      statusText: "Service Unavailable"
    });

    await expect(api.sendMessage("hello")).resolves.toBe(false);
    expect(logger.log).toHaveBeenCalledWith(
      "Telegram HTTP error:",
      503,
      "Service Unavailable"
    );
  });

  test("sendMessage returns false on fetch failures", async () => {
    const api = createTelegramApi({
      fetchFn,
      token: "token",
      chatId: "chat-id",
      logger
    });

    fetchFn.mockRejectedValue(new Error("offline"));

    await expect(api.sendMessage("hello")).resolves.toBe(false);
    expect(logger.log).toHaveBeenCalledWith("Fetch error:", "offline");
  });

  test("sendMessage stringifies non-Error fetch failures", async () => {
    const api = createTelegramApi({
      fetchFn,
      token: "token",
      chatId: "chat-id",
      logger
    });

    fetchFn.mockRejectedValue("offline");

    await expect(api.sendMessage("hello")).resolves.toBe(false);
    expect(logger.log).toHaveBeenCalledWith("Fetch error:", "offline");
  });

  test("uses the global fetch and default logger when dependencies are omitted", async () => {
    const originalFetch = global.fetch;
    const defaultLoggerSpy = jest
      .spyOn(console, "log")
      .mockImplementation(() => {});

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
        "https://api.telegram.org/bottoken/getUpdates?offset=5",
        expect.objectContaining({
          signal: expect.any(Object)
        })
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

  test("getUpdates returns empty array when the request times out", async () => {
    jest.useFakeTimers();

    const api = createTelegramApi({
      fetchFn,
      token: "token",
      chatId: "chat-id",
      logger,
      requestTimeoutMs: 50
    });

    fetchFn.mockImplementation(
      (_, options) =>
        new Promise((_, reject) => {
          options.signal.addEventListener("abort", () => {
            reject(options.signal.reason);
          });
        })
    );

    const updatesPromise = api.getUpdates(0);

    await jest.advanceTimersByTimeAsync(50);

    await expect(updatesPromise).resolves.toEqual([]);
    expect(logger.log).toHaveBeenCalledWith(
      "Fetch error:",
      "Telegram request timed out after 50ms"
    );

    jest.useRealTimers();
  });
});
