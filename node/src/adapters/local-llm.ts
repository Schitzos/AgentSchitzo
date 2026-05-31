import type { CliModelAdapter } from "./cli-model-adapter.ts";

export const localLlmAdapter: CliModelAdapter = {
  name: "local-llm",
  command: process.env["LOCAL_LLM_COMMAND"] || "ollama",
  buildArgs: () => JSON.parse(process.env["LOCAL_LLM_ARGS"] || "[]") as string[],
};
