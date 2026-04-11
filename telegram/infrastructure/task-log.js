import { promises as fs } from "fs";
import path from "path";

export function resolveTaskLogPath() {
  return path.join(process.cwd(), "logs", "task-log.txt");
}

function normalizeText(value) {
  return `${value || ""}`.replace(/\r?\n+/g, " ").replace(/\s+/g, " ").trim();
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

export async function appendTaskLog({
  plan,
  output,
  logFilePath = resolveTaskLogPath(),
  now = new Date()
}) {
  const normalizedPlan = normalizePlan(plan);
  const normalizedOutput = normalizeText(output);
  const entry = [
    `date:${formatLogDate(now)}`,
    `plan:${normalizedPlan}`,
    `output:${normalizedOutput}`,
    "",
    ""
  ].join("\n");

  await fs.mkdir(path.dirname(logFilePath), { recursive: true });
  await fs.appendFile(logFilePath, entry, "utf8");
}
