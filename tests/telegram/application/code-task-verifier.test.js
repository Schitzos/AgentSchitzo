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

const { readTotalBranchCoverage, runCodeTaskVerification } = await import(
  "../../../telegram/application/code-task-verifier.js"
);

function createChildProcessMock() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  return child;
}

describe("telegram/application/code-task-verifier", () => {
  beforeEach(() => {
    spawnMock.mockReset();
    readFileMock.mockReset();
  });

  test("reads total line coverage from the summary", () => {
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

  test("passes when npm test succeeds and branch coverage is above 90%", async () => {
    const child = createChildProcessMock();

    spawnMock.mockReturnValue(child);
    readFileMock.mockResolvedValue(
      JSON.stringify({
        total: {
          branches: {
            pct: 91
          }
        }
      })
    );

    const resultPromise = runCodeTaskVerification({
      cwd: "C:\\AgentSchitzo",
      logger: { log: jest.fn() }
    });

    child.stdout.emit("data", Buffer.from("tests passed"));
    child.emit("close", 0);

    await expect(resultPromise).resolves.toEqual({
      success: true,
      coverage: 91,
      output: "npm run test passed. Total branch coverage: 91%."
    });
    expect(spawnMock).toHaveBeenCalledWith("npm", ["run", "test"], {
      cwd: "C:\\AgentSchitzo",
      shell: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
  });

  test("fails when branch coverage is 90% or lower", async () => {
    const child = createChildProcessMock();

    spawnMock.mockReturnValue(child);
    readFileMock.mockResolvedValue(
      JSON.stringify({
        total: {
          branches: {
            pct: 90
          }
        }
      })
    );

    const resultPromise = runCodeTaskVerification({
      logger: { log: jest.fn() }
    });

    child.emit("close", 0);

    await expect(resultPromise).resolves.toEqual({
      success: false,
      coverage: 90,
      output: "Coverage check failed: total branch coverage 90% is not greater than 90%."
    });
  });

  test("fails when npm test exits with a non-zero code and still reports coverage when available", async () => {
    const child = createChildProcessMock();

    spawnMock.mockReturnValue(child);
    readFileMock.mockResolvedValue(
      JSON.stringify({
        total: {
          branches: {
            pct: 72
          }
        }
      })
    );

    const resultPromise = runCodeTaskVerification({
      logger: { log: jest.fn() }
    });

    child.stderr.emit("data", Buffer.from("suite failed"));
    child.emit("close", 1);

    await expect(resultPromise).resolves.toEqual({
      success: false,
      coverage: 72,
      output: "npm run test failed.\nsuite failed"
    });
  });

  test("reports unavailable coverage when npm test fails before a summary exists", async () => {
    const child = createChildProcessMock();

    spawnMock.mockReturnValue(child);
    readFileMock.mockRejectedValue(new Error("missing"));

    const resultPromise = runCodeTaskVerification({
      logger: { log: jest.fn() }
    });

    child.stderr.emit("data", Buffer.from("suite failed"));
    child.emit("close", 1);

    await expect(resultPromise).resolves.toEqual({
      success: false,
      coverage: null,
      output: "npm run test failed.\nsuite failed"
    });
  });

  test("reports unavailable coverage when npm test succeeds but the summary is missing", async () => {
    const child = createChildProcessMock();

    spawnMock.mockReturnValue(child);
    readFileMock.mockRejectedValue(new Error("missing"));

    const resultPromise = runCodeTaskVerification({
      logger: { log: jest.fn() }
    });

    child.emit("close", 0);

    await expect(resultPromise).resolves.toEqual({
      success: false,
      coverage: null,
      output: "Coverage summary is unavailable: missing"
    });
  });

  test("reports unavailable coverage when the summary does not include total branch coverage", async () => {
    const child = createChildProcessMock();

    spawnMock.mockReturnValue(child);
    readFileMock.mockResolvedValue(
      JSON.stringify({
        total: {
          lines: {
            pct: 99
          }
        }
      })
    );

    const resultPromise = runCodeTaskVerification({
      logger: { log: jest.fn() }
    });

    child.emit("close", 0);

    await expect(resultPromise).resolves.toEqual({
      success: false,
      coverage: null,
      output: "Coverage summary is unavailable: Coverage summary is missing total branch coverage."
    });
  });

  test("reports startup failures before npm test can run", async () => {
    const child = createChildProcessMock();

    spawnMock.mockReturnValue(child);
    readFileMock.mockRejectedValue(new Error("missing"));

    const resultPromise = runCodeTaskVerification();

    child.emit("error", new Error("spawn failed"));
    child.emit("close", 0);

    await expect(resultPromise).resolves.toEqual({
      success: false,
      coverage: null,
      output: "npm run test failed.\nnpm run test failed to start: spawn failed"
    });
  });
});
