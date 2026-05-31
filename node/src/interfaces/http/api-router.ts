import { Router } from "express";
import { createDashboardService } from "../../application/dashboard/dashboard-service.ts";
import { createSessionQueryService } from "../../application/session/session-query-service.ts";
import {
  getChatBridge,
  getProjectBridge,
  getProviderBridge,
  getSessionDeleteBridge,
  getSessionNewBridge,
  getSessionStartBridge,
} from "../../application/api/bridge-registry.ts";
import { sessionRepository } from "../../server/session-repository.ts";
import { listAdapters } from "../../adapters/index.ts";
import { getBudget, setBudget, manualReset } from "../../application/agent/budget.ts";
import { getProviderTotalCost } from "../../server/db.ts";
import multer from "multer";
import path from "path";
import fs from "fs";

export const apiRouter = Router();

const dashboardService = createDashboardService(sessionRepository);
const sessionQueryService = createSessionQueryService(sessionRepository);

apiRouter.get("/dashboard/summary", (_req, res) => {
  res.json(dashboardService.getSummary());
});

apiRouter.get("/dashboard/usage-timeline", (_req, res) => {
  res.json(dashboardService.getUsageTimeline());
});

apiRouter.get("/dashboard/top-models", (_req, res) => {
  res.json(dashboardService.getTopModels());
});

apiRouter.get("/dashboard/latencies", (_req, res) => {
  res.json(dashboardService.getLatencies());
});

apiRouter.get("/sessions", (_req, res) => {
  res.json(sessionQueryService.listSessions());
});

apiRouter.get("/sessions/:id", (req, res) => {
  const session = sessionQueryService.getSessionDetails(req.params.id);
  if (!session) return res.status(404).json({ error: "Not found" });
  res.json(session);
});

apiRouter.patch("/sessions/:id", (req, res) => {
  const { name } = req.body as { name?: string };
  const result = sessionQueryService.renameSession(req.params.id, name ?? "");
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  res.json({ ok: true });
});

apiRouter.delete("/sessions/:id", (req, res) => {
  const sessionDeleteBridge = getSessionDeleteBridge();
  if (sessionDeleteBridge) sessionDeleteBridge(req.params.id);
  const result = sessionQueryService.deleteSession(req.params.id);
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  res.json({ ok: true });
});

apiRouter.get("/traces", (req, res) => {
  const { sessionId, from, to, limit } = req.query as Record<string, string>;
  res.json(sessionQueryService.listTraces({ sessionId, from, to, limit: limit ? parseInt(limit) : 100 }));
});

apiRouter.get("/traces/:id", (req, res) => {
  const trace = sessionQueryService.getTrace(req.params.id);
  if (!trace) return res.status(404).json({ error: "Not found" });
  res.json(trace);
});

apiRouter.get("/status", (_req, res) => {
  res.json(sessionQueryService.getStatus());
});

apiRouter.post("/session/start", async (_req, res) => {
  const sessionStartBridge = getSessionStartBridge();
  if (!sessionStartBridge) return res.json({ ok: false, message: "Server not ready" });
  try { res.json(await sessionStartBridge()); }
  catch (e: unknown) { res.status(500).json({ ok: false, message: e instanceof Error ? e.message : "Internal error" }); }
});

apiRouter.post("/session/new", async (_req, res) => {
  const sessionNewBridge = getSessionNewBridge();
  if (!sessionNewBridge) return res.json({ ok: false, message: "Server not ready" });
  try { res.json(await sessionNewBridge()); }
  catch (e: unknown) { res.status(500).json({ ok: false, message: e instanceof Error ? e.message : "Internal error" }); }
});

apiRouter.post("/chat/send", async (req, res) => {
  const { prompt, sessionId } = req.body as { prompt?: string; sessionId?: string };
  if (!prompt?.trim()) return res.status(400).json({ error: "prompt required" });
  const chatBridge = getChatBridge();
  if (!chatBridge) return res.json({ queued: false, sessionActive: false, message: "No active session." });
  try {
    const result = await chatBridge(prompt.trim(), sessionId);
    res.json(result);
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : "Internal error" });
  }
});

apiRouter.get("/providers", (_req, res) => {
  res.json({ providers: listAdapters() });
});

apiRouter.post("/session/start-with-provider", async (req, res) => {
  const { provider } = req.body as { provider?: string };
  if (!provider?.trim()) return res.status(400).json({ error: "provider required" });
  const providerBridge = getProviderBridge();
  if (!providerBridge) return res.json({ ok: false, message: "Server not ready" });
  try { res.json(await providerBridge(provider.trim())); }
  catch (e: unknown) { res.status(500).json({ ok: false, message: e instanceof Error ? e.message : "Internal error" }); }
});

apiRouter.post("/provider/select", (_req, res) => {
  res.json({ ok: true, message: "Use /provider command in Telegram to switch providers" });
});

apiRouter.post("/model/select", (_req, res) => {
  res.json({ ok: true, message: "Use /model command in Telegram to switch models" });
});

apiRouter.get("/project/current", (_req, res) => {
  const projectBridge = getProjectBridge();
  if (!projectBridge) return res.json({ cwd: process.cwd() });
  const result = projectBridge("");
  res.json({ cwd: result.cwd });
});

apiRouter.post("/project/select", (req, res) => {
  const { path: dir } = req.body as { path?: string };
  if (!dir?.trim()) return res.status(400).json({ error: "path required" });
  const projectBridge = getProjectBridge();
  if (!projectBridge) return res.status(500).json({ error: "Not ready" });
  const result = projectBridge(dir.trim());
  if (!result.ok) return res.status(400).json({ error: result.message });
  res.json(result);
});

apiRouter.get("/project/pick", async (_req, res) => {
  const { spawn } = await import("child_process");
  try {
    const result = await new Promise<string>((resolve, reject) => {
      let cmd: string, args: string[];
      if (process.platform === "darwin") {
        cmd = "osascript";
        args = ["-e", "set f to POSIX path of (choose folder with prompt \"Select project folder\")", "-e", "return f"];
      } else if (process.platform === "win32") {
        cmd = "powershell";
        args = ["-Command", "Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.FolderBrowserDialog; if($f.ShowDialog() -eq 'OK'){$f.SelectedPath}"];
      } else {
        cmd = "sh";
        args = ["-c", "zenity --file-selection --directory 2>/dev/null || kdialog --getexistingdirectory ~ 2>/dev/null"];
      }
      const proc = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
      let out = "";
      proc.stdout?.on("data", (d: Buffer) => { out += d.toString(); });
      const timer = setTimeout(() => { proc.kill(); reject(new Error("timeout")); }, 120000);
      proc.on("close", () => { clearTimeout(timer); resolve(out.trim()); });
      proc.on("error", reject);
    });
    if (!result) return res.json({ ok: false, path: null });
    res.json({ ok: true, path: result.replace(/\/$/, "") });
  } catch {
    res.json({ ok: false, path: null });
  }
});

// Budget settings
apiRouter.get("/settings/budget", (_req, res) => {
  res.json(getBudget(getProviderTotalCost));
});

apiRouter.post("/settings/budget", (req, res) => {
  const { providerLimits, alertThreshold } = req.body as {
    providerLimits?: Record<string, number>;
    alertThreshold?: number;
  };
  setBudget({ providerLimits, alertThreshold });
  res.json({ ok: true });
});

apiRouter.post("/settings/budget/reset", (_req, res) => {
  manualReset(getProviderTotalCost);
  res.json({ ok: true });
});

// File upload for context injection
const uploadsDir = path.join(process.cwd(), "uploads");
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      fs.mkdirSync(uploadsDir, { recursive: true });
      cb(null, uploadsDir);
    },
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

apiRouter.post("/upload", upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file" });
  res.json({ ok: true, path: req.file.path, name: req.file.originalname });
});
