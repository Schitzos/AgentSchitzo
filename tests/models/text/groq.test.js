import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const createMock = jest.fn();
const originalGroqKey = process.env.GROQ_API_KEY;

process.env.GROQ_API_KEY = "test-groq-key";

jest.unstable_mockModule("openai", () => ({
  default: class OpenAI {
    constructor() {
      this.chat = {
        completions: {
          create: createMock
        }
      };
    }
  }
}));

const consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});

const { callGroq } = await import("../../../models/text/groq.js");

describe("callGroq", () => {
  beforeEach(() => {
    createMock.mockReset();
    consoleLogSpy.mockClear();
  });

  test("returns the model content", async () => {
    createMock.mockResolvedValue({
      choices: [{ message: { content: "json response" } }]
    });

    await expect(callGroq("write tests")).resolves.toBe("json response");
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "llama-3.1-8b-instant",
        temperature: 0.2,
        messages: [{ role: "user", content: "write tests" }]
      })
    );
  });

  test("returns null when the api call fails", async () => {
    createMock.mockRejectedValue(new Error("boom"));

    await expect(callGroq("write tests")).resolves.toBeNull();
    expect(consoleLogSpy).toHaveBeenCalledWith("Groq error:", "boom");
  });

  test("uses the configured env key", () => {
    expect(process.env.GROQ_API_KEY).toBe("test-groq-key");
  });
});
