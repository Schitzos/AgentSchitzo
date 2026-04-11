const INSTALL_PATTERN =
  /\b(npm|pnpm|yarn|bun)\s+(install|add)\b|\binstall\b[\s\S]*\b(lib|library|package|dependency|dependencies)\b/;
const DELETE_PATTERN = /\b(delete|remove|remove-item|rm|unlink)\b/;
const MOVE_PATTERN = /\b(rename|ren|move|move-item|mv)\b/;

const PERMISSION_SIGNAL_PATTERNS = [
  "approval",
  "permission",
  "sandbox",
  "access is denied",
  "blocked by policy",
  "rejected: blocked by policy",
  "requires elevated",
  "not allowed"
];

export const YES_ANSWERS = new Set(["y", "yes"]);
export const NO_ANSWERS = new Set(["n", "no"]);

function findPermissionAction(text) {
  if (INSTALL_PATTERN.test(text)) {
    return "install dependencies";
  }

  if (DELETE_PATTERN.test(text)) {
    return "delete files";
  }

  if (MOVE_PATTERN.test(text)) {
    return "rename or move files";
  }

  return null;
}

export function detectPreflightPermission(command) {
  const action = findPermissionAction(command.toLowerCase());

  return action ? { action } : null;
}

export function detectBlockedPermission(command, output) {
  const normalizedOutput = output.toLowerCase();
  const hasPermissionSignal = PERMISSION_SIGNAL_PATTERNS.some((pattern) =>
    normalizedOutput.includes(pattern)
  );

  if (!hasPermissionSignal) {
    return null;
  }

  return {
    action:
      findPermissionAction(`${command}\n${output}`.toLowerCase()) ||
      "run the blocked operation"
  };
}

export function isApprovalAnswer(text) {
  return YES_ANSWERS.has(text) || NO_ANSWERS.has(text);
}
