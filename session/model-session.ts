import { spawn, type ChildProcess } from "child_process";
import type { CliModelAdapter } from "../adapters/cli-model-adapter.ts";
import { createOutputBuffer } from "./output-buffer.ts";

export type SessionState = "idle" | "processing" | "stopped";

export interface ModelSession {
  state(): SessionState;
  adapterName(): string;
  write(input: string): void;
  interrupt(): void;
  kill(): void;
  onOutput(cb: (text: string) => void): void;
  onLoginUrl(cb: (url: string) => void): void;
  onExit(cb: (code: number | null) => void): void;
  onIdle(cb: () => void): void;
  start(): void;
}

export interface ModelSessionOptions {
  adapter: CliModelAdapter;
  cwd: string;
  debounceMs?: number;
  timeoutMs?: number;
}

export function createModelSession(opts: ModelSessionOptions): ModelSession {
  const { adapter, cwd, debounceMs = 500, timeoutMs = 300_000 } = opts;

  let proc: ChildProcess | null = null;
  let currentState: SessionState = "idle";
  let outputCb: ((text: string) => void) | null = null;
  let loginUrlCb: ((url: string) => void) | null = null;
  let exitCb: ((code: number | null) => void) | null = null;
  let idleCb: (() => void) | null = null;
  let silenceTimer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  function resetSilenceTimer() {
    if (silenceTimer) clearTimeout(silenceTimer);
    if (timeoutMs > 0) {
      silenceTimer = setTimeout(() => {
        /* istanbul ignore next -- defensive: timer cleared on exit */
        if (currentState === "processing" && outputCb) {
          outputCb(
            `⚠️ Model has been silent for ${Math.round(timeoutMs / 60000)} minutes. It may be stuck. Send /interrupt to cancel.`
          );
        }
      }, timeoutMs);
    }
  }

  function runCommand(input: string) {
    /* istanbul ignore next -- defensive: write() already guards stopped */
    if (stopped) return;
    currentState = "processing";

    const args = [...adapter.buildArgs(cwd), input];

    proc = spawn(adapter.command, args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });

    const buffer = createOutputBuffer(debounceMs);
    buffer.onFlush((text) => {
      if (outputCb) outputCb(text);
    });

    resetSilenceTimer();

    proc.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      resetSilenceTimer();

      if (adapter.detectLoginUrl) {
        const url = adapter.detectLoginUrl(text);
        /* istanbul ignore next */ if (url && loginUrlCb) loginUrlCb(url);
      }

      buffer.append(text);
    });

    proc.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      resetSilenceTimer();

      if (adapter.detectLoginUrl) {
        const url = adapter.detectLoginUrl(text);
        /* istanbul ignore next */ if (url && loginUrlCb) loginUrlCb(url);
      }
    });

    proc.on("exit", (_code) => {
      if (silenceTimer) clearTimeout(silenceTimer);
      proc = null;
      currentState = "idle";
      buffer.flush();
      buffer.destroy();
      // Use setImmediate to ensure state is fully "idle" before draining queue
      setImmediate(() => { if (idleCb) idleCb(); });
    });
  }

  return {
    state: () => currentState,
    adapterName: () => adapter.name,
    start() {
      // No-op for per-message mode; session is "started" and ready
      currentState = "idle";
    },
    write(input: string) {
      if (stopped) return;
      if (proc) {
        // Already running a command — this shouldn't happen (queue handles it)
        return;
      }
      runCommand(input);
    },
    interrupt() {
      if (proc) {
        proc.kill("SIGINT");
        currentState = "idle";
      }
    },
    kill() {
      stopped = true;
      if (proc) proc.kill("SIGTERM");
      currentState = "stopped";
      if (exitCb) exitCb(0);
    },
    onOutput(cb) {
      outputCb = cb;
    },
    onLoginUrl(cb) {
      loginUrlCb = cb;
    },
    onExit(cb) {
      exitCb = cb;
    },
    onIdle(cb) {
      idleCb = cb;
    },
  };
}
