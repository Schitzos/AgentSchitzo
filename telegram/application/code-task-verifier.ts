import { spawn } from "child_process";
import { readFile } from "fs/promises";
import path from "path";
import type {
  CoverageSummary,
  VerificationCommandResult
} from "../../types/telegram/application/code-task-verifier.ts";

const COVERAGE_SUMMARY_PATH = path.join("coverage", "coverage-summary.json");

export function readTotalBranchCoverage(summary: CoverageSummary) {
  return summary?.total?.branches?.pct;
}

function normalizeGitPath(filePath: string) {
  return filePath.replace(/\\/g, "/");
}

async function pathExists(filePath: string) {
  try {
    await readFile(filePath, "utf8");
    return true;
  } catch {
    return false;
  }
}

async function runCommand({
  cwd,
  logger,
  command,
  args,
  successOutput,
  failureLabel
}: {
  cwd: string;
  logger: Pick<Console, "log">;
  command: string;
  args: string[];
  successOutput?: string;
  failureLabel: string;
}) {
  return new Promise<VerificationCommandResult>((resolve) => {
    const child = spawn(command, args, {
      cwd,
      shell: process.platform === "win32",
      stdio: ["ignore", "pipe", "pipe"]
    });

    const outputChunks: string[] = [];
    let settled = false;

    function finish(result: VerificationCommandResult) {
      if (settled) {
        return;
      }

      settled = true;
      resolve(result);
    }

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      outputChunks.push(text);
      logger.log(text.trimEnd());
    });

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      outputChunks.push(text);
      logger.log(text.trimEnd());
    });

    child.on("error", (error) => {
      finish({
        success: false,
        output: `${failureLabel} failed to start: ${error.message}`
      });
    });

    child.on("close", (code) => {
      const combinedOutput = outputChunks.join("").trim();

      if (code !== 0) {
        finish({
          success: false,
          output: `${failureLabel} failed.${combinedOutput ? `\n${combinedOutput}` : ""}`
        });
        return;
      }

      finish({
        success: true,
        output: combinedOutput || successOutput || ""
      });
    });
  });
}

async function readGitChangedFiles(cwd: string, logger: Pick<Console, "log">) {
  const trackedChanges = await runCommand({
    cwd,
    logger,
    command: "git",
    args: ["diff", "--name-only", "--diff-filter=ACMR", "HEAD", "--"],
    failureLabel: "git diff"
  });

  if (!trackedChanges.success) {
    throw new Error(trackedChanges.output);
  }

  const untrackedChanges = await runCommand({
    cwd,
    logger,
    command: "git",
    args: ["ls-files", "--others", "--exclude-standard"],
    failureLabel: "git ls-files"
  });

  if (!untrackedChanges.success) {
    throw new Error(untrackedChanges.output);
  }

  const candidates = new Set(
    `${trackedChanges.output}\n${untrackedChanges.output}`
      .split(/\r?\n/)
      .map((entry) => entry.trim())
      .filter(Boolean)
  );
  const existingFiles: string[] = [];

  for (const relativeFile of candidates) {
    const absolutePath = path.join(cwd, relativeFile);

    if (await pathExists(absolutePath)) {
      existingFiles.push(normalizeGitPath(relativeFile));
    }
  }

  return existingFiles.sort();
}

function selectJestRelatedFiles(files: string[]) {
  return files.filter((file) => /\.(c|m)?[jt]sx?$/.test(file));
}

async function readCoverageSummary(cwd: string) {
  const summary = JSON.parse(
    await readFile(path.join(cwd, COVERAGE_SUMMARY_PATH), "utf8")
  ) as CoverageSummary;
  const totalBranchCoverage = readTotalBranchCoverage(summary);

  if (typeof totalBranchCoverage !== "number") {
    throw new Error("Coverage summary is missing total branch coverage.");
  }

  return totalBranchCoverage;
}

export async function runCodeTaskVerification({
  cwd = process.cwd(),
  logger = console,
  threshold = 90
} = {}) {
  const typecheck = await runCommand({
    cwd,
    logger,
    command: "npm",
    args: ["run", "typecheck"],
    successOutput: "npm run typecheck passed.",
    failureLabel: "npm run typecheck"
  });

  if (!typecheck.success) {
    return {
      success: false,
      coverage: null,
      output: typecheck.output
    };
  }

  let changedFiles: string[] = [];

  try {
    changedFiles = await readGitChangedFiles(cwd, logger);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    return {
      success: false,
      coverage: null,
      output: `Failed to determine changed files for verification: ${message}`
    };
  }

  const jestFiles = selectJestRelatedFiles(changedFiles);

  if (jestFiles.length === 0) {
    return {
      success: true,
      coverage: null,
      output: "npm run typecheck passed. No changed JS/TS files required Jest verification."
    };
  }

  const output = await runCommand({
    cwd,
    logger,
    command: "npm",
    args: [
      "run",
      "test",
      "--",
      "--findRelatedTests",
      ...jestFiles,
      "--passWithNoTests"
    ],
    failureLabel: "npm run test"
  });

  let totalBranchCoverage = null;

  try {
    totalBranchCoverage = await readCoverageSummary(cwd);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (output.success) {
      return {
        success: true,
        coverage: null,
        output: `npm run typecheck passed. Related Jest tests passed for changed files, but coverage summary is unavailable: ${message}`
      };
    }
  }

  if (!output.success) {
    return {
      success: false,
      coverage: totalBranchCoverage,
      output:
        `npm run test failed.\n${output.output.replace(/^npm run test failed\.\n?/, "")}`.trim()
    };
  }

  if (totalBranchCoverage <= threshold) {
    return {
      success: false,
      coverage: totalBranchCoverage,
      output: `Coverage check failed: total branch coverage ${totalBranchCoverage}% is not greater than ${threshold}%.`
    };
  }

  return {
    success: true,
    coverage: totalBranchCoverage,
    output: `npm run typecheck passed. Related Jest tests passed for changed files. Total branch coverage: ${totalBranchCoverage}%.`
  };
}
