import { Langfuse } from "langfuse";
import { readEnv } from "../utils/env.ts";

let instance: Langfuse | null = null;

export function getLangfuse(): Langfuse | null {
  if (instance) return instance;

  const publicKey = readEnv("LANGFUSE_PUBLIC_KEY", "");
  const secretKey = readEnv("LANGFUSE_SECRET_KEY", "");
  const host = readEnv(
    "LANGFUSE_BASE_URL",
    readEnv("LANGFUSE_HOST", "https://cloud.langfuse.com")
  );

  if (!publicKey || !secretKey) return null;

  try {
    instance = new Langfuse({ publicKey, secretKey, baseUrl: host });
    return instance;
  } catch {
    return null;
  }
}

export async function flushLangfuse(): Promise<void> {
  if (instance) {
    try {
      await instance.flushAsync();
    } catch { /* non-blocking */ }
  }
}
