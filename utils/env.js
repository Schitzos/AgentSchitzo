import fs from "fs";
import path from "path";

let envLoaded = false;

function parseEnvLine(line) {
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
    (value.startsWith("\"") && value.endsWith("\"")) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }

  return { key, value };
}

export function loadEnvFile(filePath = path.join(process.cwd(), ".env")) {
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

export function readRequiredEnv(name) {
  loadEnvFile();

  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

export function readEnv(name, fallback) {
  loadEnvFile();
  return process.env[name] || fallback;
}

export function readEnvNumber(name, fallback) {
  loadEnvFile();

  const value = Number(process.env[name] || fallback);
  return Number.isFinite(value) ? value : fallback;
}
