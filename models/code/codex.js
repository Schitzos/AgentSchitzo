import { spawn } from "child_process";
import { existsSync, promises as fs } from "fs";
import path from "path";

function createResult(success, output) {
  return { success, output };
}

function buildOutputFilePath() {
  return path.join(process.cwd(), "logs", `codex-last-message-${Date.now()}.txt`);
}

function resolveCodexCommand() {
  if (process.platform !== "win32") {
    return {
      command: "codex",
      shell: false
    };
  }

  const pathEntries = (process.env.PATH || "").split(";").filter(Boolean);

  for (const entry of pathEntries) {
    const cmdPath = path.join(entry, "codex.cmd");
    if (existsSync(cmdPath)) {
      return {
        command: cmdPath,
        shell: true
      };
    }

    const exePath = path.join(entry, "codex.exe");
    if (existsSync(exePath)) {
      return {
        command: exePath,
        shell: false
      };
    }
  }

  return {
    command: "codex",
    shell: true
  };
}

function buildCodexArgs(outputFile, bypassApprovals) {
  const args = ["exec"];

  if (bypassApprovals) {
    args.push("--dangerously-bypass-approvals-and-sandbox");
  } else {
    args.push("--full-auto");
  }

  args.push("--skip-git-repo-check", "--output-last-message", outputFile, "-");

  return args;
}

async function readFinalOutput(outputFile, combinedOutput) {
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

export function runCodex(prompt, { bypassApprovals = false } = {}) {
  return new Promise((resolve) => {
    console.log("Running Codex...");
    console.log("codex prompt:", prompt);

    const outputFile = buildOutputFilePath();
    const codexProcess = resolveCodexCommand();
    let settled = false;

    function finish(result) {
      if (settled) {
        return;
      }

      settled = true;
      resolve(result);
    }

    const args = buildCodexArgs(outputFile, bypassApprovals);

    const child = spawn(codexProcess.command, args, {
      shell: codexProcess.shell,
      stdio: ["pipe", "pipe", "pipe"]
    });

    let combinedOutput = "";

    child.stdout.on("data", (data) => {
      const text = data.toString();
      process.stdout.write(text);
      combinedOutput += text;
    });

    child.stderr.on("data", (data) => {
      const text = data.toString();
      process.stderr.write(text);
      combinedOutput += text;
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
  });
}
