import { promises as fs } from "fs";
import path from "path";

export interface TaskLogEntry {
  id: number;
  timestamp: string;
  prompt: string;
  plan: string;
  output: string;
  status: "done" | "failed";
  filesChanged: string[];
  testsPassed: boolean | null;
  durationMs: number;
}

export function resolveTaskLogPath(): string {
  return path.join(process.cwd(), "logs", "task-log.json");
}

export function normalizeText(value: unknown): string {
  return `${value || ""}`
    .replace(/\r?\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizePlan(plan: unknown): string {
  return normalizeText(Array.isArray(plan) ? plan.join(", ") : plan);
}

export function formatLogDate(date: Date): string {
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${day} ${months[date.getMonth()]} ${date.getFullYear()}`;
}

export async function readTaskLogEntries(logFilePath: string): Promise<TaskLogEntry[]> {
  try {
    const content = await fs.readFile(logFilePath, "utf8");

    if (!content.trim()) {
      return [];
    }

    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error: unknown) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

export async function appendTaskLog({
  prompt,
  plan,
  output,
  status = "done",
  filesChanged = [],
  testsPassed = null,
  startedAt,
  /* istanbul ignore next */ logFilePath = resolveTaskLogPath(),
  /* istanbul ignore next */ now = new Date(),
}: {
  prompt: string;
  plan: unknown;
  output: unknown;
  status?: "done" | "failed";
  filesChanged?: string[];
  testsPassed?: boolean | null;
  startedAt?: number;
  logFilePath?: string;
  now?: Date;
}): Promise<void> {
  await fs.mkdir(path.dirname(logFilePath), { recursive: true });

  const entries = await readTaskLogEntries(logFilePath);
  const entry: TaskLogEntry = {
    id: entries.length + 1,
    timestamp: now.toISOString(),
    prompt: normalizeText(prompt),
    plan: normalizePlan(plan),
    output: normalizeText(output),
    status,
    filesChanged,
    testsPassed,
    durationMs: startedAt ? now.getTime() - startedAt : 0,
  };
  entries.push(entry);

  await fs.writeFile(logFilePath, JSON.stringify(entries, null, 2), "utf8");
}

export async function searchTaskLog(
  query: string,
  /* istanbul ignore next */ logFilePath = resolveTaskLogPath(),
  limit = 5
): Promise<TaskLogEntry[]> {
  const entries = await readTaskLogEntries(logFilePath);
  if (!query) return entries.slice(-limit);

  const lower = query.toLowerCase();
  return entries
    .filter(
      (e) =>
        e.prompt.toLowerCase().includes(lower) ||
        e.plan.toLowerCase().includes(lower) ||
        e.output.toLowerCase().includes(lower)
    )
    .slice(-limit);
}
