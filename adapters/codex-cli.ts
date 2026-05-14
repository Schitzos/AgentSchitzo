import type { CliModelAdapter } from "./cli-model-adapter.ts";

export const codexCliAdapter: CliModelAdapter = {
  name: "codex-cli",
  command: "codex",
  buildArgs: () => ["exec", "--full-auto", "-"],
};
