import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import type { SessionDTO, TraceDTO } from "../shared/dto.ts";

const DB_PATH = path.join(process.cwd(), "logs", "agentschitzo.db");

function openDb(): Database.Database {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT 'New Session',
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      cwd TEXT NOT NULL,
      startedAt TEXT NOT NULL,
      endedAt TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      exitCode INTEGER
    );
    CREATE TABLE IF NOT EXISTS traces (
      id TEXT PRIMARY KEY,
      sessionId TEXT NOT NULL,
      input TEXT NOT NULL,
      output TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      costUsd REAL NOT NULL DEFAULT 0,
      durationMs INTEGER NOT NULL DEFAULT 0,
      diffs TEXT NOT NULL DEFAULT '',
      stderr TEXT NOT NULL DEFAULT '',
      exitCode INTEGER,
      timestamp TEXT NOT NULL,
      FOREIGN KEY (sessionId) REFERENCES sessions(id)
    );
    CREATE INDEX IF NOT EXISTS idx_traces_session ON traces(sessionId);
    CREATE INDEX IF NOT EXISTS idx_traces_timestamp ON traces(timestamp DESC);
  `);
  return db;
}

const db = openDb();

// Clean up orphan sessions (inactive with no traces)
db.prepare(`
  DELETE FROM sessions WHERE active = 0
  AND NOT EXISTS (SELECT 1 FROM traces WHERE traces.sessionId = sessions.id)
`).run();

// --- Sessions ---

export function upsertSession(s: SessionDTO): void {
  db.prepare(`
    INSERT INTO sessions (id, name, provider, model, cwd, startedAt, endedAt, active, exitCode)
    VALUES (@id, @name, @provider, @model, @cwd, @startedAt, @endedAt, @active, @exitCode)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name, provider=excluded.provider, model=excluded.model,
      cwd=excluded.cwd, endedAt=excluded.endedAt, active=excluded.active, exitCode=excluded.exitCode
  `).run({ ...s, active: s.active ? 1 : 0, endedAt: s.endedAt ?? null, exitCode: s.exitCode ?? null });
}

export function getSession(id: string): SessionDTO | undefined {
  const row = db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return row ? rowToSession(row) : undefined;
}

export function getAllSessions(): SessionDTO[] {
  const withTraces = db.prepare(`
    SELECT s.* FROM sessions s
    WHERE EXISTS (SELECT 1 FROM traces t WHERE t.sessionId = s.id)
    ORDER BY s.startedAt DESC
  `).all() as Record<string, unknown>[];
  const activeNoTraces = db.prepare(`
    SELECT s.* FROM sessions s
    WHERE s.active = 1 AND NOT EXISTS (SELECT 1 FROM traces t WHERE t.sessionId = s.id)
    ORDER BY s.startedAt DESC LIMIT 2
  `).all() as Record<string, unknown>[];
  const seen = new Set(withTraces.map(r => r.id as string));
  const merged = [...withTraces, ...activeNoTraces.filter(r => !seen.has(r.id as string))];
  merged.sort((a, b) => (b.startedAt as string).localeCompare(a.startedAt as string));
  return merged.map(rowToSession);
}

export function getActiveSessions(): SessionDTO[] {
  const rows = db.prepare("SELECT * FROM sessions WHERE active = 1 ORDER BY startedAt DESC").all() as Record<string, unknown>[];
  return rows.map(rowToSession);
}

export function endSession(id: string, exitCode: number | null): void {
  db.prepare("UPDATE sessions SET active=0, endedAt=?, exitCode=? WHERE id=?")
    .run(new Date().toISOString(), exitCode ?? null, id);
}

export function renameSession(id: string, name: string): boolean {
  const result = db.prepare("UPDATE sessions SET name=? WHERE id=?").run(name, id);
  return result.changes > 0;
}

export function autoNameFromPrompt(sessionId: string, prompt: string): void {
  const row = db.prepare("SELECT name FROM sessions WHERE id=?").get(sessionId) as { name: string } | undefined;
  if (row?.name === "New Session") {
    const name = prompt.slice(0, 40).replace(/\n/g, " ").trim();
    db.prepare("UPDATE sessions SET name=? WHERE id=?").run(name, sessionId);
  }
}

// --- Traces ---

export function addTrace(t: TraceDTO): void {
  db.prepare(`
    INSERT OR REPLACE INTO traces (id, sessionId, input, output, provider, model, costUsd, durationMs, diffs, stderr, exitCode, timestamp)
    VALUES (@id, @sessionId, @input, @output, @provider, @model, @costUsd, @durationMs, @diffs, @stderr, @exitCode, @timestamp)
  `).run({ ...t, exitCode: t.exitCode ?? null });
  autoNameFromPrompt(t.sessionId, t.input);
}

export function getTraces(opts?: { sessionId?: string; from?: string; to?: string; limit?: number }): TraceDTO[] {
  let sql = "SELECT * FROM traces WHERE 1=1";
  const params: unknown[] = [];
  if (opts?.sessionId) { sql += " AND sessionId=?"; params.push(opts.sessionId); }
  if (opts?.from) { sql += " AND timestamp>=?"; params.push(opts.from); }
  if (opts?.to) { sql += " AND timestamp<=?"; params.push(opts.to); }
  sql += " ORDER BY timestamp DESC LIMIT ?";
  params.push(opts?.limit ?? 100);
  const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
  return rows.map(rowToTrace);
}

export function getTrace(id: string): TraceDTO | undefined {
  const row = db.prepare("SELECT * FROM traces WHERE id=?").get(id) as Record<string, unknown> | undefined;
  return row ? rowToTrace(row) : undefined;
}

// --- Delete ---

export function deleteSession(id: string): boolean {
  db.prepare("DELETE FROM traces WHERE sessionId=?").run(id);
  const r = db.prepare("DELETE FROM sessions WHERE id=?").run(id);
  return r.changes > 0;
}

// --- Wipe ---

export function wipeAll(): void {
  db.exec("DELETE FROM traces; DELETE FROM sessions;");
}

// --- Helpers ---

function rowToSession(r: Record<string, unknown>): SessionDTO {
  return {
    id: r.id as string,
    name: (r.name as string) || "New Session",
    provider: r.provider as string,
    model: r.model as string,
    cwd: r.cwd as string,
    startedAt: r.startedAt as string,
    endedAt: r.endedAt as string | undefined,
    active: r.active === 1,
    exitCode: r.exitCode as number | null | undefined,
  };
}

function rowToTrace(r: Record<string, unknown>): TraceDTO {
  return {
    id: r.id as string,
    sessionId: r.sessionId as string,
    input: r.input as string,
    output: r.output as string,
    provider: r.provider as string,
    model: r.model as string,
    costUsd: r.costUsd as number,
    durationMs: r.durationMs as number,
    diffs: r.diffs as string,
    stderr: r.stderr as string,
    exitCode: r.exitCode as number | null,
    timestamp: r.timestamp as string,
  };
}
