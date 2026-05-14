import type { CliModelAdapter } from "./cli-model-adapter.ts";
import { kiroAdapter } from "./kiro.ts";
import { geminiCliAdapter } from "./gemini-cli.ts";
import { codexCliAdapter } from "./codex-cli.ts";
import { localLlmAdapter } from "./local-llm.ts";

const adapters: Record<string, CliModelAdapter> = {
  kiro: kiroAdapter,
  "gemini-cli": geminiCliAdapter,
  "codex-cli": codexCliAdapter,
  "local-llm": localLlmAdapter,
};

export function getAdapter(name: string): CliModelAdapter {
  const adapter = adapters[name];
  if (!adapter) {
    throw new Error(
      `Unknown adapter "${name}". Available: ${Object.keys(adapters).join(", ")}`
    );
  }
  return adapter;
}

export function listAdapters(): string[] {
  return Object.keys(adapters);
}
