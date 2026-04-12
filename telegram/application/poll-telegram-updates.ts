import type {
  PollerScheduler,
  TelegramUpdate
} from "../../types/telegram/application/poll-telegram-updates.ts";

function createSerialScheduler(): PollerScheduler {
  return (callback, intervalMs) => {
    let timeoutId = null;
    let isStopped = false;

    const run = async () => {
      if (isStopped) {
        return;
      }

      await callback();

      if (!isStopped) {
        timeoutId = setTimeout(run, intervalMs);
      }
    };

    timeoutId = setTimeout(run, intervalMs);

    return {
      stop() {
        isStopped = true;

        if (timeoutId !== null) {
          clearTimeout(timeoutId);
        }
      }
    };
  };
}

export function createTelegramUpdatePoller({
  getUpdates,
  handleCommand,
  chatId,
  intervalMs,
  scheduler = createSerialScheduler(),
  logger = console
}) {
  let lastUpdateId = 0;
  let isPolling = false;
  const normalizedChatId = String(chatId);

  function getCommandFromUpdate(update: TelegramUpdate) {
    const message = update.message;

    if (!message) {
      return null;
    }

    if (String(message.chat.id) !== normalizedChatId) {
      return null;
    }

    return message.text || null;
  }

  async function pollOnce() {
    if (isPolling) {
      logger.log("Polling skipped because the previous cycle is still running.");
      return;
    }

    isPolling = true;

    try {
      const updates = await getUpdates(lastUpdateId);

      for (const update of updates) {
        lastUpdateId = update.update_id;
        const command = getCommandFromUpdate(update);

        if (!command) {
          continue;
        }

        void Promise.resolve(handleCommand(command))
          .catch((error) => {
            const message = error instanceof Error ? error.message : String(error);
            logger.log("Command handling failed:", message);
          });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.log("Polling failed:", message);
    } finally {
      isPolling = false;
    }
  }

  function start() {
    logger.log("Telegram agent listening...");
    return scheduler(async () => {
      await pollOnce();
    }, intervalMs);
  }

  function getLastUpdateId() {
    return lastUpdateId;
  }

  return {
    pollOnce,
    start,
    getLastUpdateId
  };
}
