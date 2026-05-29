// Shared DTOs between backend API and browser frontend

export interface SessionDTO {
  id: string;
  name: string;
  provider: string;
  model: string;
  cwd: string;
  startedAt: string;
  endedAt?: string;
  active: boolean;
  exitCode?: number | null;
}

export interface TraceDTO {
  id: string;
  sessionId: string;
  input: string;
  output: string;
  provider: string;
  model: string;
  costUsd: number;
  durationMs: number;
  diffs: string;
  stderr: string;
  exitCode: number | null;
  timestamp: string;
}

export interface DashboardSummaryDTO {
  totalCostUsd: number;
  totalRequests: number;
  byProvider: Record<string, { requests: number; costUsd: number }>;
  byModel: Record<string, { requests: number; costUsd: number }>;
}

export interface UsageTimelineDTO {
  date: string;
  costUsd: number;
  requests: number;
}

export interface TopModelDTO {
  model: string;
  provider: string;
  requests: number;
  costUsd: number;
  avgLatencyMs: number;
}

export interface ChatSendDTO {
  prompt: string;
  sessionId?: string;
}

export interface ChatSendResponseDTO {
  queued: boolean;
  sessionActive: boolean;
  sessionId?: string;
  message: string;
}

export interface ProviderSelectDTO {
  provider: string;
}

export interface ModelSelectDTO {
  model: string;
}

// WebSocket event types
export type WsEventType =
  | "session.started"
  | "session.updated"
  | "session.output"
  | "session.completed"
  | "trace.updated"
  | "cost.updated"
  | "connected";

export interface WsEvent {
  type: WsEventType;
  payload: Record<string, unknown>;
  timestamp: string;
}
