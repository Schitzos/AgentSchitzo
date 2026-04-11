import { spawn } from "child_process";
import { readFile } from "fs/promises";
import path from "path";

const COVERAGE_SUMMARY_PATH = path.join("coverage", "coverage-summary.json");

export function readTotalBranchCoverage(summary) {
  return summary?.total?.branches?.pct;
}

async function readCoverageSummary(cwd) {
  const summary = JSON.parse(
    await readFile(path.join(cwd, COVERAGE_SUMMARY_PATH), "utf8")
  );
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
  const output = await new Promise((resolve) => {
    const child = spawn("npm", ["run", "test"], {
      cwd,
      shell: process.platform === "win32",
      stdio: ["ignore", "pipe", "pipe"]
    });

    let combinedOutput = "";
    let settled = false;

    function finish(result) {
      if (settled) {
        return;
      }

      settled = true;
      resolve(result);
    }

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      combinedOutput += text;
      logger.log(text.trimEnd());
    });

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      combinedOutput += text;
      logger.log(text.trimEnd());
    });

    child.on("error", (error) => {
      finish({
        success: false,
        output: `npm run test failed to start: ${error.message}`
      });
    });

    child.on("close", (code) => {
      if (code !== 0) {
        finish({
          success: false,
          output: `npm run test failed.\n${combinedOutput.trim()}`
        });
        return;
      }

      finish({
        success: true,
        output: combinedOutput.trim()
      });
    });
  });

  let totalBranchCoverage = null;

  try {
    totalBranchCoverage = await readCoverageSummary(cwd);
  } catch (error) {
    if (output.success) {
      return {
        success: false,
        coverage: null,
        output: `Coverage summary is unavailable: ${error.message}`
      };
    }
  }

  if (!output.success) {
    return {
      success: false,
      coverage: totalBranchCoverage,
      output: `npm run test failed.\n${output.output.replace(/^npm run test failed\.\n?/, "")}`.trim()
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
    output: `npm run test passed. Total branch coverage: ${totalBranchCoverage}%.`
  };
}
