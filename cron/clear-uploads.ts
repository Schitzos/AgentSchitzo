import fs from "fs";
import path from "path";

const UPLOADS_DIR = path.join(process.cwd(), "uploads");

export function clearUploads(): void {
  if (!fs.existsSync(UPLOADS_DIR)) return;
  for (const file of fs.readdirSync(UPLOADS_DIR)) {
    fs.rmSync(path.join(UPLOADS_DIR, file), { recursive: true, force: true });
  }
}

/**
 * Starts a daily cron that clears uploads/ at 00:00.
 * Checks every 30 seconds whether the current minute is 00:00
 * and fires at most once per day.
 */
export function scheduleDailyClearUploads(): void {
  let lastClearedDate = "";

  setInterval(() => {
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    if (now.getHours() === 0 && now.getMinutes() === 0 && lastClearedDate !== today) {
      lastClearedDate = today;
      clearUploads();
    }
  }, 30_000);
}
