import type { DashboardSummaryDTO, TopModelDTO, TraceDTO, UsageTimelineDTO } from "../../shared/dto.ts";
import type { SessionRepository } from "../ports/session-repository.ts";

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.floor((p / 100) * sorted.length);
  return sorted[Math.min(idx, sorted.length - 1)];
}

export function createDashboardService(repository: SessionRepository) {
  function getRecentTraces(limit: number): TraceDTO[] {
    return repository.getTraces({ limit });
  }

  return {
    getSummary(): DashboardSummaryDTO {
      const traces = getRecentTraces(500);
      const summary: DashboardSummaryDTO = {
        totalCostUsd: 0,
        totalRequests: traces.length,
        byProvider: {},
        byModel: {},
      };
      for (const trace of traces) {
        summary.totalCostUsd += trace.costUsd;
        if (!summary.byProvider[trace.provider]) {
          summary.byProvider[trace.provider] = { requests: 0, costUsd: 0 };
        }
        summary.byProvider[trace.provider].requests++;
        summary.byProvider[trace.provider].costUsd += trace.costUsd;
        if (!summary.byModel[trace.model]) {
          summary.byModel[trace.model] = { requests: 0, costUsd: 0 };
        }
        summary.byModel[trace.model].requests++;
        summary.byModel[trace.model].costUsd += trace.costUsd;
      }
      return summary;
    },

    getUsageTimeline(): UsageTimelineDTO[] {
      const traces = getRecentTraces(500);
      const byDate: Record<string, UsageTimelineDTO> = {};
      for (const trace of traces) {
        const date = trace.timestamp.slice(0, 10);
        if (!byDate[date]) byDate[date] = { date, costUsd: 0, requests: 0 };
        byDate[date].costUsd += trace.costUsd;
        byDate[date].requests++;
      }
      return Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));
    },

    getTopModels(): TopModelDTO[] {
      const traces = getRecentTraces(500);
      const byModel: Record<string, TopModelDTO> = {};
      for (const trace of traces) {
        if (!byModel[trace.model]) {
          byModel[trace.model] = {
            model: trace.model,
            provider: trace.provider,
            requests: 0,
            costUsd: 0,
            avgLatencyMs: 0,
          };
        }
        byModel[trace.model].requests++;
        byModel[trace.model].costUsd += trace.costUsd;
        byModel[trace.model].avgLatencyMs += trace.durationMs;
      }
      return Object.values(byModel)
        .map((model) => ({
          ...model,
          avgLatencyMs: model.requests > 0 ? Math.round(model.avgLatencyMs / model.requests) : 0,
        }))
        .sort((a, b) => b.requests - a.requests)
        .slice(0, 5);
    },

    getLatencies(): Array<{ model: string; p50: number; p95: number; avg: number }> {
      const traces = getRecentTraces(100);
      const byModel: Record<string, number[]> = {};
      for (const trace of traces) {
        if (!byModel[trace.model]) byModel[trace.model] = [];
        byModel[trace.model].push(trace.durationMs);
      }
      return Object.entries(byModel).map(([model, latencies]) => ({
        model,
        p50: percentile(latencies, 50),
        p95: percentile(latencies, 95),
        avg: Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length),
      }));
    },
  };
}
