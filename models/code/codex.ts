import { execFile, spawn } from "child_process";
import { existsSync, promises as fs } from "fs";
import path from "path";
import type { CodexResult } from "../../types/models/code/codex.ts";

let activeCodexRuns = 0;

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

function buildCodexArgs(outputFile: string, bypassApprovals: boolean) {
  const args = ["exec"];

  if (bypassApprovals) {
    args.push("--dangerously-bypass-approvals-and-sandbox");
  } else {
    args.push("--full-auto");
  }

  args.push("--skip-git-repo-check", "--output-last-message", outputFile, "-");

  return args;
}

function containsCodexProcess(output: string) {
  return String(output || "")
    .toLowerCase()
    .includes("codex");
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

  return lastMessage.trim() || combinedOutput.trim();
}

export async function isCodexRunning() {
  if (activeCodexRuns > 0) {
    return true;
  }

  return checkProcessList();
}

export function runCodex(
  prompt: string,
  { bypassApprovals = false }: { bypassApprovals?: boolean } = {}
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

    const args = buildCodexArgs(outputFile, bypassApprovals);

    const startChild = async () => {
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
        });

        child.stderr.on("data", (data) => {
          combinedOutput += data.toString();
        });

        child.on("error", (error) => {
          finish(createResult(false, error.message));
        });

        child.on("close", async (code) => {
          console.log("Codex finished with code:", code);
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
