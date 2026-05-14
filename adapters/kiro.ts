import type { CliModelAdapter } from "./cli-model-adapter.ts";

export const kiroAdapter: CliModelAdapter = {
  name: "kiro",
  command: "kiro-cli",
  buildArgs: (_cwd: string) => ["chat", "--no-interactive", "--trust-all-tools", "--wrap", "never"],
  detectLoginUrl: (output) => {
    const match = output.match(/https:\/\/\S*(signin|login|authorize|device|awsapps\.com\/start)\S*/i);
    return match?.[0] ?? null;
  },
};
