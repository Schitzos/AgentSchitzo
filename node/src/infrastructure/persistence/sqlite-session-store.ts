import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import type { SessionDTO, TraceDTO } from "../../shared/dto.ts";

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
      exitCode INTEGER,
      hidden INTEGER NOT NULL DEFAULT 0
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
// Migration: add hidden column if it doesn't exist
try { db.exec("ALTER TABLE sessions ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0"); } catch (e) {
  if (!(e instanceof Error && e.message.includes("duplicate column"))) throw e;
}

db.prepare(`
  DELETE FROM sessions WHERE active = 0 AND hidden = 0
  AND NOT EXISTS (SELECT 1 FROM traces WHERE traces.sessionId = sessions.id)
  AND startedAt < datetime('now', '-1 day')
`).run();

export function upsertSession(session: SessionDTO): void {
  db.prepare(`
    INSERT INTO sessions (id, name, provider, model, cwd, startedAt, endedAt, active, exitCode)
    VALUES (@id, @name, @provider, @model, @cwd, @startedAt, @endedAt, @active, @exitCode)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name, provider=excluded.provider, model=excluded.model,
      cwd=excluded.cwd, endedAt=excluded.endedAt, active=excluded.active, exitCode=excluded.exitCode
  `).run({
    ...session,
    active: session.active ? 1 : 0,
    endedAt: session.endedAt ?? null,
    exitCode: session.exitCode ?? null,
  });
}

export function getSession(id: string): SessionDTO | undefined {
  const row = db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return row ? rowToSession(row) : undefined;
}

export function getAllSessions(): SessionDTO[] {
  const withTraces = db.prepare(`
    SELECT s.* FROM sessions s
    WHERE s.hidden = 0 AND EXISTS (SELECT 1 FROM traces t WHERE t.sessionId = s.id)
    ORDER BY s.startedAt DESC
  `).all() as Record<string, unknown>[];
  const activeNoTraces = db.prepare(`
    SELECT s.* FROM sessions s
    WHERE s.hidden = 0 AND s.active = 1 AND NOT EXISTS (SELECT 1 FROM traces t WHERE t.sessionId = s.id)
    ORDER BY s.startedAt DESC LIMIT 2
  `).all() as Record<string, unknown>[];
  const seen = new Set(withTraces.map((row) => row.id as string));
  const merged = [...withTraces, ...activeNoTraces.filter((row) => !seen.has(row.id as string))];
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

export function addTrace(trace: TraceDTO): void {
  db.prepare(`
    INSERT OR REPLACE INTO traces (id, sessionId, input, output, provider, model, costUsd, durationMs, diffs, stderr, exitCode, timestamp)
    VALUES (@id, @sessionId, @input, @output, @provider, @model, @costUsd, @durationMs, @diffs, @stderr, @exitCode, @timestamp)
  `).run({ ...trace, exitCode: trace.exitCode ?? null });
  autoNameFromPrompt(trace.sessionId, trace.input);
}

export function getProviderTotalCost(provider: string): number {
  const row = db.prepare(
    "SELECT COALESCE(SUM(costUsd), 0) as total FROM traces WHERE provider = ?"
  ).get(provider) as { total: number };
  return row.total;
}

export function getTraces(opts?: { sessionId?: string; provider?: string; from?: string; to?: string; limit?: number; includeHidden?: boolean }): TraceDTO[] {
  const hiddenFilter = opts?.includeHidden ? "" : " AND s.hidden = 0";
  let sql = `SELECT t.* FROM traces t JOIN sessions s ON t.sessionId = s.id WHERE 1=1${hiddenFilter}`;
  const params: unknown[] = [];
  if (opts?.sessionId) { sql += " AND t.sessionId=?"; params.push(opts.sessionId); }
  if (opts?.provider) { sql += " AND t.provider=?"; params.push(opts.provider); }
  if (opts?.from) { sql += " AND t.timestamp>=?"; params.push(opts.from); }
  if (opts?.to) { sql += " AND t.timestamp<=?"; params.push(opts.to); }
  sql += " ORDER BY t.timestamp DESC LIMIT ?";
  params.push(opts?.limit ?? 100);
  const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
  return rows.map(rowToTrace);
}

export function getTrace(id: string): TraceDTO | undefined {
  const row = db.prepare("SELECT * FROM traces WHERE id=?").get(id) as Record<string, unknown> | undefined;
  return row ? rowToTrace(row) : undefined;
}

export function deleteSession(id: string): boolean {
  const result = db.prepare("UPDATE sessions SET hidden=1, active=0 WHERE id=?").run(id);
  return result.changes > 0;
}

export function wipeAll(): void {
  db.exec("DELETE FROM traces; DELETE FROM sessions;");
}

function rowToSession(row: Record<string, unknown>): SessionDTO {
  return {
    id: row.id as string,
    name: (row.name as string) || "New Session",
    provider: row.provider as string,
    model: row.model as string,
    cwd: row.cwd as string,
    startedAt: row.startedAt as string,
    endedAt: row.endedAt as string | undefined,
    active: row.active === 1,
    exitCode: row.exitCode as number | null | undefined,
  };
}

function rowToTrace(row: Record<string, unknown>): TraceDTO {
  return {
    id: row.id as string,
    sessionId: row.sessionId as string,
    input: row.input as string,
    output: row.output as string,
    provider: row.provider as string,
    model: row.model as string,
    costUsd: row.costUsd as number,
    durationMs: row.durationMs as number,
    diffs: row.diffs as string,
    stderr: row.stderr as string,
    exitCode: row.exitCode as number | null,
    timestamp: row.timestamp as string,
  };
}
