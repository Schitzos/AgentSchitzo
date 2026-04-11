import { describe, expect, jest, test } from "@jest/globals";
import {
  buildIntentPrompt,
  TELEGRAM_CHAT_ID,
  TELEGRAM_POLL_INTERVAL_MS,
  TELEGRAM_TOKEN
} from "../../telegram/config.js";

describe("telegram/config", () => {
  test("exports telegram runtime constants from env", () => {
    expect(TELEGRAM_TOKEN).toBe(process.env.TELEGRAM_TOKEN);
    expect(TELEGRAM_CHAT_ID).toBe(process.env.TELEGRAM_CHAT_ID);
    expect(TELEGRAM_POLL_INTERVAL_MS).toBe(3000);
  });

  test("buildIntentPrompt embeds the user command and response contract", () => {
    const prompt = buildIntentPrompt("refactor listener");

    expect(prompt).toContain('"refactor listener"');
    expect(prompt).toContain("Return ONLY valid JSON.");
    expect(prompt).toContain('"intent": "code" or "chat"');
    expect(prompt).toContain('"processing_reply": "short status message before Codex runs"');
  });

  test("reads env overrides and falls back when poll interval is invalid", async () => {
    const originalEnv = process.env;

    jest.resetModules();
    process.env = {
      ...originalEnv,
      TELEGRAM_TOKEN: "token-from-env",
      TELEGRAM_CHAT_ID: "chat-from-env",
      TELEGRAM_POLL_INTERVAL_MS: "not-a-number"
    };

    const config = await import("../../telegram/config.js");

    expect(config.TELEGRAM_TOKEN).toBe("token-from-env");
    expect(config.TELEGRAM_CHAT_ID).toBe("chat-from-env");
    expect(config.TELEGRAM_POLL_INTERVAL_MS).toBe(3000);

    process.env = originalEnv;
    jest.resetModules();
  });
});
