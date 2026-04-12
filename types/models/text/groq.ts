import type OpenAI from "openai";

export type GroqChatRequest = Parameters<
  OpenAI["chat"]["completions"]["create"]
>[0];
