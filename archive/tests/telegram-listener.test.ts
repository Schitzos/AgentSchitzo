// @ts-nocheck
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { createTelegramListenerApp } from "../telegram-listener.js";

describe("telegram-listener", () => {
  const fetchFn = jest.fn();
  const logger = { log: jest.fn() };
  const scheduler = jest.fn();
  const askModel = jest.fn();
  const codexRunner = jest.fn();

  beforeEach(() => {
    fetchFn.mockReset();
    logger.log.mockReset();
    scheduler.mockReset();
    askModel.mockReset();
    codexRunner.mockReset();
  });

  test("createTelegramListenerApp exposes use cases backed by telegram api", async () => {
    const app = createTelegramListenerApp({
      fetchFn,
      logger,
      scheduler,
      askModel,
      codexRunner
    });

    fetchFn.mockResolvedValueOnce({
      json: async () => ({ ok: true, result: [{ update_id: 1 }] })
    });
    fetchFn.mockResolvedValueOnce({ ok: true });

    await expect(app.getUpdates()).resolves.toEqual([{ update_id: 1 }]);
    await app.sendMessage("hello");

    expect(fetchFn.mock.calls[0][0]).toContain("/getUpdates?offset=1");
    expect(fetchFn.mock.calls[1][0]).toContain("/sendMessage");
  });

  test("runAgent delegates through the composed command handler", async () => {
    const app = createTelegramListenerApp({
      fetchFn,
      logger,
      scheduler,
      askModel,
      codexRunner
    });

    askModel.mockResolvedValue('{"intent":"chat","reply":"Hello there"}');

    await app.runAgent("say hello");

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0][1].body).toContain("Hello there");
  });

  test("main wires the poller to the provided scheduler", () => {
    const app = createTelegramListenerApp({
      fetchFn,
      logger,
      scheduler,
      askModel,
      codexRunner
    });

    scheduler.mockReturnValue("interval-id");

    expect(app.main()).toBe("interval-id");
    expect(scheduler).toHaveBeenCalledWith(expect.any(Function), 3000);
  });

  test("invokes main automatically when imported as the direct-run entrypoint", async () => {
    const originalArgv1 = process.argv[1];
    const originalSetTimeout = global.setTimeout;
    const consoleLogSpy = jest
      .spyOn(console, "log")
      .mockImplementation(() => {});

    try {
      jest.resetModules();
      process.argv[1] = "telegram-listener";
      global.setTimeout = jest.fn(() => "timeout-id");

      await import("../telegram-listener.js");

      expect(global.setTimeout).toHaveBeenCalledWith(
        expect.any(Function),
        3000
      );
      expect(consoleLogSpy).toHaveBeenCalledWith("Telegram agent listening...");
    } finally {
      process.argv[1] = originalArgv1;
      global.setTimeout = originalSetTimeout;
      consoleLogSpy.mockRestore();
    }
  });
});
