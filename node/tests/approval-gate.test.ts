import { classifyRisk, buildApprovalPrompt } from "../src/telegram/application/approval-gate.ts";

describe("classifyRisk", () => {
  it("returns high for delete database", () => {
    expect(classifyRisk("delete the production database")).toBe("high");
  });

  it("returns high for force push", () => {
    expect(classifyRisk("force push to main")).toBe("high");
  });

  it("returns high for git reset --hard", () => {
    expect(classifyRisk("run git reset --hard HEAD~5")).toBe("high");
  });

  it("returns high for rm -rf", () => {
    expect(classifyRisk("rm -rf /tmp/project")).toBe("high");
  });

  it("returns high for deploy to production", () => {
    expect(classifyRisk("deploy this to production")).toBe("high");
  });

  it("returns high for drop table", () => {
    expect(classifyRisk("drop table users")).toBe("high");
  });

  it("returns high for disable auth", () => {
    expect(classifyRisk("disable authentication on the API")).toBe("high");
  });

  it("returns high for overwrite env", () => {
    expect(classifyRisk("overwrite the .env file")).toBe("high");
  });

  it("returns low for normal coding request", () => {
    expect(classifyRisk("add a login form to the homepage")).toBe("low");
  });

  it("returns low for refactoring", () => {
    expect(classifyRisk("refactor the user service")).toBe("low");
  });

  it("returns low for test writing", () => {
    expect(classifyRisk("write tests for the auth module")).toBe("low");
  });
});

describe("buildApprovalPrompt", () => {
  it("includes the input text", () => {
    const result = buildApprovalPrompt("delete the prod database");
    expect(result).toContain("delete the prod database");
    expect(result).toContain("/yes");
    expect(result).toContain("/no");
  });

  it("truncates long input", () => {
    const long = "x".repeat(300);
    const result = buildApprovalPrompt(long);
    expect(result).toContain("…");
    expect(result.length).toBeLessThan(300 + 100);
  });
});
