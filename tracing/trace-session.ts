import { execSync } from "child_process";
import { getLangfuse } from "./langfuse-client.ts";
import type { LangfuseTraceClient } from "langfuse";

export interface TraceSession {
  sessionId: string;
  begin(command: string): void;
  captureOutput(text: string): void;
  captureStderr(text: string): void;
  end(exitCode: number | null): Promise<void>;
}

export function createTraceSession(adapter: string, cwd: string, sessionId: string, model: string): TraceSession {
  const displayModel = model === "auto" ? "claude-auto" : model;
  let trace: LangfuseTraceClient | null = null;
  let generationId: string | null = null;
  let input = "";
  let output = "";
  let stderr = "";
  let startTime: number = 0;

  return {
    sessionId,

    begin(command: string) {
      input = command;
      startTime = Date.now();
      const lf = getLangfuse();
      if (!lf) return;

      try {
        trace = lf.trace({
          name: "agentschitzo-session",
          sessionId,
          input: command,
          metadata: { adapter, cwd },
        });
        const gen = trace.generation({
          name: "execution",
          input: command,
          model: displayModel,
          startTime: new Date(startTime),
        });
        generationId = gen.id;
      } catch { /* non-blocking */ }
    },

    captureOutput(text: string) {
      output += text + "\n";
    },

    captureStderr(text: string) {
      stderr += text + "\n";
    },

    async end(exitCode: number | null) {
      const durationMs = Date.now() - startTime;
      const diffs = captureDiffs(cwd);

      if (!trace || !generationId) return;
      try {
        // Credit-based cost: Kiro Pro = $19/month for 1000 credits
        // 1 credit = $0.019
        const CREDIT_COST = 0.019;
        const MODEL_CREDITS: Record<string, number> = {
          "claude-sonnet-4": 1.30,
          "claude-sonnet-4.5": 1.30,
          "claude-sonnet-4.6": 1.30,
          "claude-opus-4.5": 2.20,
          "claude-opus-4.6": 2.20,
          "claude-haiku-4.5": 0.40,
          "deepseek-3.2": 0.25,
          "auto": 1.00,
        };
        const credits = MODEL_CREDITS[model] ?? 1.00;
        const costUsd = credits * CREDIT_COST;

        // Langfuse calculates cost as: inputTokens * inputPrice + outputTokens * outputPrice
        // We set model pricing to $0.000003/token input, $0.000015/token output
        // To get correct total cost, we put all cost into input tokens:
        // costUsd = inputTokens * 0.000003 → inputTokens = costUsd / 0.000003
        const fakeInputTokens = Math.round(costUsd / 0.000003);

        const lf = getLangfuse();
        if (!lf) return;

        lf.generation({
          id: generationId,
          traceId: trace.id,
          endTime: new Date(),
          output: truncate(output, 100_000),
          model: displayModel,
          usage: { input: fakeInputTokens, output: 0 },
          metadata: {
            exitCode,
            durationMs,
            diffs: truncate(diffs, 10_000),
            stderr: truncate(stderr, 10_000),
            creditsUsed: credits,
            costPerRequest: `$${costUsd.toFixed(4)}`,
          },
        });
        trace.update({ output: truncate(output, 100_000) });
        await lf.flushAsync();
      } catch { /* non-blocking */ }
    },
  };
}

function captureDiffs(cwd: string): string {
  try {
    return execSync("git diff", { cwd, encoding: "utf-8", timeout: 5000 });
  } catch {
    return "";
  }
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + "\n...[truncated]" : text;
}
