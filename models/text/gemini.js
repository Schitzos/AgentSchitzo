import { readRequiredEnv } from "../../utils/env.js";

const MODEL_NAME = "gemini-2.5-flash";
const RETRY_DELAY_MS = 1500;

function buildRequestBody(prompt) {
  return {
    contents: [
      {
        parts: [{ text: prompt }]
      }
    ]
  };
}

function buildRequestUrl(apiKey) {
  return `https://generativelanguage.googleapis.com/v1/models/${MODEL_NAME}:generateContent?key=${apiKey}`;
}

function getResponseText(data) {
  return data.candidates?.[0]?.content?.parts?.[0]?.text || null;
}

async function waitBeforeRetry() {
  await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
}

export async function callGemini(prompt, retries = 2) {
  const url = buildRequestUrl(readRequiredEnv("GEMINI_API_KEY"));

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(buildRequestBody(prompt))
    });

    const data = await res.json();

    if (data.error) {
      console.log("Gemini error:", data.error.message);

      if (retries > 0) {
        console.log("Retrying Gemini...");
        await waitBeforeRetry();
        return callGemini(prompt, retries - 1);
      }

      return null;
    }

    return getResponseText(data);
  } catch (err) {
    console.log("Gemini fetch error:", err.message);
    return null;
  }
}
