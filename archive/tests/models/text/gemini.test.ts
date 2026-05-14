// @ts-nocheck
import {
  beforeAll,
  beforeEach,
  afterAll,
  describe,
  expect,
  jest,
  test
} from "@jest/globals";

const fetchMock = jest.fn();

const consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});
const originalFetch = global.fetch;
const originalSetTimeout = global.setTimeout;
const originalGeminiKey = process.env.GEMINI_API_KEY;

global.fetch = fetchMock;
global.setTimeout = jest.fn((callback, delay, ...args) => {
  callback(...args);
  return delay;
});

process.env.GEMINI_API_KEY = "test-key";

const { callGemini } = await import("../../../models/text/gemini.js");

describe("callGemini", () => {
  beforeAll(() => {
    fetchMock.mockReset();
    consoleLogSpy.mockClear();
  });

  beforeEach(() => {
    fetchMock.mockReset();
    consoleLogSpy.mockClear();
  });

  afterAll(() => {
    global.fetch = originalFetch;
    global.setTimeout = originalSetTimeout;
    process.env.GEMINI_API_KEY = originalGeminiKey;
    consoleLogSpy.mockRestore();
  });

  test("returns the candidate text from the API response", async () => {
    fetchMock.mockResolvedValue({
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [{ text: "generated answer" }]
            }
          }
        ]
      })
    });

    await expect(callGemini("write tests")).resolves.toBe("generated answer");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=test-key",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: "write tests" }]
            }
          ]
        })
      }
    );
  });

  test("returns null when the response does not include content text", async () => {
    fetchMock.mockResolvedValue({
      json: async () => ({
        candidates: []
      })
    });

    await expect(callGemini("write tests")).resolves.toBeNull();
  });

  test("retries after an API error and returns the later success value", async () => {
    fetchMock
      .mockResolvedValueOnce({
        json: async () => ({
          error: { message: "rate limited" }
        })
      })
      .mockResolvedValueOnce({
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [{ text: "retried answer" }]
              }
            }
          ]
        })
      });

    await expect(callGemini("retry me")).resolves.toBe("retried answer");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(consoleLogSpy).toHaveBeenCalledWith("Gemini error:", "rate limited");
    expect(consoleLogSpy).toHaveBeenCalledWith("Retrying Gemini...");
    expect(global.setTimeout).toHaveBeenCalledWith(expect.any(Function), 1500);
  });

  test("returns null after API errors exhaust all retries", async () => {
    fetchMock.mockResolvedValue({
      json: async () => ({
        error: { message: "still failing" }
      })
    });

    await expect(callGemini("retry me", 0)).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(consoleLogSpy).toHaveBeenCalledWith(
      "Gemini error:",
      "still failing"
    );
  });

  test("returns null when fetch throws", async () => {
    fetchMock
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce({
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [{ text: "retried after fetch failure" }]
              }
            }
          ]
        })
      });

    await expect(callGemini("write tests")).resolves.toBe(
      "retried after fetch failure"
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(consoleLogSpy).toHaveBeenCalledWith(
      "Gemini fetch error:",
      "network down"
    );
    expect(consoleLogSpy).toHaveBeenCalledWith("Retrying Gemini...");
  });

  test("returns null after http errors exhaust all retries", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 503,
      statusText: "Service Unavailable"
    });

    await expect(callGemini("write tests", 0)).resolves.toBeNull();
    expect(consoleLogSpy).toHaveBeenCalledWith(
      "Gemini HTTP error:",
      503,
      "Service Unavailable"
    );
  });

  test("retries after an http error and returns the later success value", async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: "Too Many Requests"
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [{ text: "retried after http failure" }]
              }
            }
          ]
        })
      });

    await expect(callGemini("write tests")).resolves.toBe(
      "retried after http failure"
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(consoleLogSpy).toHaveBeenCalledWith(
      "Gemini HTTP error:",
      429,
      "Too Many Requests"
    );
    expect(consoleLogSpy).toHaveBeenCalledWith("Retrying Gemini...");
  });

  test("returns null when fetch throws after retries are exhausted", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));

    await expect(callGemini("write tests", 0)).resolves.toBeNull();
    expect(consoleLogSpy).toHaveBeenCalledWith(
      "Gemini fetch error:",
      "network down"
    );
  });

  test("stringifies non-Error fetch failures", async () => {
    fetchMock.mockRejectedValue("timeout");

    await expect(callGemini("write tests", 0)).resolves.toBeNull();
    expect(consoleLogSpy).toHaveBeenCalledWith(
      "Gemini fetch error:",
      "timeout"
    );
  });
});
