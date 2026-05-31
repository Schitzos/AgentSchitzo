import type {
  DashboardSummaryDTO,
  UsageTimelineDTO,
  TopModelDTO,
  SessionDTO,
  TraceDTO,
  ChatSendResponseDTO,
} from "../types/dto";

const BASE = "/api";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

async function patch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

async function del<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

export const api = {
  dashboard: {
    summary: () => get<DashboardSummaryDTO>("/dashboard/summary"),
    timeline: () => get<UsageTimelineDTO[]>("/dashboard/usage-timeline"),
    topModels: () => get<TopModelDTO[]>("/dashboard/top-models"),
    latencies: () => get<{ model: string; p50: number; p95: number; avg: number }[]>("/dashboard/latencies"),
  },
  sessions: {
    list: () => get<SessionDTO[]>("/sessions"),
    get: (id: string) => get<SessionDTO & { traces: TraceDTO[] }>(`/sessions/${id}`),
    rename: (id: string, name: string) => patch<{ ok: boolean }>(`/sessions/${id}`, { name }),
    delete: (id: string) => del<{ ok: boolean }>(`/sessions/${id}`),
  },
  traces: {
    list: (params?: { sessionId?: string; from?: string; to?: string; limit?: number }) => {
      const q = new URLSearchParams();
      if (params?.sessionId) q.set("sessionId", params.sessionId);
      if (params?.from) q.set("from", params.from);
      if (params?.to) q.set("to", params.to);
      if (params?.limit) q.set("limit", String(params.limit));
      return get<TraceDTO[]>(`/traces?${q}`);
    },
    get: (id: string) => get<TraceDTO>(`/traces/${id}`),
  },
  chat: {
    send: (prompt: string, sessionId?: string) => post<ChatSendResponseDTO>("/chat/send", { prompt, sessionId }),
  },
  session: {
    start: () => post<{ ok: boolean; message: string }>("/session/start", {}),
    new: () => post<{ ok: boolean; sessionId: string | null; message: string }>("/session/new", {}),
    startWithProvider: (provider: string) => post<{ ok: boolean; sessionId: string | null; message: string }>("/session/start-with-provider", { provider }),
  },
  providers: {
    list: () => get<{ providers: string[] }>("/providers"),
  },
  provider: {
    select: (provider: string) => post("/provider/select", { provider }),
    model: (model: string) => post("/model/select", { model }),
  },
  project: {
    current: () => get<{ cwd: string }>("/project/current"),
    pick: () => get<{ ok: boolean; path: string | null }>("/project/pick"),
    select: (path: string) => post<{ ok: boolean; cwd: string; message: string }>("/project/select", { path }),
  },
  status: () => get<{ activeSessions: number; sessions: (SessionDTO & { costUsd?: number })[] }>("/status"),
  budget: {
    get: () => get<{ providerLimits: Record<string, number>; alertThreshold: number; providerSpent: Record<string, number> }>("/settings/budget"),
    set: (body: { providerLimits?: Record<string, number>; alertThreshold?: number }) =>
      post<{ ok: boolean }>("/settings/budget", body),
  },
  upload: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return fetch(`${BASE}/upload`, { method: "POST", body: form }).then((r) => r.json()) as Promise<{ ok: boolean; path: string; name: string }>;
  },
};
