const INSTALL_PATTERN =
  /\b(npm|pnpm|yarn|bun)\s+(install|add)\b|\binstall\b[\s\S]*\b(lib|library|package|dependency|dependencies)\b/;
const DELETE_PATTERN = /\b(delete|remove|remove-item|rm|unlink)\b/;
const MOVE_PATTERN = /\b(rename|ren|move|move-item|mv)\b/;
const DRIVE_E_PATTERN = /\bdrive\s+e\b|\be:(?:[\\/]|$)/;

const PERMISSION_SIGNAL_PATTERNS = [
  "approval",
  "permission",
  "sandbox",
  "eperm",
  "operation not permitted",
  "access is denied",
  "blocked by policy",
  "rejected: blocked by policy",
  "requires elevated",
  "not allowed"
];

export const YES_ANSWERS = new Set(["y", "yes", "approve", "approved"]);
export const NO_ANSWERS = new Set(["n", "no", "deny", "denied"]);

function referencesDriveE(text) {
  return DRIVE_E_PATTERN.test(text);
}

function findPermissionAction(text) {
  if (referencesDriveE(text)) {
    return "access drive E:\\";
  }

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

function findPermissionReason(action, output = "") {
  if (action === "access drive E:\\") {
    return "The task needs filesystem access outside the project workspace on E:\\. Approval allows Codex to read, write, update, or delete there for this task.";
  }

  if (action === "install dependencies") {
    return "The task needs to add or install packages, which changes project dependencies.";
  }

  if (action === "delete files") {
    return "The task needs to delete files, which is a destructive filesystem operation.";
  }

  if (action === "rename or move files") {
    return "The task needs to rename or move files, which changes the filesystem layout.";
  }

  if (output) {
    const normalizedOutput = output.replace(/\s+/g, " ").trim();

    if (normalizedOutput) {
      return `Codex reported the operation was blocked: ${normalizedOutput}`;
    }
  }

  return `The task requires temporary approval to ${action}.`;
}

export const __testables__ = {
  findPermissionReason,
  referencesDriveE
};

export function detectPreflightPermission(command) {
  const normalizedCommand = command.toLowerCase();
  const action = findPermissionAction(normalizedCommand);

  if (!action) {
    return null;
  }

  return {
    permission: {
      action,
      reason: findPermissionReason(action)
    },
    runOptions:
      action === "access drive E:\\"
        ? { additionalWritableRoots: ["E:\\"] }
        : { bypassApprovals: true }
  };
}

export function detectBlockedPermission(command, output) {
  const normalizedOutput = output.toLowerCase();
  const hasPermissionSignal = PERMISSION_SIGNAL_PATTERNS.some((pattern) =>
    normalizedOutput.includes(pattern)
  );

  if (!hasPermissionSignal) {
    return null;
  }

  const action =
    findPermissionAction(`${command}\n${output}`.toLowerCase()) ||
    "run the blocked operation";

  return {
    action,
    reason: findPermissionReason(action, output)
  };
}

export function isApprovalAnswer(text) {
  return YES_ANSWERS.has(text) || NO_ANSWERS.has(text);
}
