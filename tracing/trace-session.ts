import { execSync } from "child_process";
import { getLangfuse } from "./langfuse-client.ts";
import type { LangfuseGenerationClient, LangfuseTraceClient } from "langfuse";
import { estimateCostUsd } from "./model-pricing.ts";

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
  let generation: LangfuseGenerationClient | null = null;
  let input = "";
  let output = "";
  let stderr = "";
  let startTime = 0;
  let ended = false;

  return {
    sessionId,

    begin(command: string) {
      ended = false;
      input = command;
      output = "";
      stderr = "";
      startTime = Date.now();
      const lf = getLangfuse();
      if (!lf) return;

      try {
        trace = lf.trace({
          name: "agentschitzo-session",
          sessionId,
          input: command,
          metadata: { adapter, cwd, model: displayModel },
        });
        generation = trace.generation({
          name: "execution",
          input: command,
          model: displayModel,
          startTime: new Date(startTime),
        });
      } catch { /* non-blocking */ }
    },

    captureOutput(text: string) {
      output += text + "\n";
    },

    captureStderr(text: string) {
      stderr += text + "\n";
    },

    async end(exitCode: number | null) {
      if (ended) return;
      ended = true;

      const durationMs = Date.now() - startTime;
      const diffs = captureDiffs(cwd);

      if (!trace || !generation) return;
      try {
        const costEstimate = estimateCostUsd(adapter, model, input, output, stderr);

        const lf = getLangfuse();
        if (!lf) return;

        generation.end({
          output: truncate(output, 100_000),
          model: displayModel,
          usage: {
            input: costEstimate.inputTokens,
            output: costEstimate.outputTokens,
            total: costEstimate.totalTokens,
            unit: "TOKENS",
            inputCost: costEstimate.costUsd,
            outputCost: 0,
            totalCost: costEstimate.costUsd,
          },
          usageDetails: {
            input: costEstimate.inputTokens,
            output: costEstimate.outputTokens,
            total: costEstimate.totalTokens,
          },
          costDetails: {
            input: costEstimate.costUsd,
            output: 0,
            total: costEstimate.costUsd,
          },
          metadata: {
            input,
            exitCode,
            durationMs,
            diffs: truncate(diffs, 10_000),
            stderr: truncate(stderr, 10_000),
            costPerRequest: `$${costEstimate.costUsd.toFixed(4)}`,
            pricingSource: costEstimate.pricingSource,
          },
        });
        trace.update({
          output: truncate(output, 100_000),
          metadata: { adapter, cwd, model: displayModel, exitCode, durationMs },
        });
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
