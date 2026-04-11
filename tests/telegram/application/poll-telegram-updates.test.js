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

    await poller.pollOnce();

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

    await poller.pollOnce();

    expect(handleCommand).toHaveBeenCalledTimes(1);
    expect(handleCommand).toHaveBeenCalledWith("handled");
    expect(poller.getLastUpdateId()).toBe(2);
  });
});
