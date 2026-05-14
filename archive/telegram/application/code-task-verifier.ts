import { spawn } from "child_process";
import { readFile } from "fs/promises";
import path from "path";
import type {
  CoverageSummary,
  VerificationCommandResult
} from "../../types/telegram/application/code-task-verifier.ts";

const COVERAGE_SUMMARY_PATH = path.join("coverage", "coverage-summary.json");
const LAST_CODEX_RUN_PATH = path.join("logs", "last-codex-run.json");

export function readTotalBranchCoverage(summary: CoverageSummary) {
  return summary?.total?.branches?.pct;
}

function readBranchTotals(entry: CoverageSummary[string]) {
  const covered = entry?.branches?.covered;
  const total = entry?.branches?.total;

  if (typeof covered !== "number" || typeof total !== "number") {
    return null;
  }

  return { covered, total };
}

export function readChangedFileBranchCoverage(
  summary: CoverageSummary,
  changedFiles: string[],
  cwd = process.cwd()
) {
  const normalizedChangedFiles = new Set(changedFiles.map(normalizeGitPath));
  let coveredBranches = 0;
  let totalBranches = 0;

  for (const [filePath, entry] of Object.entries(summary)) {
    if (filePath === "total") {
      continue;
    }

    const normalizedCoveragePath = normalizeGitPath(
      path.isAbsolute(filePath) ? path.relative(cwd, filePath) : filePath
    );

    if (!normalizedChangedFiles.has(normalizedCoveragePath)) {
      continue;
    }

    const branchTotals = readBranchTotals(entry);

    if (!branchTotals) {
      continue;
    }

    coveredBranches += branchTotals.covered;
    totalBranches += branchTotals.total;
  }

  if (totalBranches === 0) {
    return null;
  }

  return Number(((coveredBranches / totalBranches) * 100).toFixed(2));
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

function isTestFile(filePath: string) {
  return /(^|\/)(tests?|__tests__)\//.test(filePath) || /\.test\.(c|m)?[jt]sx?$/.test(filePath);
}

function selectCoverageRelevantFiles(files: string[]) {
  return files.filter((file) => !isTestFile(file));
}

async function readCoverageSummary(cwd: string, changedFiles: string[]) {
  const summary = JSON.parse(
    await readFile(path.join(cwd, COVERAGE_SUMMARY_PATH), "utf8")
  ) as CoverageSummary;
  const changedFileBranchCoverage = readChangedFileBranchCoverage(
    summary,
    changedFiles,
    cwd
  );

  return changedFileBranchCoverage;
}

async function shouldRunCoverage(cwd: string, changedFiles: string[]) {
  if (selectCoverageRelevantFiles(changedFiles).length === 0) {
    return false;
  }

  return pathExists(path.join(cwd, COVERAGE_SUMMARY_PATH));
}

async function readLastCodexRunChangedFiles(cwd: string) {
  try {
    const content = await readFile(path.join(cwd, LAST_CODEX_RUN_PATH), "utf8");
    const parsed = JSON.parse(content) as {
      changedFiles?: unknown;
    };

    if (!Array.isArray(parsed.changedFiles)) {
      return null;
    }

    return parsed.changedFiles
      .filter((filePath): filePath is string => typeof filePath === "string")
      .map(normalizeGitPath);
  } catch {
    return null;
  }
}

function intersectChangedFiles(changedFiles: string[], scopedFiles: string[]) {
  const changedFileSet = new Set(changedFiles);

  return scopedFiles.filter((filePath) => changedFileSet.has(filePath));
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

  const lastCodexRunChangedFiles = await readLastCodexRunChangedFiles(cwd);
  const verificationFiles = lastCodexRunChangedFiles
    ? intersectChangedFiles(changedFiles, lastCodexRunChangedFiles)
    : changedFiles;
  const coverageFiles = lastCodexRunChangedFiles ? verificationFiles : [];

  const jestFiles = selectJestRelatedFiles(verificationFiles);

  if (jestFiles.length === 0) {
    return {
      success: true,
      coverage: null,
      output: "npm run typecheck passed. No changed JS/TS files required Jest verification."
    };
  }

  const runCoverage = await shouldRunCoverage(cwd, coverageFiles);
  const output = await runCommand({
    cwd,
    logger,
    command: "npm",
    args: [
      "run",
      runCoverage ? "test" : "test:related",
      "--",
      "--findRelatedTests",
      ...jestFiles
    ],
    failureLabel: runCoverage ? "npm run test" : "npm run test:related"
  });

  let changedFileBranchCoverage = null;

  if (runCoverage) {
    try {
      changedFileBranchCoverage = await readCoverageSummary(cwd, coverageFiles);
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
  } else if (output.success) {
    return {
      success: true,
      coverage: null,
      output:
        "npm run typecheck passed. Related Jest tests passed for changed files. Coverage was skipped because no eligible changed files or coverage summary were found."
    };
  }

  if (!output.success) {
    return {
      success: false,
      coverage: changedFileBranchCoverage,
      output:
        `${runCoverage ? "npm run test" : "npm run test:related"} failed.\n${output.output.replace(/^npm run test(?::related)? failed\.\n?/, "")}`.trim()
    };
  }

  if (typeof changedFileBranchCoverage !== "number") {
    return {
      success: true,
      coverage: null,
      output:
        "npm run typecheck passed. Related Jest tests passed for changed files. No changed-file branch coverage was reported."
    };
  }

  if (changedFileBranchCoverage <= threshold) {
    return {
      success: false,
      coverage: changedFileBranchCoverage,
      output: `Coverage check failed: changed-file branch coverage ${changedFileBranchCoverage}% is not greater than ${threshold}%.`
    };
  }

  return {
    success: true,
    coverage: changedFileBranchCoverage,
    output: `npm run typecheck passed. Related Jest tests passed for changed files. Changed-file branch coverage: ${changedFileBranchCoverage}%.`
  };
}
