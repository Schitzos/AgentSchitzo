import { Router } from "express";
import { sessionStore } from "./session-store.ts";
import type { DashboardSummaryDTO, TopModelDTO, UsageTimelineDTO } from "../shared/dto.ts";

export const apiRouter = Router();

// --- Dashboard ---

apiRouter.get("/dashboard/summary", (_req, res) => {
  const traces = sessionStore.getTraces({ limit: 500 });
  const summary: DashboardSummaryDTO = {
    totalCostUsd: 0,
    totalRequests: traces.length,
    byProvider: {},
    byModel: {},
  };
  for (const t of traces) {
    summary.totalCostUsd += t.costUsd;
    if (!summary.byProvider[t.provider]) summary.byProvider[t.provider] = { requests: 0, costUsd: 0 };
    summary.byProvider[t.provider].requests++;
    summary.byProvider[t.provider].costUsd += t.costUsd;
    if (!summary.byModel[t.model]) summary.byModel[t.model] = { requests: 0, costUsd: 0 };
    summary.byModel[t.model].requests++;
    summary.byModel[t.model].costUsd += t.costUsd;
  }
  res.json(summary);
});

apiRouter.get("/dashboard/usage-timeline", (_req, res) => {
  const traces = sessionStore.getTraces({ limit: 500 });
  const byDate: Record<string, UsageTimelineDTO> = {};
  for (const t of traces) {
    const date = t.timestamp.slice(0, 10);
    if (!byDate[date]) byDate[date] = { date, costUsd: 0, requests: 0 };
    byDate[date].costUsd += t.costUsd;
    byDate[date].requests++;
  }
  res.json(Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date)));
});

apiRouter.get("/dashboard/top-models", (_req, res) => {
  const traces = sessionStore.getTraces({ limit: 500 });
  const byModel: Record<string, TopModelDTO> = {};
  for (const t of traces) {
    if (!byModel[t.model]) byModel[t.model] = { model: t.model, provider: t.provider, requests: 0, costUsd: 0, avgLatencyMs: 0 };
    byModel[t.model].requests++;
    byModel[t.model].costUsd += t.costUsd;
    byModel[t.model].avgLatencyMs += t.durationMs;
  }
  const result = Object.values(byModel).map((m) => ({
    ...m,
    avgLatencyMs: m.requests > 0 ? Math.round(m.avgLatencyMs / m.requests) : 0,
  })).sort((a, b) => b.requests - a.requests).slice(0, 5);
  res.json(result);
});

apiRouter.get("/dashboard/latencies", (_req, res) => {
  const traces = sessionStore.getTraces({ limit: 100 });
  const byModel: Record<string, number[]> = {};
  for (const t of traces) {
    if (!byModel[t.model]) byModel[t.model] = [];
    byModel[t.model].push(t.durationMs);
  }
  const result = Object.entries(byModel).map(([model, latencies]) => ({
    model,
    p50: percentile(latencies, 50),
    p95: percentile(latencies, 95),
    avg: Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length),
  }));
  res.json(result);
});

// --- Sessions ---

apiRouter.get("/sessions", (_req, res) => {
  res.json(sessionStore.getAllSessions());
});

apiRouter.get("/sessions/:id", (req, res) => {
  const s = sessionStore.getSession(req.params.id);
  if (!s) return res.status(404).json({ error: "Not found" });
  const traces = sessionStore.getTraces({ sessionId: req.params.id });
  res.json({ ...s, traces });
});

apiRouter.patch("/sessions/:id", (req, res) => {
  const { name } = req.body as { name?: string };
  if (!name?.trim()) return res.status(400).json({ error: "name required" });
  const ok = sessionStore.renameSession(req.params.id, name.trim());
  if (!ok) return res.status(404).json({ error: "Not found" });
  res.json({ ok: true });
});

apiRouter.delete("/sessions/:id", (req, res) => {
  if (sessionDeleteBridge) sessionDeleteBridge(req.params.id);
  const ok = sessionStore.deleteSession(req.params.id);
  if (!ok) return res.status(404).json({ error: "Not found" });
  res.json({ ok: true });
});

// --- Traces ---

apiRouter.get("/traces", (req, res) => {
  const { sessionId, from, to, limit } = req.query as Record<string, string>;
  res.json(sessionStore.getTraces({ sessionId, from, to, limit: limit ? parseInt(limit) : 100 }));
});

apiRouter.get("/traces/:id", (req, res) => {
  const t = sessionStore.getTrace(req.params.id);
  if (!t) return res.status(404).json({ error: "Not found" });
  res.json(t);
});

// --- Status ---

apiRouter.get("/status", (_req, res) => {
  const active = sessionStore.getActiveSessions();
  res.json({ activeSessions: active.length, sessions: active });
});

// --- Chat (browser prompt submission) ---
let chatBridge: ((prompt: string, sessionId?: string) => Promise<{ queued: boolean; sessionActive: boolean; sessionId?: string; message: string }>) | null = null;
let sessionStartBridge: (() => Promise<{ ok: boolean; message: string }>) | null = null;
let sessionNewBridge: (() => Promise<{ ok: boolean; sessionId: string | null; message: string }>) | null = null;
let sessionDeleteBridge: ((id: string) => void) | null = null;

export function setChatBridge(fn: typeof chatBridge): void { chatBridge = fn; }
export function setSessionStartBridge(fn: typeof sessionStartBridge): void { sessionStartBridge = fn; }
export function setSessionNewBridge(fn: typeof sessionNewBridge): void { sessionNewBridge = fn; }
export function setSessionDeleteBridge(fn: typeof sessionDeleteBridge): void { sessionDeleteBridge = fn; }

apiRouter.post("/session/start", async (_req, res) => {
  if (!sessionStartBridge) return res.json({ ok: false, message: "Server not ready" });
  try { res.json(await sessionStartBridge()); }
  catch (e: unknown) { res.status(500).json({ ok: false, message: e instanceof Error ? e.message : "Internal error" }); }
});

apiRouter.post("/session/new", async (_req, res) => {
  if (!sessionNewBridge) return res.json({ ok: false, message: "Server not ready" });
  try { res.json(await sessionNewBridge()); }
  catch (e: unknown) { res.status(500).json({ ok: false, message: e instanceof Error ? e.message : "Internal error" }); }
});

apiRouter.post("/chat/send", async (req, res) => {
  const { prompt, sessionId } = req.body as { prompt?: string; sessionId?: string };
  if (!prompt?.trim()) return res.status(400).json({ error: "prompt required" });
  if (!chatBridge) return res.json({ queued: false, sessionActive: false, message: "No active session." });
  try {
    const result = await chatBridge(prompt.trim(), sessionId);
    res.json(result);
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : "Internal error" });
  }
});

apiRouter.post("/provider/select", (req, res) => {
  res.json({ ok: true, message: "Use /provider command in Telegram to switch providers" });
});

apiRouter.post("/model/select", (req, res) => {
  res.json({ ok: true, message: "Use /model command in Telegram to switch models" });
});

// --- Project folder picker ---
let projectBridge: ((dir: string) => { ok: boolean; cwd: string; message: string }) | null = null;
export function setProjectBridge(fn: typeof projectBridge): void { projectBridge = fn; }

apiRouter.get("/project/current", (_req, res) => {
  if (!projectBridge) return res.json({ cwd: process.cwd() });
  const result = projectBridge("");
  res.json({ cwd: result.cwd });
});

apiRouter.post("/project/select", (req, res) => {
  const { path: dir } = req.body as { path?: string };
  if (!dir?.trim()) return res.status(400).json({ error: "path required" });
  if (!projectBridge) return res.status(500).json({ error: "Not ready" });
  const result = projectBridge(dir.trim());
  if (!result.ok) return res.status(400).json({ error: result.message });
  res.json(result);
});

apiRouter.get("/project/pick", async (_req, res) => {
  // Open native folder picker dialog
  const { execSync } = await import("child_process");
  try {
    let dir: string;
    if (process.platform === "darwin") {
      dir = execSync(`osascript -e 'set f to POSIX path of (choose folder with prompt "Select project folder")' -e 'return f'`, { encoding: "utf-8", timeout: 120000, stdio: ["pipe", "pipe", "pipe"] }).trim();
    } else if (process.platform === "win32") {
      dir = execSync(`powershell -Command "Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.FolderBrowserDialog; if($f.ShowDialog() -eq 'OK'){$f.SelectedPath}"`, { encoding: "utf-8", timeout: 120000 }).trim();
    } else {
      dir = execSync(`zenity --file-selection --directory 2>/dev/null || kdialog --getexistingdirectory ~ 2>/dev/null`, { encoding: "utf-8", timeout: 120000 }).trim();
    }
    if (!dir) return res.json({ ok: false, path: null });
    res.json({ ok: true, path: dir.replace(/\/$/, "") });
  } catch {
    res.json({ ok: false, path: null });
  }
});

// Helper
function percentile(arr: number[], p: number): number {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.floor((p / 100) * sorted.length);
  return sorted[Math.min(idx, sorted.length - 1)];
}
