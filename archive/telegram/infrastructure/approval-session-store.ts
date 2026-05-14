import { promises as fs } from "fs";
import path from "path";

export function resolveApprovalSessionPath() {
  return path.join(process.cwd(), "logs", "pending-approval.json");
}

function isValidApprovalSession(session) {
  const additionalWritableRoots = session?.runOptions?.additionalWritableRoots;

  return (
    session &&
    typeof session === "object" &&
    typeof session.command === "string" &&
    typeof session.prompt === "string" &&
    session.permission &&
    typeof session.permission.action === "string" &&
    typeof session.permission.reason === "string" &&
    Array.isArray(session.plan) &&
    (session.runOptions == null ||
      (typeof session.runOptions === "object" &&
        (session.runOptions.bypassApprovals == null ||
          typeof session.runOptions.bypassApprovals === "boolean") &&
        (session.runOptions.additionalWritableRoots == null ||
          (Array.isArray(additionalWritableRoots) &&
            additionalWritableRoots.every((root) => typeof root === "string")))))
  );
}

export function createApprovalSessionStore({
  sessionFilePath = resolveApprovalSessionPath(),
  fileSystem = fs
} = {}) {
  let session = null;
  let hasLoaded = false;

  async function load() {
    if (hasLoaded) {
      return session;
    }

    hasLoaded = true;

    try {
      const raw = await fileSystem.readFile(sessionFilePath, "utf8");
      const parsed = JSON.parse(raw);
      session = isValidApprovalSession(parsed) ? parsed : null;
    } catch {
      session = null;
    }

    return session;
  }

  return {
    async get() {
      return load();
    },

    async set(value) {
      session = value;
      hasLoaded = true;
      await fileSystem.mkdir(path.dirname(sessionFilePath), { recursive: true });
      await fileSystem.writeFile(sessionFilePath, JSON.stringify(value), "utf8");
    },

    async clear() {
      const currentSession = await load();
      session = null;
      hasLoaded = true;

      try {
        await fileSystem.unlink(sessionFilePath);
      } catch {
        // Best-effort cleanup for the pending approval file.
      }

      return currentSession;
    }
  };
}
