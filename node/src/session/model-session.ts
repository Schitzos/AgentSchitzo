import { spawn, type ChildProcess } from "child_process";
import type { CliModelAdapter } from "../adapters/cli-model-adapter.ts";
import { createOutputBuffer } from "./output-buffer.ts";

export type SessionState = "idle" | "processing" | "stopped";

export interface ModelSession {
  state(): SessionState;
  adapterName(): string;
  write(input: string): boolean;
  interrupt(): void;
  kill(): void;
  onOutput(cb: (text: string) => void): void;
  onStderr(cb: (text: string) => void): void;
  onLoginUrl(cb: (url: string) => void): void;
  onProcessEnd(cb: (code: number | null) => void): void;
  onExit(cb: (code: number | null) => void): void;
  onIdle(cb: () => void): void;
  start(): void;
}

export interface ModelSessionOptions {
  adapter: CliModelAdapter;
  cwd: string;
  model?: string;
  debounceMs?: number;
  timeoutMs?: number;
}

export function createModelSession(opts: ModelSessionOptions): ModelSession {
  const { adapter, cwd, model, debounceMs = 500, timeoutMs = 300_000 } = opts;

  let proc: ChildProcess | null = null;
  let currentState: SessionState = "idle";
  let outputCb: ((text: string) => void) | null = null;
  let stderrCb: ((text: string) => void) | null = null;
  let loginUrlCb: ((url: string) => void) | null = null;
  let processEndCb: ((code: number | null) => void) | null = null;
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

    const args = [...adapter.buildArgs(cwd, model), input];

    proc = spawn(adapter.command, args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });

    // Close stdin for CLIs that read from it (e.g. codex) to prevent hanging
    if (adapter.closeStdin) proc.stdin?.end();

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

      if (adapter.mergeStderr) {
        // Filter out log noise (timestamps + ERROR/WARN lines, even inline)
        const filtered = text.replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z\s+\w+\s+\S+:[^\n]*/g, "")
          .replace(/^-{3,}$/gm, "")
          .replace(/^(?:workdir|model|provider|approval|sandbox|reasoning effort|reasoning summaries|session id):.*$/gm, "")
          .replace(/^(?:warning:).*$/gm, "")
          .trim();
        if (filtered) buffer.append(filtered);
      } else if (stderrCb) {
        stderrCb(text);
      }
    });

    proc.on("exit", (code) => {
      if (silenceTimer) clearTimeout(silenceTimer);
      proc = null;
      currentState = stopped ? "stopped" : "idle";
      buffer.flush();
      buffer.destroy();
      // Don't fire processEndCb/idleCb if session was explicitly killed
      if (!stopped) {
        if (processEndCb) processEndCb(code);
        setImmediate(() => { if (idleCb) idleCb(); });
      } else {
        if (exitCb) exitCb(code);
      }
    });
  }

  return {
    state: () => currentState,
    adapterName: () => adapter.name,
    start() {
      // No-op for per-message mode; session is "started" and ready
      currentState = "idle";
    },
    write(input: string): boolean {
      if (stopped) return false;
      if (proc) return false;
      runCommand(input);
      return true;
    },
    interrupt() {
      if (proc) {
        proc.kill("SIGINT");
        // Don't set state to idle here — let the proc "exit" handler do it.
        // If process doesn't die within 5s, force kill it.
        const p = proc;
        setTimeout(() => { if (proc === p) p.kill("SIGKILL"); }, 5000);
      }
    },
    kill() {
      stopped = true;
      if (proc) proc.kill("SIGTERM");
      currentState = "stopped";
      // exitCb will fire from proc.on("exit") when the process actually dies
      // If no process is running, fire exitCb immediately
      if (!proc && exitCb) exitCb(0);
    },
    onOutput(cb) {
      outputCb = cb;
    },
    onStderr(cb) {
      stderrCb = cb;
    },
    onLoginUrl(cb) {
      loginUrlCb = cb;
    },
    onProcessEnd(cb) {
      processEndCb = cb;
    },
    onExit(cb) {
      exitCb = cb;
    },
    onIdle(cb) {
      idleCb = cb;
    },
  };
}
