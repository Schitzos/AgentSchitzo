import type { SessionCommandRepository } from "../application/ports/session-command-repository.ts";
import { sessionStore } from "./session-store.ts";

export const sessionCommandRepository: SessionCommandRepository = {
  upsertSession: (session) => sessionStore.upsertSession(session),
  endSession: (id, exitCode) => sessionStore.endSession(id, exitCode),
  addTrace: (trace) => sessionStore.addTrace(trace),
};
