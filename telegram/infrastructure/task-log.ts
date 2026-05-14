import { promises as fs } from "fs";
import path from "path";

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
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  const year = `${date.getFullYear()}`;
  const hours = `${date.getHours()}`.padStart(2, "0");
  const minutes = `${date.getMinutes()}`.padStart(2, "0");

  return `${month}/${day}/${year} ${hours}:${minutes}`;
}

export async function readTaskLogEntries(logFilePath: string): Promise<unknown[]> {
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
  plan,
  output,
  /* istanbul ignore next */ logFilePath = resolveTaskLogPath(),
  /* istanbul ignore next */ now = new Date(),
}: {
  plan: unknown;
  output: unknown;
  logFilePath?: string;
  now?: Date;
}): Promise<void> {
  await fs.mkdir(path.dirname(logFilePath), { recursive: true });

  const entries = await readTaskLogEntries(logFilePath);
  entries.push({
    date: formatLogDate(now),
    plan: normalizePlan(plan),
    output: normalizeText(output),
  });

  await fs.writeFile(logFilePath, JSON.stringify(entries, null, 2), "utf8");
}
