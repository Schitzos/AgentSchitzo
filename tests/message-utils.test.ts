import {
  buildCodexPrompt,
  buildVerificationRepairPrompt,
  extractJSON,
} from "../telegram/domain/message-utils.ts";

describe("buildCodexPrompt", () => {
  it("returns command when plan is empty", () => {
    expect(buildCodexPrompt("do thing")).toBe("do thing");
  });

  it("returns command when plan is empty array", () => {
    expect(buildCodexPrompt("do thing", [])).toBe("do thing");
  });

  it("includes plan when provided", () => {
    const result = buildCodexPrompt("fix bug", ["step1", "step2"]);
    expect(result).toContain("User request:");
    expect(result).toContain("fix bug");
    expect(result).toContain("step1, step2");
  });
});

describe("buildVerificationRepairPrompt", () => {
  it("includes all sections", () => {
    const result = buildVerificationRepairPrompt({
      command: "add feature",
      previousOutput: "code output",
      verificationOutput: "test failed",
    });
    expect(result).toContain("add feature");
    expect(result).toContain("code output");
    expect(result).toContain("test failed");
    expect(result).toContain("branch coverage");
  });
});

describe("extractJSON", () => {
  it("parses plain JSON", () => {
    expect(extractJSON('{"intent":"chat"}')).toEqual({ intent: "chat" });
  });

  it("parses JSON wrapped in code fences", () => {
    expect(extractJSON('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it("extracts JSON from surrounding text", () => {
    expect(extractJSON('some text {"b":2} more text')).toEqual({ b: 2 });
  });

  it("returns null for invalid JSON", () => {
    expect(extractJSON("not json at all")).toBeNull();
  });

  it("returns null for malformed JSON in braces", () => {
    expect(extractJSON("{broken: json}")).toBeNull();
  });
});
