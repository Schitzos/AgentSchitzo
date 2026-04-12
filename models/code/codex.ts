import { createHash } from "crypto";
import { execFile, spawn } from "child_process";
import { existsSync, promises as fs } from "fs";
import path from "path";
import type {
  CodexResult,
  CodexRunOptions
} from "../../types/models/code/codex.ts";

let activeCodexRuns = 0;
const LAST_CODEX_RUN_PATH = path.join(
  process.cwd(),
  "logs",
  "last-codex-run.json"
);

function createResult(success: boolean, output: string): CodexResult {
  return { success, output };
}

function buildOutputFilePath() {
  return path.join(
    process.cwd(),
    "logs",
    `codex-last-message-${Date.now()}.txt`
  );
}

function hashFileContent(content: string | Buffer) {
  return createHash("sha1").update(content).digest("hex");
}

function getPlatformPath() {
  return process.platform === "win32" ? path.win32 : path.posix;
}

function getPathDelimiter() {
  return process.platform === "win32" ? ";" : ":";
}

function getPathEntries() {
  return (process.env.PATH || "").split(getPathDelimiter()).filter(Boolean);
}

function getFallbackPathEntries() {
  if (process.platform !== "darwin") {
    return [];
  }

  const homeDirectory = process.env.HOME;
  const entries = ["/opt/homebrew/bin", "/usr/local/bin"];
  const platformPath = getPlatformPath();

  if (homeDirectory) {
    entries.push(
      platformPath.join(homeDirectory, ".local", "bin"),
      platformPath.join(homeDirectory, "bin")
    );
  }

  return entries;
}

function findCodexExecutable(candidateNames: string[]) {
  const visitedEntries = new Set<string>();
  const platformPath = getPlatformPath();

  for (const entry of [...getPathEntries(), ...getFallbackPathEntries()]) {
    if (!entry || visitedEntries.has(entry)) {
      continue;
    }

    visitedEntries.add(entry);

    for (const candidateName of candidateNames) {
      const candidatePath = platformPath.join(entry, candidateName);

      if (existsSync(candidatePath)) {
        return candidatePath;
      }
    }
  }

  return null;
}

function resolveCodexCommand() {
  if (process.platform !== "win32") {
    const resolvedCommand = findCodexExecutable(["codex"]);

    return {
      command: resolvedCommand || "codex",
      shell: false
    };
  }

  const resolvedCommand = findCodexExecutable(["codex.cmd", "codex.exe"]);

  if (resolvedCommand) {
    return {
      command: resolvedCommand,
      shell: resolvedCommand.endsWith(".cmd")
    };
  }

  return {
    command: "codex",
    shell: true
  };
}

function buildCodexArgs(outputFile: string, options: CodexRunOptions) {
  const args = ["exec"];
  const { additionalWritableRoots = [], bypassApprovals = false } = options;

  if (bypassApprovals) {
    args.push("--dangerously-bypass-approvals-and-sandbox");
  } else {
    args.push("--full-auto");

    for (const writableRoot of additionalWritableRoots) {
      args.push("--add-dir", writableRoot);
    }
  }

  args.push("--skip-git-repo-check", "--output-last-message", outputFile, "-");

  return args;
}

function containsCodexProcess(output: string) {
  return String(output || "")
    .toLowerCase()
    .includes("codex");
}

function writeToTerminal(
  stream: NodeJS.WriteStream | undefined,
  data: Buffer | string
) {
  stream?.write(data);
}

function checkProcessList() {
  return new Promise<boolean>((resolve) => {
    const isWindows = process.platform === "win32";
    const command = isWindows ? "tasklist" : "ps";
    const args = isWindows ? ["/FO", "CSV"] : ["-A", "-o", "comm="];

    execFile(command, args, (error, stdout = "") => {
      if (error) {
        resolve(false);
        return;
      }

      resolve(containsCodexProcess(stdout));
    });
  });
}

function runExecFile(command: string, args: string[], cwd: string) {
  return new Promise<string>((resolve, reject) => {
    execFile(command, args, { cwd }, (error, stdout = "") => {
      if (error) {
        reject(error);
        return;
      }

      resolve(stdout);
    });
  });
}

async function listRepoFiles(cwd: string) {
  const output = await runExecFile(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    cwd
  );

  return output
    .split("\0")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .sort();
}

async function buildWorkspaceSnapshot(cwd: string) {
  const files = await listRepoFiles(cwd);
  const snapshot = new Map<string, string | null>();

  for (const relativeFile of files) {
    const absolutePath = path.join(cwd, relativeFile);

    try {
      const content = await fs.readFile(absolutePath);
      snapshot.set(relativeFile.replace(/\\/g, "/"), hashFileContent(content));
    } catch {
      snapshot.set(relativeFile.replace(/\\/g, "/"), null);
    }
  }

  return snapshot;
}

async function safeBuildWorkspaceSnapshot(cwd = process.cwd()) {
  try {
    return await buildWorkspaceSnapshot(cwd);
  } catch {
    return new Map<string, string | null>();
  }
}

function selectChangedSnapshotFiles(
  before: Map<string, string | null>,
  after: Map<string, string | null>
) {
  const candidateFiles = new Set([...before.keys(), ...after.keys()]);

  return [...candidateFiles]
    .filter((filePath) => before.get(filePath) !== after.get(filePath))
    .sort();
}

async function writeLastCodexRun(changedFiles: string[]) {
  await fs.mkdir(path.dirname(LAST_CODEX_RUN_PATH), { recursive: true });
  await fs.writeFile(
    LAST_CODEX_RUN_PATH,
    JSON.stringify({ changedFiles }, null, 2),
    "utf8"
  );
}

async function readFinalOutput(outputFile: string, combinedOutput: string) {
  let lastMessage = "";
  try {
    lastMessage = await fs.readFile(outputFile, "utf8");
  } catch {
    lastMessage = "";
  }

  try {
    await fs.unlink(outputFile);
  } catch {
    // Best-effort cleanup for the generated output file.
  }

  const normalizedLastMessage =
    typeof lastMessage === "string" ? lastMessage : String(lastMessage);

  return normalizedLastMessage.trim() || combinedOutput.trim();
}

export async function isCodexRunning() {
  if (activeCodexRuns > 0) {
    return true;
  }

  return checkProcessList();
}

export function runCodex(
  prompt: string,
  options: CodexRunOptions = {}
) {
  return new Promise<CodexResult>((resolve) => {
    console.log("Running Codex...");

    const outputFile = buildOutputFilePath();
    const codexProcess = resolveCodexCommand();
    let settled = false;

    function finish(result: CodexResult) {
      if (settled) {
        return;
      }

      if (activeCodexRuns > 0) {
        activeCodexRuns -= 1;
      }
      settled = true;
      resolve(result);
    }

    const args = buildCodexArgs(outputFile, options);
    let workspaceBefore = new Map<string, string | null>();

    const startChild = async () => {
      workspaceBefore = await safeBuildWorkspaceSnapshot();
      await fs.mkdir(path.dirname(outputFile), { recursive: true });

      return spawn(codexProcess.command, args, {
        shell: codexProcess.shell,
        stdio: ["pipe", "pipe", "pipe"]
      });
    };

    let combinedOutput = "";

    startChild()
      .then((child) => {
        activeCodexRuns += 1;

        child.stdout.on("data", (data) => {
          combinedOutput += data.toString();
          writeToTerminal(process.stdout, data);
        });

        child.stderr.on("data", (data) => {
          combinedOutput += data.toString();
          writeToTerminal(process.stderr, data);
        });

        child.on("error", (error) => {
          finish(createResult(false, error.message));
        });

        child.on("close", async (code) => {
          console.log("Codex finished with code:", code);
          try {
            const workspaceAfter = await safeBuildWorkspaceSnapshot();
            await writeLastCodexRun(
              selectChangedSnapshotFiles(workspaceBefore, workspaceAfter)
            );
          } catch {
            // Verification falls back to git-detected changes if this metadata is unavailable.
          }
          const output = await readFinalOutput(outputFile, combinedOutput);
          finish(createResult(code === 0, output));
        });

        child.stdin.end(prompt);
      })
      .catch((error) => {
        finish(createResult(false, error.message));
      });
  });
}
