const SIMPLE_GREETINGS = new Set(["hi", "hello", "hey"]);

export function isSimpleChat(text) {
  return SIMPLE_GREETINGS.has(text.toLowerCase().trim());
}

export function buildCodexPrompt(command, plan = []) {
  const trimmedPlan = plan.join(", ");

  if (!trimmedPlan) {
    return command;
  }

  return [
    "User request:",
    command,
    "",
    "Suggested plan from Model:",
    trimmedPlan,
    "",
    "Execute the task. Use the user request as source of truth. Treat the plan as guidance, not a hard constraint."
  ].join();
}

export function buildVerificationRepairPrompt({
  command,
  previousOutput,
  verificationOutput
}) {
  return [
    "The previous Codex attempt completed the task, but project verification still failed.",
    "",
    "Original user request:",
    command,
    "",
    "Previous Codex output:",
    previousOutput,
    "",
    "Verification failure:",
    verificationOutput,
    "",
    "Fix the codebase so `npm run test` passes and total branch coverage is greater than 90%.",
    "Do not stop at explanation. Make the necessary code and test changes, then finish."
  ].join("\n");
}

export function extractJSON(text) {
  const cleaned = text.replace(/```json/g, "").replace(/```/g, "").trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    try {
      const match = cleaned.match(/\{[\s\S]*\}/);
      if (match) {
        return JSON.parse(match[0]);
      }
    } catch {
      return null;
    }

    return null;
  }
}
