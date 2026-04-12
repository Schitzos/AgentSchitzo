import { promises as fs } from "fs";
import path from "path";

export function resolveApprovalSessionPath() {
  return path.join(process.cwd(), "logs", "pending-approval.json");
}

function isValidApprovalSession(session) {
  return (
    session &&
    typeof session === "object" &&
    typeof session.command === "string" &&
    typeof session.prompt === "string" &&
    session.permission &&
    typeof session.permission.action === "string" &&
    typeof session.permission.reason === "string" &&
    Array.isArray(session.plan)
  );
}

export function createApprovalSessionStore({
  sessionFilePath = resolveApprovalSessionPath()
} = {}) {
  let session = null;
  let hasLoaded = false;

  async function load() {
    if (hasLoaded) {
      return session;
    }

    hasLoaded = true;

    try {
      const raw = await fs.readFile(sessionFilePath, "utf8");
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
      await fs.mkdir(path.dirname(sessionFilePath), { recursive: true });
      await fs.writeFile(sessionFilePath, JSON.stringify(value), "utf8");
    },

    async clear() {
      const currentSession = await load();
      session = null;
      hasLoaded = true;

      try {
        await fs.unlink(sessionFilePath);
      } catch {
        // Best-effort cleanup for the pending approval file.
      }

      return currentSession;
    }
  };
}
