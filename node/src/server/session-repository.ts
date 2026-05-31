import type { SessionRepository } from "../application/ports/session-repository.ts";
import { sessionStore } from "./session-store.ts";

export const sessionRepository: SessionRepository = {
  getSession: (id) => sessionStore.getSession(id),
  getAllSessions: () => sessionStore.getAllSessions(),
  getActiveSessions: () => sessionStore.getActiveSessions(),
  renameSession: (id, name) => sessionStore.renameSession(id, name),
  deleteSession: (id) => sessionStore.deleteSession(id),
  getTraces: (query) => sessionStore.getTraces(query),
  getTrace: (id) => sessionStore.getTrace(id),
};
