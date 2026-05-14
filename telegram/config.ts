import { readEnvNumber, readRequiredEnv } from "../utils/env.ts";

export const TELEGRAM_TOKEN = readRequiredEnv("TELEGRAM_TOKEN");
export const TELEGRAM_CHAT_ID = readRequiredEnv("TELEGRAM_CHAT_ID");
export const TELEGRAM_POLL_INTERVAL_MS = readEnvNumber(
  "TELEGRAM_POLL_INTERVAL_MS",
  3000
);

export function buildIntentPrompt(command: string): string {
  return `
You are an AI coding agent.

User message:
"${command}"

Return ONLY valid JSON.
Do NOT use markdown.
Do NOT explain.

Format EXACTLY like this:

{
  "intent": "code" or "chat",
  "reply": "short message to user",
  "processing_reply": "short status message before Codex runs",
  "plan": [
    "step 1",
    "step 2",
    "step 3"
  ]
}

Rules:
- plan MUST be array of strings
- NO code in plan
- NO objects in plan
- for intent="code", processing_reply MUST be a short natural status update about working on the request
- for intent="chat", processing_reply can be an empty string
- NO explanation outside JSON
`;
}
