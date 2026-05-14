// @ts-nocheck
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { EventEmitter } from "events";

const spawnMock = jest.fn();
const readFileMock = jest.fn();

jest.unstable_mockModule("child_process", () => ({
  spawn: spawnMock
}));

jest.unstable_mockModule("fs/promises", () => ({
  readFile: readFileMock
}));

const {
  readChangedFileBranchCoverage,
  readTotalBranchCoverage,
  runCodeTaskVerification
} =
  await import("../../../telegram/application/code-task-verifier.js");

function createChildProcessMock() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  return child;
}

async function flushAsyncWork() {
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function usesPathEnding(filePath, suffix) {
  const normalized = String(filePath).replace(/\\/g, "/");
  return normalized.endsWith(suffix);
}

describe("telegram/application/code-task-verifier", () => {
  beforeEach(() => {
    spawnMock.mockReset();
    readFileMock.mockReset();
  });

  test("reads total branch coverage from the summary", () => {
    expect(
      readTotalBranchCoverage({
        total: {
          branches: {
            pct: 91.2
          }
        }
      })
    ).toBe(91.2);
  });

  test("aggregates changed-file branch coverage from covered files in the summary", () => {
    expect(
      readChangedFileBranchCoverage(
        {
          total: {
            branches: {
              pct: 71.37
            }
          },
          "telegram/application/code-task-verifier.ts": {
            branches: {
              covered: 19,
              total: 20,
              pct: 95
            }
          },
          "telegram/application/handle-telegram-command.ts": {
            branches: {
              covered: 18,
              total: 20,
              pct: 90
            }
          }
        },
        [
          "telegram/application/code-task-verifier.ts",
          "telegram/application/handle-telegram-command.ts",
          "tests/telegram/application/code-task-verifier.test.ts"
        ]
      )
    ).toBe(92.5);
  });

  test("matches absolute coverage-summary paths against repo-relative changed files", () => {
    expect(
      readChangedFileBranchCoverage(
        {
          "C:\\AgentSchitzo\\telegram\\application\\code-task-verifier.ts": {
            branches: {
              covered: 44,
              total: 47,
              pct: 93.61
            }
          }
        },
        ["telegram/application/code-task-verifier.ts"],
        "C:\\AgentSchitzo"
      )
    ).toBe(93.62);
  });

  test("passes when typecheck and related changed-file tests succeed with coverage above 90%", async () => {
    const typecheckChild = createChildProcessMock();
    const gitDiffChild = createChildProcessMock();
    const gitLsFilesChild = createChildProcessMock();
    const jestChild = createChildProcessMock();

    spawnMock
      .mockReturnValueOnce(typecheckChild)
      .mockReturnValueOnce(gitDiffChild)
      .mockReturnValueOnce(gitLsFilesChild)
      .mockReturnValueOnce(jestChild);
    readFileMock.mockImplementation(async (filePath) => {
      if (usesPathEnding(filePath, "telegram/application/code-task-verifier.ts")) {
        return "file exists";
      }

      if (usesPathEnding(filePath, "logs/last-codex-run.json")) {
        return JSON.stringify({
          changedFiles: ["telegram/application/code-task-verifier.ts"]
        });
      }

      if (usesPathEnding(filePath, "coverage/coverage-summary.json")) {
        return JSON.stringify({
          total: {
            branches: {
              pct: 91
            }
          },
          "telegram/application/code-task-verifier.ts": {
            branches: {
              covered: 91,
              total: 100,
              pct: 91
            }
          }
        });
      }

      throw new Error(`Unexpected read: ${filePath}`);
    });

    const resultPromise = runCodeTaskVerification({
      cwd: "C:\\AgentSchitzo",
      logger: { log: jest.fn() }
    });

    typecheckChild.emit("close", 0);
    await flushAsyncWork();
    gitDiffChild.stdout.emit(
      "data",
      Buffer.from("telegram/application/code-task-verifier.ts\n")
    );
    gitDiffChild.emit("close", 0);
    await flushAsyncWork();
    gitLsFilesChild.emit("close", 0);
    await flushAsyncWork();
    jestChild.stdout.emit("data", Buffer.from("related tests passed"));
    jestChild.emit("close", 0);

    await expect(resultPromise).resolves.toEqual({
      success: true,
      coverage: 91,
      output:
        "npm run typecheck passed. Related Jest tests passed for changed files. Changed-file branch coverage: 91%."
    });
    expect(spawnMock).toHaveBeenNthCalledWith(1, "npm", ["run", "typecheck"], {
      cwd: "C:\\AgentSchitzo",
      shell: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    expect(spawnMock).toHaveBeenNthCalledWith(
      4,
      "npm",
      [
        "run",
        "test",
        "--",
        "--findRelatedTests",
        "telegram/application/code-task-verifier.ts"
      ],
      {
        cwd: "C:\\AgentSchitzo",
        shell: true,
        stdio: ["ignore", "pipe", "pipe"]
      }
    );
  });

  test("skips coverage and uses related tests without coverage when only test files changed", async () => {
    const typecheckChild = createChildProcessMock();
    const gitDiffChild = createChildProcessMock();
    const gitLsFilesChild = createChildProcessMock();
    const jestChild = createChildProcessMock();

    spawnMock
      .mockReturnValueOnce(typecheckChild)
      .mockReturnValueOnce(gitDiffChild)
      .mockReturnValueOnce(gitLsFilesChild)
      .mockReturnValueOnce(jestChild);
    readFileMock.mockImplementation(async (filePath) => {
      if (
        usesPathEnding(
          filePath,
          "tests/telegram/application/code-task-verifier.test.ts"
        )
      ) {
        return "file exists";
      }

      throw new Error(`Unexpected read: ${filePath}`);
    });

    const resultPromise = runCodeTaskVerification({
      cwd: "C:\\AgentSchitzo",
      logger: { log: jest.fn() }
    });

    typecheckChild.emit("close", 0);
    await flushAsyncWork();
    gitDiffChild.stdout.emit(
      "data",
      Buffer.from("tests/telegram/application/code-task-verifier.test.ts\n")
    );
    gitDiffChild.emit("close", 0);
    await flushAsyncWork();
    gitLsFilesChild.emit("close", 0);
    await flushAsyncWork();
    jestChild.stdout.emit("data", Buffer.from("related tests passed"));
    jestChild.emit("close", 0);

    await expect(resultPromise).resolves.toEqual({
      success: true,
      coverage: null,
      output:
        "npm run typecheck passed. Related Jest tests passed for changed files. Coverage was skipped because no eligible changed files or coverage summary were found."
    });
    expect(spawnMock).toHaveBeenNthCalledWith(
      4,
      "npm",
      [
        "run",
        "test:related",
        "--",
        "--findRelatedTests",
        "tests/telegram/application/code-task-verifier.test.ts"
      ],
      {
        cwd: "C:\\AgentSchitzo",
        shell: true,
        stdio: ["ignore", "pipe", "pipe"]
      }
    );
  });

  test("limits verification to the latest Codex-run changed files when that manifest is available", async () => {
    const typecheckChild = createChildProcessMock();
    const gitDiffChild = createChildProcessMock();
    const gitLsFilesChild = createChildProcessMock();
    const jestChild = createChildProcessMock();

    spawnMock
      .mockReturnValueOnce(typecheckChild)
      .mockReturnValueOnce(gitDiffChild)
      .mockReturnValueOnce(gitLsFilesChild)
      .mockReturnValueOnce(jestChild);
    readFileMock.mockImplementation(async (filePath) => {
      if (
        usesPathEnding(
          filePath,
          "telegram/application/code-task-verifier.ts"
        )
      ) {
        return "source exists";
      }

      if (
        usesPathEnding(
          filePath,
          "tests/telegram/application/code-task-verifier.test.ts"
        )
      ) {
        return "test exists";
      }

      if (usesPathEnding(filePath, "logs/last-codex-run.json")) {
        return JSON.stringify({
          changedFiles: ["tests/telegram/application/code-task-verifier.test.ts"]
        });
      }

      throw new Error(`Unexpected read: ${filePath}`);
    });

    const resultPromise = runCodeTaskVerification({
      cwd: "C:\\AgentSchitzo",
      logger: { log: jest.fn() }
    });

    typecheckChild.emit("close", 0);
    await flushAsyncWork();
    gitDiffChild.stdout.emit(
      "data",
      Buffer.from(
        "telegram/application/code-task-verifier.ts\ntests/telegram/application/code-task-verifier.test.ts\n"
      )
    );
    gitDiffChild.emit("close", 0);
    await flushAsyncWork();
    gitLsFilesChild.emit("close", 0);
    await flushAsyncWork();
    jestChild.stdout.emit("data", Buffer.from("related tests passed"));
    jestChild.emit("close", 0);

    await expect(resultPromise).resolves.toEqual({
      success: true,
      coverage: null,
      output:
        "npm run typecheck passed. Related Jest tests passed for changed files. Coverage was skipped because no eligible changed files or coverage summary were found."
    });
    expect(spawnMock).toHaveBeenNthCalledWith(
      4,
      "npm",
      [
        "run",
        "test:related",
        "--",
        "--findRelatedTests",
        "tests/telegram/application/code-task-verifier.test.ts"
      ],
      {
        cwd: "C:\\AgentSchitzo",
        shell: true,
        stdio: ["ignore", "pipe", "pipe"]
      }
    );
  });

  test("skips coverage when changed source files exist but no latest Codex-run manifest is available", async () => {
    const typecheckChild = createChildProcessMock();
    const gitDiffChild = createChildProcessMock();
    const gitLsFilesChild = createChildProcessMock();
    const jestChild = createChildProcessMock();

    spawnMock
      .mockReturnValueOnce(typecheckChild)
      .mockReturnValueOnce(gitDiffChild)
      .mockReturnValueOnce(gitLsFilesChild)
      .mockReturnValueOnce(jestChild);
    readFileMock.mockImplementation(async (filePath) => {
      if (usesPathEnding(filePath, "telegram/application/code-task-verifier.ts")) {
        return "source exists";
      }

      if (usesPathEnding(filePath, "logs/last-codex-run.json")) {
        throw new Error("missing");
      }

      if (usesPathEnding(filePath, "coverage/coverage-summary.json")) {
        return JSON.stringify({
          total: {
            branches: {
              pct: 100
            }
          }
        });
      }

      throw new Error(`Unexpected read: ${filePath}`);
    });

    const resultPromise = runCodeTaskVerification({
      cwd: "C:\\AgentSchitzo",
      logger: { log: jest.fn() }
    });

    typecheckChild.emit("close", 0);
    await flushAsyncWork();
    gitDiffChild.stdout.emit(
      "data",
      Buffer.from("telegram/application/code-task-verifier.ts\n")
    );
    gitDiffChild.emit("close", 0);
    await flushAsyncWork();
    gitLsFilesChild.emit("close", 0);
    await flushAsyncWork();
    jestChild.stdout.emit("data", Buffer.from("related tests passed"));
    jestChild.emit("close", 0);

    await expect(resultPromise).resolves.toEqual({
      success: true,
      coverage: null,
      output:
        "npm run typecheck passed. Related Jest tests passed for changed files. Coverage was skipped because no eligible changed files or coverage summary were found."
    });
    expect(spawnMock).toHaveBeenNthCalledWith(
      4,
      "npm",
      [
        "run",
        "test:related",
        "--",
        "--findRelatedTests",
        "telegram/application/code-task-verifier.ts"
      ],
      {
        cwd: "C:\\AgentSchitzo",
        shell: true,
        stdio: ["ignore", "pipe", "pipe"]
      }
    );
  });

  test("skips coverage when the latest Codex-run manifest has an invalid changedFiles payload", async () => {
    const typecheckChild = createChildProcessMock();
    const gitDiffChild = createChildProcessMock();
    const gitLsFilesChild = createChildProcessMock();
    const jestChild = createChildProcessMock();

    spawnMock
      .mockReturnValueOnce(typecheckChild)
      .mockReturnValueOnce(gitDiffChild)
      .mockReturnValueOnce(gitLsFilesChild)
      .mockReturnValueOnce(jestChild);
    readFileMock.mockImplementation(async (filePath) => {
      if (usesPathEnding(filePath, "telegram/application/code-task-verifier.ts")) {
        return "source exists";
      }

      if (usesPathEnding(filePath, "logs/last-codex-run.json")) {
        return JSON.stringify({
          changedFiles: "telegram/application/code-task-verifier.ts"
        });
      }

      if (usesPathEnding(filePath, "coverage/coverage-summary.json")) {
        return JSON.stringify({
          total: {
            branches: {
              pct: 100
            }
          }
        });
      }

      throw new Error(`Unexpected read: ${filePath}`);
    });

    const resultPromise = runCodeTaskVerification({
      cwd: "C:\\AgentSchitzo",
      logger: { log: jest.fn() }
    });

    typecheckChild.emit("close", 0);
    await flushAsyncWork();
    gitDiffChild.stdout.emit(
      "data",
      Buffer.from("telegram/application/code-task-verifier.ts\n")
    );
    gitDiffChild.emit("close", 0);
    await flushAsyncWork();
    gitLsFilesChild.emit("close", 0);
    await flushAsyncWork();
    jestChild.stdout.emit("data", Buffer.from("related tests passed"));
    jestChild.emit("close", 0);

    await expect(resultPromise).resolves.toEqual({
      success: true,
      coverage: null,
      output:
        "npm run typecheck passed. Related Jest tests passed for changed files. Coverage was skipped because no eligible changed files or coverage summary were found."
    });
  });

  test("passes after typecheck when no changed JS or TS files require Jest verification", async () => {
    const typecheckChild = createChildProcessMock();
    const gitDiffChild = createChildProcessMock();
    const gitLsFilesChild = createChildProcessMock();

    spawnMock
      .mockReturnValueOnce(typecheckChild)
      .mockReturnValueOnce(gitDiffChild)
      .mockReturnValueOnce(gitLsFilesChild);

    const resultPromise = runCodeTaskVerification({
      logger: { log: jest.fn() }
    });

    typecheckChild.emit("close", 0);
    await flushAsyncWork();
    gitDiffChild.stdout.emit("data", Buffer.from("README.md\n"));
    gitDiffChild.emit("close", 0);
    await flushAsyncWork();
    gitLsFilesChild.emit("close", 0);

    await expect(resultPromise).resolves.toEqual({
      success: true,
      coverage: null,
      output:
        "npm run typecheck passed. No changed JS/TS files required Jest verification."
    });
    expect(spawnMock).toHaveBeenCalledTimes(3);
  });

  test("fails immediately when typecheck exits with a non-zero code", async () => {
    const typecheckChild = createChildProcessMock();

    spawnMock.mockReturnValue(typecheckChild);

    const resultPromise = runCodeTaskVerification({
      logger: { log: jest.fn() }
    });

    typecheckChild.stderr.emit("data", Buffer.from("type errors"));
    typecheckChild.emit("close", 1);

    await expect(resultPromise).resolves.toEqual({
      success: false,
      coverage: null,
      output: "npm run typecheck failed.\ntype errors"
    });
    expect(spawnMock).toHaveBeenCalledTimes(1);
  });

  test("fails immediately when typecheck exits with no output", async () => {
    const typecheckChild = createChildProcessMock();

    spawnMock.mockReturnValue(typecheckChild);

    const resultPromise = runCodeTaskVerification({
      logger: { log: jest.fn() }
    });

    typecheckChild.emit("close", 1);

    await expect(resultPromise).resolves.toEqual({
      success: false,
      coverage: null,
      output: "npm run typecheck failed."
    });
  });

  test("fails when changed-file Jest verification exits with a non-zero code and still reports coverage when available", async () => {
    const typecheckChild = createChildProcessMock();
    const gitDiffChild = createChildProcessMock();
    const gitLsFilesChild = createChildProcessMock();
    const jestChild = createChildProcessMock();

    spawnMock
      .mockReturnValueOnce(typecheckChild)
      .mockReturnValueOnce(gitDiffChild)
      .mockReturnValueOnce(gitLsFilesChild)
      .mockReturnValueOnce(jestChild);
    readFileMock.mockImplementation(async (filePath) => {
      if (usesPathEnding(filePath, "telegram/application/code-task-verifier.ts")) {
        return "file exists";
      }

      if (usesPathEnding(filePath, "logs/last-codex-run.json")) {
        return JSON.stringify({
          changedFiles: ["telegram/application/code-task-verifier.ts"]
        });
      }

      if (usesPathEnding(filePath, "coverage/coverage-summary.json")) {
        return JSON.stringify({
          total: {
            branches: {
              pct: 72
            }
          },
          "telegram/application/code-task-verifier.ts": {
            branches: {
              covered: 18,
              total: 25,
              pct: 72
            }
          }
        });
      }

      throw new Error(`Unexpected read: ${filePath}`);
    });

    const resultPromise = runCodeTaskVerification({
      logger: { log: jest.fn() }
    });

    typecheckChild.emit("close", 0);
    await flushAsyncWork();
    gitDiffChild.stdout.emit(
      "data",
      Buffer.from("telegram/application/code-task-verifier.ts\n")
    );
    gitDiffChild.emit("close", 0);
    await flushAsyncWork();
    gitLsFilesChild.emit("close", 0);
    await flushAsyncWork();
    jestChild.stderr.emit("data", Buffer.from("suite failed"));
    jestChild.emit("close", 1);

    await expect(resultPromise).resolves.toEqual({
      success: false,
      coverage: 72,
      output: "npm run test failed.\nsuite failed"
    });
  });

  test("keeps the Jest failure when coverage cannot be read after a covered test run fails", async () => {
    const typecheckChild = createChildProcessMock();
    const gitDiffChild = createChildProcessMock();
    const gitLsFilesChild = createChildProcessMock();
    const jestChild = createChildProcessMock();

    spawnMock
      .mockReturnValueOnce(typecheckChild)
      .mockReturnValueOnce(gitDiffChild)
      .mockReturnValueOnce(gitLsFilesChild)
      .mockReturnValueOnce(jestChild);
    let coverageReadCount = 0;

    readFileMock.mockImplementation(async (filePath) => {
      if (usesPathEnding(filePath, "telegram/application/code-task-verifier.ts")) {
        return "file exists";
      }

      if (usesPathEnding(filePath, "logs/last-codex-run.json")) {
        return JSON.stringify({
          changedFiles: ["telegram/application/code-task-verifier.ts"]
        });
      }

      if (usesPathEnding(filePath, "coverage/coverage-summary.json")) {
        coverageReadCount += 1;

        if (coverageReadCount === 1) {
          return JSON.stringify({
            total: {
              branches: {
                pct: 72
              }
            }
          });
        }

        throw new Error("broken coverage");
      }

      throw new Error(`Unexpected read: ${filePath}`);
    });

    const resultPromise = runCodeTaskVerification({
      logger: { log: jest.fn() }
    });

    typecheckChild.emit("close", 0);
    await flushAsyncWork();
    gitDiffChild.stdout.emit(
      "data",
      Buffer.from("telegram/application/code-task-verifier.ts\n")
    );
    gitDiffChild.emit("close", 0);
    await flushAsyncWork();
    gitLsFilesChild.emit("close", 0);
    await flushAsyncWork();
    jestChild.stderr.emit("data", Buffer.from("suite failed"));
    jestChild.emit("close", 1);

    await expect(resultPromise).resolves.toEqual({
      success: false,
      coverage: null,
      output: "npm run test failed.\nsuite failed"
    });
  });

  test("keeps a covered Jest failure when the coverage read throws a non-Error value", async () => {
    const typecheckChild = createChildProcessMock();
    const gitDiffChild = createChildProcessMock();
    const gitLsFilesChild = createChildProcessMock();
    const jestChild = createChildProcessMock();

    spawnMock
      .mockReturnValueOnce(typecheckChild)
      .mockReturnValueOnce(gitDiffChild)
      .mockReturnValueOnce(gitLsFilesChild)
      .mockReturnValueOnce(jestChild);
    let coverageReadCount = 0;

    readFileMock.mockImplementation(async (filePath) => {
      if (usesPathEnding(filePath, "telegram/application/code-task-verifier.ts")) {
        return "file exists";
      }

      if (usesPathEnding(filePath, "logs/last-codex-run.json")) {
        return JSON.stringify({
          changedFiles: ["telegram/application/code-task-verifier.ts"]
        });
      }

      if (usesPathEnding(filePath, "coverage/coverage-summary.json")) {
        coverageReadCount += 1;

        if (coverageReadCount === 1) {
          return JSON.stringify({
            total: {
              branches: {
                pct: 72
              }
            }
          });
        }

        throw "broken coverage";
      }

      throw new Error(`Unexpected read: ${filePath}`);
    });

    const resultPromise = runCodeTaskVerification({
      logger: { log: jest.fn() }
    });

    typecheckChild.emit("close", 0);
    await flushAsyncWork();
    gitDiffChild.stdout.emit(
      "data",
      Buffer.from("telegram/application/code-task-verifier.ts\n")
    );
    gitDiffChild.emit("close", 0);
    await flushAsyncWork();
    gitLsFilesChild.emit("close", 0);
    await flushAsyncWork();
    jestChild.stderr.emit("data", Buffer.from("suite failed"));
    jestChild.emit("close", 1);

    await expect(resultPromise).resolves.toEqual({
      success: false,
      coverage: null,
      output: "npm run test failed.\nsuite failed"
    });
  });

  test("reports missing coverage as informational when typecheck and related tests pass", async () => {
    const typecheckChild = createChildProcessMock();
    const gitDiffChild = createChildProcessMock();
    const gitLsFilesChild = createChildProcessMock();
    const jestChild = createChildProcessMock();

    spawnMock
      .mockReturnValueOnce(typecheckChild)
      .mockReturnValueOnce(gitDiffChild)
      .mockReturnValueOnce(gitLsFilesChild)
      .mockReturnValueOnce(jestChild);
    readFileMock.mockImplementation(async (filePath) => {
      if (usesPathEnding(filePath, "telegram/application/code-task-verifier.ts")) {
        return "file exists";
      }

      throw new Error("missing");
    });

    const resultPromise = runCodeTaskVerification({
      logger: { log: jest.fn() }
    });

    typecheckChild.emit("close", 0);
    await flushAsyncWork();
    gitDiffChild.stdout.emit(
      "data",
      Buffer.from("telegram/application/code-task-verifier.ts\n")
    );
    gitDiffChild.emit("close", 0);
    await flushAsyncWork();
    gitLsFilesChild.emit("close", 0);
    await flushAsyncWork();
    jestChild.emit("close", 0);

    await expect(resultPromise).resolves.toEqual({
      success: true,
      coverage: null,
      output:
        "npm run typecheck passed. Related Jest tests passed for changed files. Coverage was skipped because no eligible changed files or coverage summary were found."
    });
  });

  test("reports non-Error coverage read failures as informational when tests pass", async () => {
    const typecheckChild = createChildProcessMock();
    const gitDiffChild = createChildProcessMock();
    const gitLsFilesChild = createChildProcessMock();
    const jestChild = createChildProcessMock();

    spawnMock
      .mockReturnValueOnce(typecheckChild)
      .mockReturnValueOnce(gitDiffChild)
      .mockReturnValueOnce(gitLsFilesChild)
      .mockReturnValueOnce(jestChild);
    readFileMock.mockImplementation(async (filePath) => {
      if (usesPathEnding(filePath, "telegram/application/code-task-verifier.ts")) {
        return "file exists";
      }

      throw "missing";
    });

    const resultPromise = runCodeTaskVerification({
      logger: { log: jest.fn() }
    });

    typecheckChild.emit("close", 0);
    await flushAsyncWork();
    gitDiffChild.stdout.emit(
      "data",
      Buffer.from("telegram/application/code-task-verifier.ts\n")
    );
    gitDiffChild.emit("close", 0);
    await flushAsyncWork();
    gitLsFilesChild.emit("close", 0);
    await flushAsyncWork();
    jestChild.emit("close", 0);

    await expect(resultPromise).resolves.toEqual({
      success: true,
      coverage: null,
      output:
        "npm run typecheck passed. Related Jest tests passed for changed files. Coverage was skipped because no eligible changed files or coverage summary were found."
    });
  });

  test("reports non-Error coverage read failures as informational after a covered test run passes", async () => {
    const typecheckChild = createChildProcessMock();
    const gitDiffChild = createChildProcessMock();
    const gitLsFilesChild = createChildProcessMock();
    const jestChild = createChildProcessMock();

    spawnMock
      .mockReturnValueOnce(typecheckChild)
      .mockReturnValueOnce(gitDiffChild)
      .mockReturnValueOnce(gitLsFilesChild)
      .mockReturnValueOnce(jestChild);
    let coverageReadCount = 0;

    readFileMock.mockImplementation(async (filePath) => {
      if (usesPathEnding(filePath, "telegram/application/code-task-verifier.ts")) {
        return "file exists";
      }

      if (usesPathEnding(filePath, "logs/last-codex-run.json")) {
        return JSON.stringify({
          changedFiles: ["telegram/application/code-task-verifier.ts"]
        });
      }

      if (usesPathEnding(filePath, "coverage/coverage-summary.json")) {
        coverageReadCount += 1;

        if (coverageReadCount === 1) {
          return JSON.stringify({
            total: {
              branches: {
                pct: 95
              }
            }
          });
        }

        throw "broken coverage";
      }

      throw new Error(`Unexpected read: ${filePath}`);
    });

    const resultPromise = runCodeTaskVerification({
      logger: { log: jest.fn() }
    });

    typecheckChild.emit("close", 0);
    await flushAsyncWork();
    gitDiffChild.stdout.emit(
      "data",
      Buffer.from("telegram/application/code-task-verifier.ts\n")
    );
    gitDiffChild.emit("close", 0);
    await flushAsyncWork();
    gitLsFilesChild.emit("close", 0);
    await flushAsyncWork();
    jestChild.emit("close", 0);

    await expect(resultPromise).resolves.toEqual({
      success: true,
      coverage: null,
      output:
        "npm run typecheck passed. Related Jest tests passed for changed files, but coverage summary is unavailable: broken coverage"
    });
  });

  test("keeps the related-test failure output when coverage is skipped", async () => {
    const typecheckChild = createChildProcessMock();
    const gitDiffChild = createChildProcessMock();
    const gitLsFilesChild = createChildProcessMock();
    const jestChild = createChildProcessMock();

    spawnMock
      .mockReturnValueOnce(typecheckChild)
      .mockReturnValueOnce(gitDiffChild)
      .mockReturnValueOnce(gitLsFilesChild)
      .mockReturnValueOnce(jestChild);
    readFileMock.mockImplementation(async (filePath) => {
      if (
        usesPathEnding(
          filePath,
          "tests/telegram/application/code-task-verifier.test.ts"
        )
      ) {
        return "file exists";
      }

      throw new Error(`Unexpected read: ${filePath}`);
    });

    const resultPromise = runCodeTaskVerification({
      cwd: "C:\\AgentSchitzo",
      logger: { log: jest.fn() }
    });

    typecheckChild.emit("close", 0);
    await flushAsyncWork();
    gitDiffChild.stdout.emit(
      "data",
      Buffer.from("tests/telegram/application/code-task-verifier.test.ts\n")
    );
    gitDiffChild.emit("close", 0);
    await flushAsyncWork();
    gitLsFilesChild.emit("close", 0);
    await flushAsyncWork();
    jestChild.stderr.emit("data", Buffer.from("related tests failed"));
    jestChild.emit("close", 1);

    await expect(resultPromise).resolves.toEqual({
      success: false,
      coverage: null,
      output: "npm run test:related failed.\nrelated tests failed"
    });
  });

  test("fails when changed-file discovery cannot be completed", async () => {
    const typecheckChild = createChildProcessMock();
    const gitDiffChild = createChildProcessMock();

    spawnMock
      .mockReturnValueOnce(typecheckChild)
      .mockReturnValueOnce(gitDiffChild);

    const resultPromise = runCodeTaskVerification({
      logger: { log: jest.fn() }
    });

    typecheckChild.emit("close", 0);
    await flushAsyncWork();
    gitDiffChild.emit("error", new Error("git missing"));
    gitDiffChild.emit("close", 0);

    await expect(resultPromise).resolves.toEqual({
      success: false,
      coverage: null,
      output:
        "Failed to determine changed files for verification: git diff failed to start: git missing"
    });
  });

  test("string errors during changed-file discovery are reported verbatim", async () => {
    const typecheckChild = createChildProcessMock();
    const gitDiffChild = createChildProcessMock();

    spawnMock
      .mockReturnValueOnce(typecheckChild)
      .mockReturnValueOnce(gitDiffChild);

    const resultPromise = runCodeTaskVerification({
      logger: { log: jest.fn() }
    });

    typecheckChild.emit("close", 0);
    await flushAsyncWork();
    gitDiffChild.emit("error", "git missing");
    gitDiffChild.emit("close", 0);

    await expect(resultPromise).resolves.toEqual({
      success: false,
      coverage: null,
      output:
        "Failed to determine changed files for verification: git diff failed to start: undefined"
    });
  });

  test("non-Error exceptions during changed-file discovery are stringified", async () => {
    const typecheckChild = createChildProcessMock();
    const gitDiffChild = createChildProcessMock();
    const gitLsFilesChild = createChildProcessMock();
    const cwd = {
      toString() {
        throw "cwd exploded";
      }
    };

    spawnMock
      .mockReturnValueOnce(typecheckChild)
      .mockReturnValueOnce(gitDiffChild)
      .mockReturnValueOnce(gitLsFilesChild);

    const resultPromise = runCodeTaskVerification({
      cwd,
      logger: { log: jest.fn() }
    });

    typecheckChild.emit("close", 0);
    await flushAsyncWork();
    gitDiffChild.stdout.emit("data", Buffer.from("src/index.ts\n"));
    gitDiffChild.emit("close", 0);
    await flushAsyncWork();
    gitLsFilesChild.emit("close", 0);

    await expect(resultPromise).resolves.toEqual({
      success: false,
      coverage: null,
      output:
        'Failed to determine changed files for verification: TypeError [ERR_INVALID_ARG_TYPE]: The "path" argument must be of type string. Received an instance of Object'
    });
  });

  test("ignores changed files that no longer exist on disk", async () => {
    const typecheckChild = createChildProcessMock();
    const gitDiffChild = createChildProcessMock();
    const gitLsFilesChild = createChildProcessMock();

    spawnMock
      .mockReturnValueOnce(typecheckChild)
      .mockReturnValueOnce(gitDiffChild)
      .mockReturnValueOnce(gitLsFilesChild);
    readFileMock.mockRejectedValue(new Error("missing"));

    const resultPromise = runCodeTaskVerification({
      logger: { log: jest.fn() }
    });

    typecheckChild.emit("close", 0);
    await flushAsyncWork();
    gitDiffChild.stdout.emit(
      "data",
      Buffer.from("telegram/application/deleted-file.ts\n")
    );
    gitDiffChild.emit("close", 0);
    await flushAsyncWork();
    gitLsFilesChild.emit("close", 0);

    await expect(resultPromise).resolves.toEqual({
      success: true,
      coverage: null,
      output:
        "npm run typecheck passed. No changed JS/TS files required Jest verification."
    });
    expect(spawnMock).toHaveBeenCalledTimes(3);
  });

  test("fails when untracked changed-file discovery cannot be completed", async () => {
    const typecheckChild = createChildProcessMock();
    const gitDiffChild = createChildProcessMock();
    const gitLsFilesChild = createChildProcessMock();

    spawnMock
      .mockReturnValueOnce(typecheckChild)
      .mockReturnValueOnce(gitDiffChild)
      .mockReturnValueOnce(gitLsFilesChild);

    const resultPromise = runCodeTaskVerification({
      logger: { log: jest.fn() }
    });

    typecheckChild.emit("close", 0);
    await flushAsyncWork();
    gitDiffChild.emit("close", 0);
    await flushAsyncWork();
    gitLsFilesChild.stderr.emit("data", Buffer.from("git ls-files failed"));
    gitLsFilesChild.emit("close", 1);

    await expect(resultPromise).resolves.toEqual({
      success: false,
      coverage: null,
      output:
        "Failed to determine changed files for verification: git ls-files failed.\ngit ls-files failed"
    });
  });

  test("reports missing changed-file coverage when no changed covered files are present", async () => {
    const typecheckChild = createChildProcessMock();
    const gitDiffChild = createChildProcessMock();
    const gitLsFilesChild = createChildProcessMock();
    const jestChild = createChildProcessMock();

    spawnMock
      .mockReturnValueOnce(typecheckChild)
      .mockReturnValueOnce(gitDiffChild)
      .mockReturnValueOnce(gitLsFilesChild)
      .mockReturnValueOnce(jestChild);
    readFileMock.mockImplementation(async (filePath) => {
      if (usesPathEnding(filePath, "telegram/application/code-task-verifier.ts")) {
        return "file exists";
      }

      if (usesPathEnding(filePath, "logs/last-codex-run.json")) {
        return JSON.stringify({
          changedFiles: ["telegram/application/code-task-verifier.ts"]
        });
      }

      if (usesPathEnding(filePath, "coverage/coverage-summary.json")) {
        return JSON.stringify({
          total: {
            branches: {
              pct: 90
            }
          },
          "telegram/application/other-file.ts": {
            branches: {
              covered: 9,
              total: 10,
              pct: 90
            }
          }
        });
      }

      throw new Error(`Unexpected read: ${filePath}`);
    });

    const resultPromise = runCodeTaskVerification({
      logger: { log: jest.fn() }
    });

    typecheckChild.emit("close", 0);
    await flushAsyncWork();
    gitDiffChild.stdout.emit(
      "data",
      Buffer.from("telegram/application/code-task-verifier.ts\n")
    );
    gitDiffChild.emit("close", 0);
    await flushAsyncWork();
    gitLsFilesChild.emit("close", 0);
    await flushAsyncWork();
    jestChild.emit("close", 0);

    await expect(resultPromise).resolves.toEqual({
      success: true,
      coverage: null,
      output:
        "npm run typecheck passed. Related Jest tests passed for changed files. No changed-file branch coverage was reported."
    });
  });

  test("ignores changed-file coverage entries without numeric branch totals", () => {
    expect(
      readChangedFileBranchCoverage(
        {
          "telegram/application/code-task-verifier.ts": {
            branches: {
              covered: 4,
              total: 5,
              pct: 80
            }
          },
          "telegram/application/handle-telegram-command.ts": {
            branches: {
              covered: "4",
              total: 5,
              pct: 80
            }
          },
          "telegram/application/command-permissions.ts": {
            branches: {
              covered: 4,
              total: "5",
              pct: 80
            }
          }
        },
        [
          "telegram/application/code-task-verifier.ts",
          "telegram/application/handle-telegram-command.ts",
          "telegram/application/command-permissions.ts"
        ]
      )
    ).toBe(80);
  });

  test("fails when related tests pass but branch coverage is equal to the threshold", async () => {
    const typecheckChild = createChildProcessMock();
    const gitDiffChild = createChildProcessMock();
    const gitLsFilesChild = createChildProcessMock();
    const jestChild = createChildProcessMock();

    spawnMock
      .mockReturnValueOnce(typecheckChild)
      .mockReturnValueOnce(gitDiffChild)
      .mockReturnValueOnce(gitLsFilesChild)
      .mockReturnValueOnce(jestChild);
    readFileMock.mockImplementation(async (filePath) => {
      if (usesPathEnding(filePath, "telegram/application/code-task-verifier.ts")) {
        return "file exists";
      }

      if (usesPathEnding(filePath, "logs/last-codex-run.json")) {
        return JSON.stringify({
          changedFiles: ["telegram/application/code-task-verifier.ts"]
        });
      }

      if (usesPathEnding(filePath, "coverage/coverage-summary.json")) {
        return JSON.stringify({
          total: {
            branches: {
              pct: 90
            }
          },
          "telegram/application/code-task-verifier.ts": {
            branches: {
              covered: 9,
              total: 10,
              pct: 90
            }
          }
        });
      }

      throw new Error(`Unexpected read: ${filePath}`);
    });

    const resultPromise = runCodeTaskVerification({
      logger: { log: jest.fn() }
    });

    typecheckChild.emit("close", 0);
    await flushAsyncWork();
    gitDiffChild.stdout.emit(
      "data",
      Buffer.from("telegram/application/code-task-verifier.ts\n")
    );
    gitDiffChild.emit("close", 0);
    await flushAsyncWork();
    gitLsFilesChild.emit("close", 0);
    await flushAsyncWork();
    jestChild.emit("close", 0);

    await expect(resultPromise).resolves.toEqual({
      success: false,
      coverage: 90,
      output:
        "Coverage check failed: changed-file branch coverage 90% is not greater than 90%."
    });
  });

  test("reports startup failures before typecheck can run", async () => {
    const typecheckChild = createChildProcessMock();

    spawnMock.mockReturnValue(typecheckChild);

    const resultPromise = runCodeTaskVerification();

    typecheckChild.emit("error", new Error("spawn failed"));
    typecheckChild.emit("close", 0);

    await expect(resultPromise).resolves.toEqual({
      success: false,
      coverage: null,
      output: "npm run typecheck failed to start: spawn failed"
    });
  });

  test("skips coverage when the coverage summary file is missing before test execution", async () => {
    const typecheckChild = createChildProcessMock();
    const gitDiffChild = createChildProcessMock();
    const gitLsFilesChild = createChildProcessMock();
    const jestChild = createChildProcessMock();

    spawnMock
      .mockReturnValueOnce(typecheckChild)
      .mockReturnValueOnce(gitDiffChild)
      .mockReturnValueOnce(gitLsFilesChild)
      .mockReturnValueOnce(jestChild);
    readFileMock.mockImplementation(async (filePath) => {
      if (usesPathEnding(filePath, "telegram/application/code-task-verifier.ts")) {
        return "file exists";
      }

      if (usesPathEnding(filePath, "logs/last-codex-run.json")) {
        return JSON.stringify({
          changedFiles: ["telegram/application/code-task-verifier.ts"]
        });
      }

      if (usesPathEnding(filePath, "coverage/coverage-summary.json")) {
        throw new Error("missing");
      }

      throw new Error(`Unexpected read: ${filePath}`);
    });

    const resultPromise = runCodeTaskVerification({
      cwd: "C:\\AgentSchitzo",
      logger: { log: jest.fn() }
    });

    typecheckChild.emit("close", 0);
    await flushAsyncWork();
    gitDiffChild.stdout.emit(
      "data",
      Buffer.from("telegram/application/code-task-verifier.ts\n")
    );
    gitDiffChild.emit("close", 0);
    await flushAsyncWork();
    gitLsFilesChild.emit("close", 0);
    await flushAsyncWork();
    jestChild.stdout.emit("data", Buffer.from("related tests passed"));
    jestChild.emit("close", 0);

    await expect(resultPromise).resolves.toEqual({
      success: true,
      coverage: null,
      output:
        "npm run typecheck passed. Related Jest tests passed for changed files. Coverage was skipped because no eligible changed files or coverage summary were found."
    });
    expect(spawnMock).toHaveBeenNthCalledWith(
      4,
      "npm",
      [
        "run",
        "test:related",
        "--",
        "--findRelatedTests",
        "telegram/application/code-task-verifier.ts"
      ],
      {
        cwd: "C:\\AgentSchitzo",
        shell: true,
        stdio: ["ignore", "pipe", "pipe"]
      }
    );
  });
});
