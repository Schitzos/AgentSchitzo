import { readRequiredEnv } from "../../utils/env.ts";
import type { GeminiResponse } from "../../types/models/text/gemini.ts";

const MODEL_NAME = "gemini-2.5-flash";
const RETRY_DELAY_MS = 1500;

function buildRequestBody(prompt: string) {
  return {
    contents: [
      {
        parts: [{ text: prompt }]
      }
    ]
  };
}

function buildRequestUrl(apiKey: string) {
  return `https://generativelanguage.googleapis.com/v1/models/${MODEL_NAME}:generateContent?key=${apiKey}`;
}

function getResponseText(data: GeminiResponse) {
  return data.candidates?.[0]?.content?.parts?.[0]?.text || null;
}

async function waitBeforeRetry() {
  await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
}

async function retryGemini(prompt: string, retries: number) {
  if (retries <= 0) {
    return null;
  }

  await waitBeforeRetry();
  return callGemini(prompt, retries - 1);
}

export async function callGemini(prompt: string, retries = 2) {
  const url = buildRequestUrl(readRequiredEnv("GEMINI_API_KEY"));

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(buildRequestBody(prompt))
    });

    if (res.ok === false) {
      return retryGemini(prompt, retries);
    }

    const data = (await res.json()) as GeminiResponse;

    if (data.error) {
      return retryGemini(prompt, retries);
    }

    return getResponseText(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return retryGemini(prompt, retries);
  }
}
