import OpenAI from "openai";
import { readRequiredEnv } from "../../utils/env.js";

const GROQ_MODEL = "llama-3.1-8b-instant";

const client = new OpenAI({
  apiKey: readRequiredEnv("GROQ_API_KEY"),
  baseURL: "https://api.groq.com/openai/v1"
});

function buildChatRequest(prompt) {
  return {
    model: GROQ_MODEL,
    messages: [
      {
        role: "user",
        content: prompt
      }
    ],
    temperature: 0.2
  };
}

export async function callGroq(prompt) {
  try {
    const completion = await client.chat.completions.create(buildChatRequest(prompt));
    return completion.choices[0].message.content;
  } catch (err) {
    console.log("Groq error:", err.message);
    return null;
  }
}
