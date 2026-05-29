// session-store.ts now delegates to SQLite via db.ts
export {
  upsertSession,
  getSession,
  getAllSessions,
  getActiveSessions,
  endSession,
  renameSession,
  autoNameFromPrompt,
  deleteSession,
  addTrace,
  getTraces,
  getTrace,
  wipeAll,
} from "./db.ts";

// Compatibility shim for code that imports sessionStore
import * as db from "./db.ts";
import type { SessionDTO, TraceDTO } from "../shared/dto.ts";

export const sessionStore = {
  upsertSession: (s: SessionDTO) => db.upsertSession(s),
  getSession: (id: string) => db.getSession(id),
  getAllSessions: () => db.getAllSessions(),
  getActiveSessions: () => db.getActiveSessions(),
  endSession: (id: string, code: number | null) => db.endSession(id, code),
  renameSession: (id: string, name: string) => db.renameSession(id, name),
  deleteSession: (id: string) => db.deleteSession(id),
  addTrace: (t: TraceDTO) => db.addTrace(t),
  getTraces: (opts?: { sessionId?: string; from?: string; to?: string; limit?: number }) => db.getTraces(opts),
  getTrace: (id: string) => db.getTrace(id),
};
