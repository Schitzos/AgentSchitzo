import OpenAI from "openai";
import { readRequiredEnv } from "../../utils/env.ts";
import type { GroqChatRequest } from "../../types/models/text/groq.ts";

export const GROQ_MODEL = "llama-3.1-8b-instant";

const client = new OpenAI({
  apiKey: readRequiredEnv("GROQ_API_KEY"),
  baseURL: "https://api.groq.com/openai/v1"
});

function buildChatRequest(prompt: string): GroqChatRequest {
  return {
    model: GROQ_MODEL,
    stream: false,
    messages: [
      {
        role: "user" as const,
        content: prompt
      }
    ],
    temperature: 0.2
  };
}

export async function callGroq(prompt: string) {
  try {
    const completion = (await client.chat.completions.create(
      buildChatRequest(prompt)
    )) as Awaited<ReturnType<typeof client.chat.completions.create>> & {
      choices: Array<{
        message: {
          content: string | null;
        };
      }>;
    };
    return completion.choices[0].message.content;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return null;
  }
}
