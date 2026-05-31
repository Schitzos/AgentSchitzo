import type { CliModelAdapter } from "./cli-model-adapter.ts";

export const kiroAdapter: CliModelAdapter = {
  name: "kiro",
  command: "kiro-cli",
  buildArgs: (_cwd: string, model?: string) => ["chat", "--no-interactive", "--trust-all-tools", "--wrap", "never", "--model", model || "claude-sonnet-4"],
  detectLoginUrl: (output) => {
    const match = output.match(/https:\/\/\S*(signin|login|authorize|device|awsapps\.com\/start)\S*/i);
    return match?.[0] ?? null;
  },
};
