import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test
} from "@jest/globals";
import fs from "fs";
import os from "os";
import path from "path";

const ORIGINAL_ENV = process.env;

async function importEnvModule() {
  jest.resetModules();
  return import("../../utils/env.js");
}

describe("utils/env", () => {
  let tempDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentschitzo-env-"));
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
    fs.rmSync(tempDir, { recursive: true, force: true });
    jest.resetModules();
    jest.restoreAllMocks();
  });

  test("loadEnvFile parses valid lines, strips quotes, and ignores invalid entries", async () => {
    const envPath = path.join(tempDir, ".env");
    fs.writeFileSync(
      envPath,
      [
        "# comment",
        "",
        "PLAIN=value",
        'DOUBLE="two words"',
        "SINGLE='three words'",
        "SPACED = spaced value",
        "MISSING_SEPARATOR",
        "=missing-key"
      ].join("\n")
    );

    const { loadEnvFile } = await importEnvModule();

    loadEnvFile(envPath);

    expect(process.env.PLAIN).toBe("value");
    expect(process.env.DOUBLE).toBe("two words");
    expect(process.env.SINGLE).toBe("three words");
    expect(process.env.SPACED).toBe("spaced value");
    expect(process.env.MISSING_SEPARATOR).toBeUndefined();
  });

  test("loadEnvFile does not overwrite existing env vars and only loads once", async () => {
    const envPath = path.join(tempDir, ".env");
    fs.writeFileSync(envPath, "EXISTING=from-file\nONCE=first");
    process.env.EXISTING = "from-process";

    const readFileSpy = jest.spyOn(fs, "readFileSync");
    const { loadEnvFile } = await importEnvModule();

    loadEnvFile(envPath);
    fs.writeFileSync(envPath, "EXISTING=updated\nONCE=second\nLATE=value");
    loadEnvFile(envPath);

    expect(process.env.EXISTING).toBe("from-process");
    expect(process.env.ONCE).toBe("first");
    expect(process.env.LATE).toBeUndefined();
    expect(readFileSpy).toHaveBeenCalledTimes(1);
  });

  test("loadEnvFile marks missing files as loaded and exits quietly", async () => {
    const missingPath = path.join(tempDir, "missing.env");
    const existsSpy = jest.spyOn(fs, "existsSync");
    const readSpy = jest.spyOn(fs, "readFileSync");
    const { loadEnvFile } = await importEnvModule();

    expect(() => loadEnvFile(missingPath)).not.toThrow();

    expect(existsSpy).toHaveBeenCalledWith(missingPath);
    expect(readSpy).not.toHaveBeenCalled();
  });

  test("readRequiredEnv loads from cwd .env and throws when missing", async () => {
    const originalCwd = process.cwd;
    jest.spyOn(process, "cwd").mockImplementation(() => tempDir);

    fs.writeFileSync(path.join(tempDir, ".env"), "REQUIRED_KEY=present");

    const { readRequiredEnv } = await importEnvModule();

    expect(readRequiredEnv("REQUIRED_KEY")).toBe("present");
    expect(() => readRequiredEnv("UNKNOWN_KEY")).toThrow(
      "Missing required environment variable: UNKNOWN_KEY"
    );

    process.cwd = originalCwd;
  });

  test("readEnv and readEnvNumber use fallback semantics for empty and invalid values", async () => {
    process.env.EMPTY_VALUE = "";
    process.env.ZERO_VALUE = "0";
    process.env.INVALID_NUMBER = "nan";

    const { readEnv, readEnvNumber } = await importEnvModule();

    expect(readEnv("EMPTY_VALUE", "fallback")).toBe("fallback");
    expect(readEnv("UNKNOWN_VALUE", "fallback")).toBe("fallback");
    expect(readEnvNumber("ZERO_VALUE", 9)).toBe(0);
    expect(readEnvNumber("UNKNOWN_NUMBER", 7)).toBe(7);
    expect(readEnvNumber("INVALID_NUMBER", 11)).toBe(11);
  });
});
