import type { SessionDTO, TraceDTO } from "../../shared/dto.ts";

export interface TraceQuery {
  sessionId?: string;
  provider?: string;
  from?: string;
  to?: string;
  limit?: number;
}

export interface SessionRepository {
  getSession(id: string): SessionDTO | undefined;
  getAllSessions(): SessionDTO[];
  getActiveSessions(): SessionDTO[];
  renameSession(id: string, name: string): boolean;
  deleteSession(id: string): boolean;
  getTraces(query?: TraceQuery): TraceDTO[];
  getTrace(id: string): TraceDTO | undefined;
}
