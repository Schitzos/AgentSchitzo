import type { ModelSession } from "../../session/model-session.ts";
import type { TaskQueue } from "../../telegram/application/task-queue.ts";
import type { TraceSession } from "../../tracing/trace-session.ts";
import { readEnv } from "../../utils/env.ts";

export interface CommandContext {
  session: ModelSession | null;
  source: "telegram" | "web";
  queue: string[];
  taskQueue: TaskQueue | null;
  verbose: boolean;
  history: string[];
  scheduled: { time: number; message: string }[];
  cwd: string;
  adapterName: string;
  pendingConfirmation: string | null;
  loginProc: import("child_process").ChildProcess | null;
  loginExitedAt: number | null;
  lastReplayedUrl: string | null;
  _lastInput: string | null;
  _lastOutput: string | null;
  _lastExitCode: number | null;
  _inputTime: number | null;
  _activeTrace: TraceSession | null;
  _sessionId: string | null;
  _lastSessionAt: number;
  _providerModels: Record<string, string>;
}

export function createCommandContext(): CommandContext {
  return {
    session: null,
    source: "telegram",
    queue: [],
    taskQueue: null,
    verbose: false,
    history: [],
    scheduled: [],
    cwd: process.cwd(),
    adapterName: readEnv("MODEL_ADAPTER", "kiro"),
    pendingConfirmation: null,
    loginProc: null,
    loginExitedAt: null,
    lastReplayedUrl: null,
    _lastInput: null,
    _lastOutput: null,
    _lastExitCode: null,
    _inputTime: null,
    _activeTrace: null,
    _sessionId: null,
    _lastSessionAt: 0,
    _providerModels: {
      kiro: "auto",
      "codex-cli": "gpt-5.5",
      "gemini-cli": "default",
      "local-llm": "default",
    },
  };
}

export function getCurrentProviderModel(ctx: CommandContext): string {
  return ctx._providerModels[ctx.adapterName] ?? "default";
}

export function setCurrentProviderModel(ctx: CommandContext, model: string): void {
  ctx._providerModels[ctx.adapterName] = model;
}
