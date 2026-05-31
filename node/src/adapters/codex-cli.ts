import type { CliModelAdapter } from "./cli-model-adapter.ts";

export const codexCliAdapter: CliModelAdapter = {
  name: "codex-cli",
  command: "codex",
  closeStdin: true,
  mergeStderr: true,
  buildArgs: (_cwd: string, model?: string) => [
    "exec",
    "--sandbox", "workspace-write",
    ...(model && model !== "default" ? ["--model", model] : []),
  ],
};
