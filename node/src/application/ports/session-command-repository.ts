import type { SessionDTO, TraceDTO } from "../../shared/dto.ts";

export interface SessionCommandRepository {
  upsertSession(session: SessionDTO): void;
  endSession(id: string, exitCode: number | null): void;
  addTrace(trace: TraceDTO): void;
}
