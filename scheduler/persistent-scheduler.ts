import fs from "fs";
import path from "path";

export type ScheduleType = "once" | "daily" | "weekdays" | "weekends";

export interface ScheduleEntry {
  id: number;
  type: ScheduleType;
  hour: number;
  minute: number;
  message: string;
  lastFired?: string; // ISO date string of last fire (prevents double-fire)
}

const SCHEDULE_FILE = path.join(process.cwd(), "logs", "schedules.json");

export function loadSchedules(): ScheduleEntry[] {
  try {
    if (!fs.existsSync(SCHEDULE_FILE)) return [];
    return JSON.parse(fs.readFileSync(SCHEDULE_FILE, "utf-8"));
  } catch {
    return [];
  }
}

export function saveSchedules(entries: ScheduleEntry[]): void {
  const dir = path.dirname(SCHEDULE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(SCHEDULE_FILE, JSON.stringify(entries, null, 2));
}

export function addSchedule(type: ScheduleType, hour: number, minute: number, message: string): ScheduleEntry {
  const entries = loadSchedules();
  const id = entries.length > 0 ? Math.max(...entries.map((e) => e.id)) + 1 : 1;
  const entry: ScheduleEntry = { id, type, hour, minute, message };
  entries.push(entry);
  saveSchedules(entries);
  return entry;
}

export function removeSchedule(id: number): boolean {
  const entries = loadSchedules();
  const filtered = entries.filter((e) => e.id !== id);
  if (filtered.length === entries.length) return false;
  saveSchedules(filtered);
  return true;
}

export function getDueSchedules(): { entry: ScheduleEntry; fire: boolean }[] {
  const now = new Date();
  const entries = loadSchedules();
  const results: { entry: ScheduleEntry; fire: boolean }[] = [];
  const today = now.toISOString().slice(0, 10);
  const day = now.getDay(); // 0=Sun, 6=Sat
  const isWeekday = day >= 1 && day <= 5;
  const isWeekend = day === 0 || day === 6;
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  for (const entry of entries) {
    const entryMinutes = entry.hour * 60 + entry.minute;
    // Allow 2-minute window to handle timer drift
    if (nowMinutes < entryMinutes || nowMinutes > entryMinutes + 1) continue;
    if (entry.lastFired === today) continue;

    let shouldFire = false;
    if (entry.type === "daily" || entry.type === "once") shouldFire = true;
    else if (entry.type === "weekdays" && isWeekday) shouldFire = true;
    else if (entry.type === "weekends" && isWeekend) shouldFire = true;

    if (shouldFire) results.push({ entry, fire: true });
  }

  return results;
}

export function markFired(id: number): void {
  const entries = loadSchedules();
  const entry = entries.find((e) => e.id === id);
  if (!entry) return;
  const today = new Date().toISOString().slice(0, 10);
  entry.lastFired = today;
  if (entry.type === "once") {
    saveSchedules(entries.filter((e) => e.id !== id));
  } else {
    saveSchedules(entries);
  }
}

export function formatSchedule(entry: ScheduleEntry): string {
  const time = `${String(entry.hour).padStart(2, "0")}:${String(entry.minute).padStart(2, "0")}`;
  return `#${entry.id} [${entry.type}] ${time} — ${entry.message}`;
}
