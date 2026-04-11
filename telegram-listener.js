import {
  TELEGRAM_CHAT_ID,
  TELEGRAM_POLL_INTERVAL_MS,
  TELEGRAM_TOKEN
} from "./telegram/config.js";
import {
  buildCodexPrompt,
  extractJSON,
  isSimpleChat
} from "./telegram/domain/message-utils.js";
import { createTelegramApi } from "./telegram/infrastructure/telegram-api.js";
import { createTelegramCommandHandler } from "./telegram/application/handle-telegram-command.js";
import { createTelegramUpdatePoller } from "./telegram/application/poll-telegram-updates.js";

export { buildCodexPrompt, extractJSON, isSimpleChat };

export function createTelegramListenerApp({
  fetchFn = fetch,
  logger = console,
  scheduler = setInterval,
  askModel,
  codexRunner
} = {}) {
  const telegramApi = createTelegramApi({
    fetchFn,
    token: TELEGRAM_TOKEN,
    chatId: TELEGRAM_CHAT_ID,
    logger
  });

  const runAgent = createTelegramCommandHandler({
    sendMessage: telegramApi.sendMessage,
    askModel,
    codexRunner,
    logger
  });

  const poller = createTelegramUpdatePoller({
    getUpdates: telegramApi.getUpdates,
    handleCommand: runAgent,
    chatId: TELEGRAM_CHAT_ID,
    intervalMs: TELEGRAM_POLL_INTERVAL_MS,
    scheduler,
    logger
  });

  return {
    getUpdates: () => telegramApi.getUpdates(poller.getLastUpdateId()),
    sendMessage: telegramApi.sendMessage,
    runAgent,
    main: () => poller.start(),
    pollOnce: poller.pollOnce
  };
}

const app = createTelegramListenerApp();

export const getUpdates = app.getUpdates;
export const sendMessage = app.sendMessage;
export const runAgent = app.runAgent;
export const main = app.main;

const isDirectRun = process.argv[1]?.includes("telegram-listener");

if (isDirectRun) {
  main();
}
