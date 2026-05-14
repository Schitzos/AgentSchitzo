export type TelegramUpdate = {
  update_id: number;
  message?: {
    chat: {
      id: string | number;
    };
    text?: string;
  };
};

export type PollerScheduler = (
  callback: () => Promise<void>,
  intervalMs: number
) => unknown;
