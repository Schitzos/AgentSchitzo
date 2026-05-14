import { buildIntentPrompt } from "../telegram/config.ts";

describe("buildIntentPrompt", () => {
  it("includes the user command in the prompt", () => {
    const result = buildIntentPrompt("fix the bug");
    expect(result).toContain("fix the bug");
    expect(result).toContain("intent");
    expect(result).toContain("JSON");
  });

  it("returns a non-empty string", () => {
    expect(buildIntentPrompt("hello").length).toBeGreaterThan(0);
  });
});
