import {
  parseEnvLine,
  loadEnvFile,
  readRequiredEnv,
  readEnv,
  readEnvNumber,
  _resetEnvLoaded,
} from "../src/utils/env.ts";
import fs from "fs";
import path from "path";
import os from "os";

describe("parseEnvLine", () => {
  it("parses KEY=value", () => {
    expect(parseEnvLine("FOO=bar")).toEqual({ key: "FOO", value: "bar" });
  });

  it("parses quoted values (double)", () => {
    expect(parseEnvLine('FOO="bar baz"')).toEqual({ key: "FOO", value: "bar baz" });
  });

  it("parses quoted values (single)", () => {
    expect(parseEnvLine("FOO='bar baz'")).toEqual({ key: "FOO", value: "bar baz" });
  });

  it("returns null for empty line", () => {
    expect(parseEnvLine("")).toBeNull();
  });

  it("returns null for comment", () => {
    expect(parseEnvLine("# comment")).toBeNull();
  });

  it("returns null for line without =", () => {
    expect(parseEnvLine("NOEQUALS")).toBeNull();
  });

  it("returns null for line with empty key", () => {
    expect(parseEnvLine("=value")).toBeNull();
  });

  it("handles whitespace around key and value", () => {
    expect(parseEnvLine("  KEY  =  value  ")).toEqual({ key: "KEY", value: "value" });
  });

  it("handles value with = in it", () => {
    expect(parseEnvLine("KEY=a=b")).toEqual({ key: "KEY", value: "a=b" });
  });

  it("handles empty value", () => {
    expect(parseEnvLine("KEY=")).toEqual({ key: "KEY", value: "" });
  });
});

describe("loadEnvFile", () => {
  let tmpDir: string;

  beforeEach(() => {
    _resetEnvLoaded();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "env-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
    delete process.env["TEST_ENV_VAR_XYZ"];
  });

  it("loads variables from file", () => {
    const envFile = path.join(tmpDir, ".env");
    fs.writeFileSync(envFile, "TEST_ENV_VAR_XYZ=hello\n");
    loadEnvFile(envFile);
    expect(process.env["TEST_ENV_VAR_XYZ"]).toBe("hello");
  });

  it("does not overwrite existing env vars", () => {
    process.env["TEST_ENV_VAR_XYZ"] = "existing";
    const envFile = path.join(tmpDir, ".env");
    fs.writeFileSync(envFile, "TEST_ENV_VAR_XYZ=new\n");
    loadEnvFile(envFile);
    expect(process.env["TEST_ENV_VAR_XYZ"]).toBe("existing");
  });

  it("does nothing if file does not exist", () => {
    loadEnvFile(path.join(tmpDir, "nonexistent"));
    // no throw
  });

  it("only loads once", () => {
    const envFile = path.join(tmpDir, ".env");
    fs.writeFileSync(envFile, "TEST_ENV_VAR_XYZ=first\n");
    loadEnvFile(envFile);
    _resetEnvLoaded();
    // Reset and change file
    delete process.env["TEST_ENV_VAR_XYZ"];
    fs.writeFileSync(envFile, "TEST_ENV_VAR_XYZ=second\n");
    loadEnvFile(envFile);
    expect(process.env["TEST_ENV_VAR_XYZ"]).toBe("second");
  });
});

describe("readRequiredEnv", () => {
  beforeEach(() => _resetEnvLoaded());

  it("returns value when set", () => {
    process.env["TEST_REQ_ENV"] = "val";
    expect(readRequiredEnv("TEST_REQ_ENV")).toBe("val");
    delete process.env["TEST_REQ_ENV"];
  });

  it("throws when missing", () => {
    delete process.env["MISSING_VAR_XYZ_123"];
    expect(() => readRequiredEnv("MISSING_VAR_XYZ_123")).toThrow(/Missing required/);
  });
});

describe("readEnv", () => {
  beforeEach(() => _resetEnvLoaded());

  it("returns env value when set", () => {
    process.env["TEST_OPT_ENV"] = "val";
    expect(readEnv("TEST_OPT_ENV", "default")).toBe("val");
    delete process.env["TEST_OPT_ENV"];
  });

  it("returns fallback when not set", () => {
    delete process.env["MISSING_OPT_XYZ"];
    expect(readEnv("MISSING_OPT_XYZ", "fallback")).toBe("fallback");
  });
});

describe("readEnvNumber", () => {
  beforeEach(() => _resetEnvLoaded());

  it("returns parsed number", () => {
    process.env["TEST_NUM_ENV"] = "42";
    expect(readEnvNumber("TEST_NUM_ENV", 0)).toBe(42);
    delete process.env["TEST_NUM_ENV"];
  });

  it("returns fallback for non-numeric", () => {
    process.env["TEST_NUM_ENV"] = "abc";
    expect(readEnvNumber("TEST_NUM_ENV", 99)).toBe(99);
    delete process.env["TEST_NUM_ENV"];
  });

  it("returns fallback when not set", () => {
    delete process.env["MISSING_NUM_XYZ"];
    expect(readEnvNumber("MISSING_NUM_XYZ", 7)).toBe(7);
  });
});
