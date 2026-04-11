export function createTelegramUpdatePoller({
  getUpdates,
  handleCommand,
  chatId,
  intervalMs,
  scheduler = setInterval,
  logger = console
}) {
  let lastUpdateId = 0;

  function getCommandFromUpdate(update) {
    const message = update.message;

    if (!message) {
      return null;
    }

    if (message.chat.id.toString() !== chatId) {
      return null;
    }

    return message.text || null;
  }

  async function pollOnce() {
    const updates = await getUpdates(lastUpdateId);

    for (const update of updates) {
      lastUpdateId = update.update_id;
      const command = getCommandFromUpdate(update);

      if (!command) {
        continue;
      }

      await handleCommand(command);
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
