import type { CliModelAdapter } from "./cli-model-adapter.ts";

export const geminiCliAdapter: CliModelAdapter = {
  name: "gemini-cli",
  command: "gemini",
  buildArgs: () => [],
};
