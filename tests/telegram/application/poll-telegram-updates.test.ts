// @ts-nocheck
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { createTelegramUpdatePoller } from "../../../telegram/application/poll-telegram-updates.js";

describe("telegram/application/poll-telegram-updates", () => {
  const getUpdates = jest.fn();
  const handleCommand = jest.fn();
  const scheduler = jest.fn();
  const logger = { log: jest.fn() };

  beforeEach(() => {
    getUpdates.mockReset();
    handleCommand.mockReset();
    scheduler.mockReset();
    logger.log.mockReset();
  });

  test("pollOnce processes only messages from the configured chat", async () => {
    const poller = createTelegramUpdatePoller({
      getUpdates,
      handleCommand,
      chatId: "1845486925",
      intervalMs: 3000,
      scheduler,
      logger
    });

    getUpdates.mockResolvedValue([
      {
        update_id: 1,
        message: {
          chat: { id: "1845486925" },
          text: "hi"
        }
      },
      {
        update_id: 2,
        message: {
          chat: { id: "999" },
          text: "ignore me"
        }
      },
      {
        update_id: 3,
        message: {
          chat: { id: "1845486925" }
        }
      }
    ]);

    handleCommand.mockResolvedValue(undefined);

    await poller.pollOnce();
    await Promise.resolve();

    expect(getUpdates).toHaveBeenCalledWith(0);
    expect(handleCommand).toHaveBeenCalledTimes(1);
    expect(handleCommand).toHaveBeenCalledWith("hi");
    expect(poller.getLastUpdateId()).toBe(3);
  });

  test("start logs and schedules the polling loop", async () => {
    const poller = createTelegramUpdatePoller({
      getUpdates,
      handleCommand,
      chatId: "1845486925",
      intervalMs: 3000,
      scheduler,
      logger
    });

    getUpdates.mockResolvedValue([]);
    scheduler.mockImplementation(async (callback, interval) => {
      await callback();
      return interval;
    });

    await expect(poller.start()).resolves.toBe(3000);
    expect(logger.log).toHaveBeenCalledWith("Telegram agent listening...");
    expect(scheduler).toHaveBeenCalledWith(expect.any(Function), 3000);
  });

  test("start uses a serial scheduler by default", async () => {
    jest.useFakeTimers();

    const poller = createTelegramUpdatePoller({
      getUpdates,
      handleCommand,
      chatId: "1845486925",
      intervalMs: 3000,
      logger
    });

    getUpdates.mockResolvedValue([]);

    const handle = poller.start();

    await jest.advanceTimersByTimeAsync(3000);
    await jest.advanceTimersByTimeAsync(3000);

    expect(getUpdates).toHaveBeenCalledTimes(2);
    expect(typeof handle.stop).toBe("function");

    handle.stop();
    jest.useRealTimers();
  });

  test("stopping the default scheduler before the first run prevents polling", async () => {
    jest.useFakeTimers();

    const poller = createTelegramUpdatePoller({
      getUpdates,
      handleCommand,
      chatId: "1845486925",
      intervalMs: 3000,
      logger
    });

    getUpdates.mockResolvedValue([]);

    const handle = poller.start();
    handle.stop();
    await jest.advanceTimersByTimeAsync(3000);

    expect(getUpdates).not.toHaveBeenCalled();

    jest.useRealTimers();
  });

  test("the default scheduler exits cleanly when a queued run fires after stop", async () => {
    jest.useFakeTimers();

    const originalClearTimeout = global.clearTimeout;
    global.clearTimeout = jest.fn();

    const poller = createTelegramUpdatePoller({
      getUpdates,
      handleCommand,
      chatId: "1845486925",
      intervalMs: 3000,
      logger
    });

    getUpdates.mockResolvedValue([]);

    try {
      const handle = poller.start();
      handle.stop();
      await jest.advanceTimersByTimeAsync(3000);

      expect(getUpdates).not.toHaveBeenCalled();
    } finally {
      global.clearTimeout = originalClearTimeout;
      jest.useRealTimers();
    }
  });

  test("the default scheduler tolerates a missing timeout handle on stop", () => {
    const originalSetTimeout = global.setTimeout;
    global.setTimeout = jest.fn(() => null);

    try {
      const poller = createTelegramUpdatePoller({
        getUpdates,
        handleCommand,
        chatId: "1845486925",
        intervalMs: 3000,
        logger
      });

      const handle = poller.start();
      handle.stop();

      expect(getUpdates).not.toHaveBeenCalled();
    } finally {
      global.setTimeout = originalSetTimeout;
    }
  });

  test("pollOnce skips updates without messages and supports default logger and scheduler", async () => {
    const poller = createTelegramUpdatePoller({
      getUpdates,
      handleCommand,
      chatId: "1845486925",
      intervalMs: 3000
    });

    getUpdates.mockResolvedValue([
      { update_id: 1 },
      {
        update_id: 2,
        message: {
          chat: { id: "1845486925" },
          text: "handled"
        }
      }
    ]);

    handleCommand.mockResolvedValue(undefined);

    await poller.pollOnce();
    await Promise.resolve();

    expect(handleCommand).toHaveBeenCalledTimes(1);
    expect(handleCommand).toHaveBeenCalledWith("handled");
    expect(poller.getLastUpdateId()).toBe(2);
  });

  test("pollOnce logs and recovers from polling errors", async () => {
    const poller = createTelegramUpdatePoller({
      getUpdates,
      handleCommand,
      chatId: "1845486925",
      intervalMs: 3000,
      scheduler,
      logger
    });

    getUpdates.mockRejectedValue(new Error("telegram offline"));

    await expect(poller.pollOnce()).resolves.toBeUndefined();
    expect(logger.log).toHaveBeenCalledWith("Polling failed:", "telegram offline");
  });

  test("pollOnce stringifies non-Error polling failures", async () => {
    const poller = createTelegramUpdatePoller({
      getUpdates,
      handleCommand,
      chatId: "1845486925",
      intervalMs: 3000,
      scheduler,
      logger
    });

    getUpdates.mockRejectedValue("telegram offline");

    await expect(poller.pollOnce()).resolves.toBeUndefined();
    expect(logger.log).toHaveBeenCalledWith("Polling failed:", "telegram offline");
  });

  test("pollOnce skips overlapping poll cycles", async () => {
    let releasePoll;
    const pollInFlight = new Promise((resolve) => {
      releasePoll = resolve;
    });

    const poller = createTelegramUpdatePoller({
      getUpdates,
      handleCommand,
      chatId: "1845486925",
      intervalMs: 3000,
      scheduler,
      logger
    });

    getUpdates.mockReturnValueOnce(pollInFlight).mockResolvedValueOnce([]);

    const firstPoll = poller.pollOnce();
    await Promise.resolve();
    await poller.pollOnce();
    releasePoll([]);
    await firstPoll;

    expect(getUpdates).toHaveBeenCalledTimes(1);
    expect(logger.log).toHaveBeenCalledWith(
      "Polling skipped because the previous cycle is still running."
    );
  });

  test("pollOnce does not wait for command handling to finish before accepting the next cycle", async () => {
    let releaseCommand;
    const commandInFlight = new Promise((resolve) => {
      releaseCommand = resolve;
    });

    const poller = createTelegramUpdatePoller({
      getUpdates,
      handleCommand,
      chatId: "1845486925",
      intervalMs: 3000,
      scheduler,
      logger
    });

    getUpdates
      .mockResolvedValueOnce([
        {
          update_id: 1,
          message: {
            chat: { id: "1845486925" },
            text: "write tests"
          }
        }
      ])
      .mockResolvedValueOnce([]);
    handleCommand.mockReturnValue(commandInFlight);

    await poller.pollOnce();
    await poller.pollOnce();

    expect(getUpdates).toHaveBeenCalledTimes(2);
    expect(logger.log).not.toHaveBeenCalledWith(
      "Polling skipped because the previous cycle is still running."
    );

    releaseCommand();
    await commandInFlight;
  });

  test("pollOnce logs command handler failures without breaking polling", async () => {
    const poller = createTelegramUpdatePoller({
      getUpdates,
      handleCommand,
      chatId: "1845486925",
      intervalMs: 3000,
      scheduler,
      logger
    });

    getUpdates.mockResolvedValue([
      {
        update_id: 1,
        message: {
          chat: { id: "1845486925" },
          text: "write tests"
        }
      }
    ]);
    handleCommand.mockRejectedValue(new Error("boom"));

    await poller.pollOnce();
    await Promise.resolve();

    expect(logger.log).toHaveBeenCalledWith("Command handling failed:", "boom");
  });

  test("pollOnce stringifies non-Error command handler failures", async () => {
    const poller = createTelegramUpdatePoller({
      getUpdates,
      handleCommand,
      chatId: "1845486925",
      intervalMs: 3000,
      scheduler,
      logger
    });

    getUpdates.mockResolvedValue([
      {
        update_id: 1,
        message: {
          chat: { id: "1845486925" },
          text: "write tests"
        }
      }
    ]);
    handleCommand.mockRejectedValue("boom");

    await poller.pollOnce();
    await Promise.resolve();

    expect(logger.log).toHaveBeenCalledWith("Command handling failed:", "boom");
  });

  test("stopping the default scheduler during an active poll prevents rescheduling", async () => {
    jest.useFakeTimers();

    let releaseUpdates;
    const updatesPromise = new Promise((resolve) => {
      releaseUpdates = resolve;
    });

    const poller = createTelegramUpdatePoller({
      getUpdates,
      handleCommand,
      chatId: "1845486925",
      intervalMs: 3000,
      logger
    });

    getUpdates.mockReturnValueOnce(updatesPromise).mockResolvedValueOnce([]);

    const handle = poller.start();
    await jest.advanceTimersByTimeAsync(3000);
    expect(getUpdates).toHaveBeenCalledTimes(1);

    handle.stop();
    releaseUpdates([]);
    await updatesPromise;
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(3000);

    expect(getUpdates).toHaveBeenCalledTimes(1);

    jest.useRealTimers();
  });
});
