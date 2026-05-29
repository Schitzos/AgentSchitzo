export type TelegramListenerDependencies = {
  fetchFn?: typeof fetch;
  logger?: Console;
  scheduler?: (callback: () => Promise<void>, intervalMs: number) => unknown;
  askModel?: (prompt: string) => Promise<string | null>;
  codexRunner?: (
    prompt: string,
    options?: { bypassApprovals?: boolean }
  ) => Promise<{ success: boolean; output: string }>;
};
