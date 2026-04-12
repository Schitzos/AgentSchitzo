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

const { readTotalBranchCoverage, runCodeTaskVerification } =
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

      if (usesPathEnding(filePath, "coverage/coverage-summary.json")) {
        return JSON.stringify({
          total: {
            branches: {
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
        "npm run typecheck passed. Related Jest tests passed for changed files. Total branch coverage: 91%."
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
        "telegram/application/code-task-verifier.ts",
        "--passWithNoTests"
      ],
      {
        cwd: "C:\\AgentSchitzo",
        shell: true,
        stdio: ["ignore", "pipe", "pipe"]
      }
    );
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
      if (
        usesPathEnding(
          filePath,
          "tests/telegram/application/code-task-verifier.test.ts"
        )
      ) {
        return "file exists";
      }

      if (usesPathEnding(filePath, "coverage/coverage-summary.json")) {
        return JSON.stringify({
          total: {
            branches: {
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
      Buffer.from("tests/telegram/application/code-task-verifier.test.ts\n")
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
        "npm run typecheck passed. Related Jest tests passed for changed files, but coverage summary is unavailable: missing"
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
        "npm run typecheck passed. Related Jest tests passed for changed files, but coverage summary is unavailable: missing"
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

  test("fails when the coverage summary is missing total branch coverage", async () => {
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

      if (usesPathEnding(filePath, "coverage/coverage-summary.json")) {
        return JSON.stringify({
          total: {
            branches: {}
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
      coverage: null,
      output: "npm run test failed.\nsuite failed"
    });
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

      if (usesPathEnding(filePath, "coverage/coverage-summary.json")) {
        return JSON.stringify({
          total: {
            branches: {
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
        "Coverage check failed: total branch coverage 90% is not greater than 90%."
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
});
