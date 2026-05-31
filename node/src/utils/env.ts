import fs from "fs";
import path from "path";

let envLoaded = false;

export function parseEnvLine(line: string): { key: string; value: string } | null {
  const trimmedLine = line.trim();
  if (!trimmedLine || trimmedLine.startsWith("#")) {
    return null;
  }

  const separatorIndex = trimmedLine.indexOf("=");
  if (separatorIndex < 0) {
    return null;
  }

  const key = trimmedLine.slice(0, separatorIndex).trim();
  if (!key) {
    return null;
  }

  let value = trimmedLine.slice(separatorIndex + 1).trim();

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }

  return { key, value };
}

export function loadEnvFile(filePath = path.join(process.cwd(), ".env")): void {
  if (envLoaded) {
    return;
  }

  envLoaded = true;

  if (!fs.existsSync(filePath)) {
    return;
  }

  const content = fs.readFileSync(filePath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const parsed = parseEnvLine(line);
    if (!parsed || parsed.key in process.env) {
      continue;
    }

    process.env[parsed.key] = parsed.value;
  }
}

export function readRequiredEnv(name: string): string {
  loadEnvFile();

  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

export function readEnv(name: string, fallback: string): string {
  loadEnvFile();
  return process.env[name] || fallback;
}

export function readEnvNumber(name: string, fallback: number): number {
  loadEnvFile();

  const value = Number(process.env[name] || fallback);
  return Number.isFinite(value) ? value : fallback;
}

/** Reset loaded state — only for testing. */
export function _resetEnvLoaded(): void {
  envLoaded = false;
}
