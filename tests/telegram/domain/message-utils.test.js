import { describe, expect, test } from "@jest/globals";
import {
  buildCodexPrompt,
  buildVerificationRepairPrompt,
  extractJSON,
  isSimpleChat
} from "../../../telegram/domain/message-utils.js";

describe("telegram/domain/message-utils", () => {
  test("isSimpleChat matches supported greetings", () => {
    expect(isSimpleChat(" hello ")).toBe(true);
    expect(isSimpleChat("HEY")).toBe(true);
    expect(isSimpleChat("bye")).toBe(false);
  });

  test("buildCodexPrompt returns raw command when plan is empty", () => {
    expect(buildCodexPrompt("write tests", [])).toBe("write tests");
  });

  test("buildCodexPrompt returns raw command when plan is omitted", () => {
    expect(buildCodexPrompt("write tests")).toBe("write tests");
  });

  test("buildCodexPrompt includes the plan array for codex", () => {
    expect(buildCodexPrompt("write tests", ["step 1", "step 2"])).toBe([
      "User request:",
      "write tests",
      "",
      "Suggested plan from Model:",
      "step 1, step 2",
      "",
      "Execute the task. Use the user request as source of truth. Treat the plan as guidance, not a hard constraint."
    ].join());
  });

  test("buildVerificationRepairPrompt includes the verification failure context", () => {
    expect(
      buildVerificationRepairPrompt({
        command: "write tests",
        previousOutput: "Initial task finished",
        verificationOutput: "Coverage is 82%"
      })
    ).toBe(
      [
        "The previous Codex attempt completed the task, but project verification still failed.",
        "",
        "Original user request:",
        "write tests",
        "",
        "Previous Codex output:",
        "Initial task finished",
        "",
        "Verification failure:",
        "Coverage is 82%",
        "",
        "Fix the codebase so `npm run test` passes and total branch coverage is greater than 90%.",
        "Do not stop at explanation. Make the necessary code and test changes, then finish."
      ].join("\n")
    );
  });

  test("extractJSON parses fenced json", () => {
    expect(extractJSON("```json\n{\"intent\":\"chat\",\"reply\":\"ok\"}\n```")).toEqual({
      intent: "chat",
      reply: "ok"
    });
  });

  test("extractJSON falls back to embedded json blocks", () => {
    expect(extractJSON("prefix {\"intent\":\"code\",\"plan\":[\"ship it\"]} suffix")).toEqual({
      intent: "code",
      plan: ["ship it"]
    });
  });

  test("extractJSON returns null for invalid json", () => {
    expect(extractJSON("not json")).toBeNull();
  });

  test("extractJSON returns null when a json-like block still cannot be parsed", () => {
    expect(extractJSON("prefix {not valid json} suffix")).toBeNull();
  });
});
