import type { CodexResult, CodexRunOptions } from "../../models/code/codex.ts";
import type { VerificationResult } from "./code-task-verifier.ts";

export type ApprovalPermission = {
  action: string;
  reason: string;
};

export type ApprovalSession = {
  command: string;
  prompt: string;
  permission: ApprovalPermission;
  plan: string[];
  runOptions?: CodexRunOptions;
};

export type IntentPayload = {
  intent: string;
  reply: string;
  processingReply: string;
  plan: string[];
};

export type CommandHandlerDependencies = {
  sendMessage: (message: string) => Promise<unknown>;
  askModel?: (prompt: string) => Promise<string | null>;
  codexRunner?: (
    prompt: string,
    options?: CodexRunOptions
  ) => Promise<CodexResult>;
  codexRunChecker?: () => Promise<boolean>;
  codeTaskVerifier?: () => Promise<VerificationResult>;
  approvalSessionStore?: {
    get(): Promise<ApprovalSession | null>;
    set(value: ApprovalSession): Promise<unknown>;
    clear(): Promise<ApprovalSession | null>;
  };
  taskLogger?: (entry: { plan: string[]; output: string }) => Promise<unknown>;
  logger?: Pick<Console, "log">;
};
