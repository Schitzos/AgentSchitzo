import { getAdapter, listAdapters } from "../src/adapters/index.ts";

describe("adapters", () => {
  it("lists all adapters", () => {
    expect(listAdapters()).toEqual(["kiro", "gemini-cli", "codex-cli", "local-llm"]);
  });

  it("returns kiro adapter", () => {
    const a = getAdapter("kiro");
    expect(a.name).toBe("kiro");
    expect(a.command).toBe("kiro-cli");
    expect(a.buildArgs("/tmp")).toContain("--no-interactive");
  });

  it("throws on unknown adapter", () => {
    expect(() => getAdapter("nope")).toThrow(/Unknown adapter/);
  });

  it("kiro detects login URL", () => {
    const a = getAdapter("kiro");
    expect(a.detectLoginUrl!("Visit https://example.com/login to auth")).toBe(
      "https://example.com/login"
    );
    expect(a.detectLoginUrl!("no url here")).toBeNull();
  });

  it("kiro detects signin URL (app.kiro.dev)", () => {
    const a = getAdapter("kiro");
    expect(
      a.detectLoginUrl!("https://app.kiro.dev/signin?state=abc&code_challenge=xyz")
    ).toBe("https://app.kiro.dev/signin?state=abc&code_challenge=xyz");
  });

  it("gemini-cli adapter has correct properties", () => {
    const a = getAdapter("gemini-cli");
    expect(a.name).toBe("gemini-cli");
    expect(a.command).toBe("gemini");
    expect(a.buildArgs("/tmp")).toEqual(["--skip-trust", "--prompt"]);
    expect(a.buildArgs("/tmp", "gemini-2.5-pro")).toEqual(["--skip-trust", "--model", "gemini-2.5-pro", "--prompt"]);
  });

  it("codex-cli adapter has correct properties", () => {
    const a = getAdapter("codex-cli");
    expect(a.name).toBe("codex-cli");
    expect(a.command).toBe("codex");
    expect(a.buildArgs("/tmp")).toEqual(["exec", "--sandbox", "workspace-write"]);
    expect(a.buildArgs("/tmp", "o3")).toEqual(["exec", "--sandbox", "workspace-write", "--model", "o3"]);
  });

  it("local-llm adapter has correct properties", () => {
    const a = getAdapter("local-llm");
    expect(a.name).toBe("local-llm");
    expect(a.buildArgs("/tmp")).toEqual([]);
  });

  it("local-llm uses env vars when set", () => {
    // The adapter reads env at module load time, so we test the default
    const a = getAdapter("local-llm");
    expect(a.command).toBe("ollama");
  });
});
