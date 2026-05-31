import type { SessionRepository, TraceQuery } from "../ports/session-repository.ts";

export function createSessionQueryService(repository: SessionRepository) {
  return {
    listSessions() {
      return repository.getAllSessions();
    },

    getSessionDetails(id: string) {
      const session = repository.getSession(id);
      if (!session) return null;
      const traces = repository.getTraces({ sessionId: id });
      return { ...session, traces };
    },

    renameSession(id: string, name: string) {
      if (!name.trim()) return { ok: false as const, error: "name required", status: 400 };
      const ok = repository.renameSession(id, name.trim());
      if (!ok) return { ok: false as const, error: "Not found", status: 404 };
      return { ok: true as const };
    },

    deleteSession(id: string) {
      const ok = repository.deleteSession(id);
      if (!ok) return { ok: false as const, error: "Not found", status: 404 };
      return { ok: true as const };
    },

    listTraces(query: TraceQuery) {
      return repository.getTraces(query);
    },

    getTrace(id: string) {
      return repository.getTrace(id) ?? null;
    },

    getStatus() {
      const sessions = repository.getActiveSessions();
      const sessionsWithCost = sessions.map((s) => {
        const traces = repository.getTraces({ sessionId: s.id });
        const costUsd = traces.reduce((sum, t) => sum + (t.costUsd ?? 0), 0);
        return { ...s, costUsd };
      });
      return { activeSessions: sessions.length, sessions: sessionsWithCost };
    },
  };
}
