// @ts-nocheck
import { describe, expect, test } from "@jest/globals";
import {
  __testables__,
  detectBlockedPermission,
  detectPreflightPermission,
  isApprovalAnswer
} from "../../../telegram/application/command-permissions.js";

describe("telegram/application/command-permissions", () => {
  test("detects preflight install permissions", () => {
    expect(detectPreflightPermission("npm install")).toEqual({
      action: "install dependencies",
      reason:
        "The task needs to add or install packages, which changes project dependencies."
    });
  });

  test("returns null when no preflight permission is needed", () => {
    expect(detectPreflightPermission("run the tests")).toBeNull();
  });

  test("detects blocked permissions with a normalized output reason", () => {
    expect(
      detectBlockedPermission(
        "rename foo.txt to bar.txt",
        "Sandbox blocked policy\n\n move-item is not allowed "
      )
    ).toEqual({
      action: "rename or move files",
      reason:
        "The task needs to rename or move files, which changes the filesystem layout."
    });
  });

  test("uses the generic blocked-operation reason when no specific action is recognized", () => {
    expect(
      detectBlockedPermission(
        "change the environment",
        "requires elevated access"
      )
    ).toEqual({
      action: "run the blocked operation",
      reason:
        "Codex reported the operation was blocked: requires elevated access"
    });
  });

  test("falls back to the generic approval reason when normalized blocked output is empty", () => {
    const output = {
      toLowerCase: () => "permission",
      replace: () => "   "
    };

    expect(
      detectBlockedPermission("change the environment", output)
    ).toEqual({
      action: "run the blocked operation",
      reason:
        "The task requires temporary approval to run the blocked operation."
    });
  });

  test("falls back to the generic approval reason when no blocked output is available", () => {
    expect(
      __testables__.findPermissionReason("run the blocked operation")
    ).toBe("The task requires temporary approval to run the blocked operation.");
  });

  test("returns null when output has no permission signal", () => {
    expect(
      detectBlockedPermission("change the environment", "plain runtime error")
    ).toBeNull();
  });

  test("recognizes approval answers", () => {
    expect(isApprovalAnswer("yes")).toBe(true);
    expect(isApprovalAnswer("deny")).toBe(true);
    expect(isApprovalAnswer("maybe")).toBe(false);
  });
});
