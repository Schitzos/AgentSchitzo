export type TelegramPayload = {
  ok?: boolean;
  result?: unknown[];
};

export type TelegramApiDependencies = {
  fetchFn?: typeof fetch;
  token: string;
  chatId: string;
  logger?: Pick<Console, "log">;
  requestTimeoutMs?: number;
};
