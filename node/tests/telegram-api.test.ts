import { createTelegramApi } from "../src/telegram/infrastructure/telegram-api.ts";

describe("createTelegramApi", () => {
  const logger = { log: () => {} };

  it("uses default parameters", () => {
    // Just verify it doesn't throw with minimal config
    const api = createTelegramApi({ token: "tok", chatId: "123" });
    expect(api).toHaveProperty("getUpdates");
    expect(api).toHaveProperty("sendMessage");
  });

  describe("getUpdates", () => {
    it("returns results on success", async () => {
      const mockFetch = async () =>
        new Response(JSON.stringify({ ok: true, result: [{ update_id: 1 }] }));
      const api = createTelegramApi({
        fetchFn: mockFetch as typeof fetch,
        token: "tok",
        chatId: "123",
        logger,
      });
      const updates = await api.getUpdates(0);
      expect(updates).toEqual([{ update_id: 1 }]);
    });

    it("returns empty on HTTP error", async () => {
      const mockFetch = async () => new Response("", { status: 500 });
      const api = createTelegramApi({
        fetchFn: mockFetch as typeof fetch,
        token: "tok",
        chatId: "123",
        logger,
      });
      expect(await api.getUpdates(0)).toEqual([]);
    });

    it("returns empty on API error", async () => {
      const mockFetch = async () =>
        new Response(JSON.stringify({ ok: false }));
      const api = createTelegramApi({
        fetchFn: mockFetch as typeof fetch,
        token: "tok",
        chatId: "123",
        logger,
      });
      expect(await api.getUpdates(0)).toEqual([]);
    });

    it("returns empty on fetch exception", async () => {
      const mockFetch = async () => {
        throw new Error("network");
      };
      const api = createTelegramApi({
        fetchFn: mockFetch as typeof fetch,
        token: "tok",
        chatId: "123",
        logger,
      });
      expect(await api.getUpdates(0)).toEqual([]);
    });

    it("returns empty when result is missing", async () => {
      const mockFetch = async () =>
        new Response(JSON.stringify({ ok: true }));
      const api = createTelegramApi({
        fetchFn: mockFetch as typeof fetch,
        token: "tok",
        chatId: "123",
        logger,
      });
      expect(await api.getUpdates(0)).toEqual([]);
    });

    it("handles non-Error thrown", async () => {
      const mockFetch = async () => {
        throw "string error";
      };
      const api = createTelegramApi({
        fetchFn: mockFetch as typeof fetch,
        token: "tok",
        chatId: "123",
        logger,
      });
      expect(await api.getUpdates(0)).toEqual([]);
    });

    it("returns empty on timeout", async () => {
      const mockFetch = async (_url: string, opts?: RequestInit) => {
        // Simulate a request that takes too long by waiting for abort
        return new Promise<Response>((_resolve, reject) => {
          opts?.signal?.addEventListener("abort", () => {
            reject(opts.signal?.reason || new Error("aborted"));
          });
        });
      };
      const api = createTelegramApi({
        fetchFn: mockFetch as typeof fetch,
        token: "tok",
        chatId: "123",
        logger,
        requestTimeoutMs: 10,
      });
      expect(await api.getUpdates(0)).toEqual([]);
    });
  });

  describe("sendMessage", () => {
    it("returns true on success", async () => {
      const mockFetch = async () =>
        new Response(JSON.stringify({ ok: true }));
      const api = createTelegramApi({
        fetchFn: mockFetch as typeof fetch,
        token: "tok",
        chatId: "123",
        logger,
      });
      expect(await api.sendMessage("hi")).toBe(true);
    });

    it("returns false on HTTP error", async () => {
      const mockFetch = async () => new Response("", { status: 500 });
      const api = createTelegramApi({
        fetchFn: mockFetch as typeof fetch,
        token: "tok",
        chatId: "123",
        logger,
      });
      expect(await api.sendMessage("hi")).toBe(false);
    });

    it("returns false on API error", async () => {
      const mockFetch = async () =>
        new Response(JSON.stringify({ ok: false }));
      const api = createTelegramApi({
        fetchFn: mockFetch as typeof fetch,
        token: "tok",
        chatId: "123",
        logger,
      });
      expect(await api.sendMessage("hi")).toBe(false);
    });

    it("returns false on fetch exception", async () => {
      const mockFetch = async () => {
        throw new Error("fail");
      };
      const api = createTelegramApi({
        fetchFn: mockFetch as typeof fetch,
        token: "tok",
        chatId: "123",
        logger,
      });
      expect(await api.sendMessage("hi")).toBe(false);
    });

    it("handles non-Error thrown", async () => {
      const mockFetch = async () => {
        throw 42;
      };
      const api = createTelegramApi({
        fetchFn: mockFetch as typeof fetch,
        token: "tok",
        chatId: "123",
        logger,
      });
      expect(await api.sendMessage("hi")).toBe(false);
    });
  });
});
