import { promises as fs } from "fs";
import path from "path";

export function resolveTaskLogPath() {
  return path.join(process.cwd(), "logs", "task-log.json");
}

function normalizeText(value) {
  return `${value || ""}`
    .replace(/\r?\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizePlan(plan) {
  return normalizeText(Array.isArray(plan) ? plan.join(", ") : plan);
}

function formatLogDate(date) {
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  const year = `${date.getFullYear()}`;
  const hours = `${date.getHours()}`.padStart(2, "0");
  const minutes = `${date.getMinutes()}`.padStart(2, "0");

  return `${month}/${day}/${year} ${hours}:${minutes}`;
}

async function readTaskLogEntries(logFilePath) {
  try {
    const content = await fs.readFile(logFilePath, "utf8");

    if (!content.trim()) {
      return [];
    }

    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

export async function appendTaskLog({
  plan,
  output,
  logFilePath = resolveTaskLogPath(),
  now = new Date()
}) {
  await fs.mkdir(path.dirname(logFilePath), { recursive: true });

  const entries = await readTaskLogEntries(logFilePath);
  entries.push({
    date: formatLogDate(now),
    plan: normalizePlan(plan),
    output: normalizeText(output)
  });

  await fs.writeFile(logFilePath, JSON.stringify(entries, null, 2), "utf8");
}
