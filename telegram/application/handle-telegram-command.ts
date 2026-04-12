import { buildIntentPrompt } from "../config.ts";
import {
  buildCodexPrompt,
  buildVerificationRepairPrompt,
  extractJSON
} from "../domain/message-utils.ts";
import {
  detectBlockedPermission,
  detectPreflightPermission,
  isApprovalAnswer,
  NO_ANSWERS
} from "./command-permissions.ts";
import { runCodeTaskVerification } from "./code-task-verifier.ts";
import { callGroq } from "../../models/text/groq.ts";
import { isCodexRunning, runCodex } from "../../models/code/codex.ts";
import { createApprovalSessionStore } from "../infrastructure/approval-session-store.ts";
import { appendTaskLog } from "../infrastructure/task-log.ts";
import type {
  ApprovalPermission,
  ApprovalSession,
  CommandHandlerDependencies,
  IntentPayload
} from "../../types/telegram/application/handle-telegram-command.ts";
import type { CodexResult } from "../../types/models/code/codex.ts";
import type { VerificationResult } from "../../types/telegram/application/code-task-verifier.ts";

function createReplyPlan(plan) {
  return Array.isArray(plan) ? plan : [];
}

const MAX_CODE_REPAIR_ATTEMPTS = 3;

function formatCoverageSuffix(coverage) {
  return coverage == null ? "Coverage: unavailable" : `Coverage: ${coverage}%`;
}

function readIntentPayload(response: string): IntentPayload | null {
  const parsed = extractJSON(response);

  if (!parsed) {
    return null;
  }

  return {
    intent: parsed.intent || "chat",
    reply: parsed.reply || "I couldn't process that.",
    processingReply:
      parsed.processing_reply ||
      (parsed.intent === "code"
        ? "Codex is working right now, enjoy your coffee...."
        : ""),
    plan: createReplyPlan(parsed.plan)
  };
}

export function createTelegramCommandHandler({
  sendMessage,
  askModel = callGroq,
  codexRunner = runCodex,
  codexRunChecker = isCodexRunning,
  codeTaskVerifier = runCodeTaskVerification,
  approvalSessionStore = createApprovalSessionStore(),
  taskLogger = appendTaskLog,
  logger = console
}: CommandHandlerDependencies) {
  const approvalSession = approvalSessionStore;
  let isCodeTaskRunning = false;
  let isIntentRequestRunning = false;

  async function sendApprovalRequest(permission: ApprovalPermission) {
    await sendMessage(
      [
        `Codex needs temporary permission to ${permission.action}.`,
        `Reason: ${permission.reason}`,
        "Reply yes to allow it once, or no to stop the current session."
      ].join("\n")
    );
  }

  async function sendCodexResult(result: CodexResult, failurePrefix: string) {
    await sendMessage(`${failurePrefix}:\n${result.output}`);
  }

  async function saveApprovalSession(
    command: string,
    prompt: string,
    permission: ApprovalPermission,
    plan: string[]
  ) {
    await approvalSession.set({
      command,
      prompt,
      permission,
      plan
    });
  }

  async function retrySavedCodexRun(savedSession: ApprovalSession) {
    await sendMessage(
      `Temporary permission granted. Retrying to ${savedSession.permission.action}...`
    );

    const retriedResult = await codexRunner(savedSession.prompt, {
      bypassApprovals: true
    });
    await taskLogger({
      plan: savedSession.plan,
      output: retriedResult.output
    });

    await finalizeCodexTask(
      savedSession.command,
      savedSession.plan,
      retriedResult,
      {
        bypassApprovals: true,
        failurePrefix: "Codex failed after retry"
      }
    );
  }

  async function finalizeCodexTask(
    command: string,
    plan: string[],
    result: CodexResult,
    { bypassApprovals = false, failurePrefix = "Codex failed" } = {}
  ) {
    if (!result.success) {
      await sendCodexResult(result, failurePrefix);
      return;
    }

    let latestResult = result;

    for (let attempt = 1; attempt <= MAX_CODE_REPAIR_ATTEMPTS; attempt += 1) {
      const verification = (await codeTaskVerifier()) as VerificationResult;

      if (verification.success) {
        await sendMessage(
          `Codex done:\n${latestResult.output}\n\n${formatCoverageSuffix(verification.coverage)}`
        );
        return;
      }

      if (attempt === MAX_CODE_REPAIR_ATTEMPTS) {
        await sendMessage(
          [
            `Codex result after failed attempts:\n${latestResult.output}`,
            verification.output,
            formatCoverageSuffix(verification.coverage)
          ].join("\n\n")
        );
        return;
      }

      await sendMessage(
        `Tests or coverage are still failing. Codex is fixing them now (attempt ${attempt + 1}/${MAX_CODE_REPAIR_ATTEMPTS}).`
      );

      const repairPrompt = buildVerificationRepairPrompt({
        command,
        previousOutput: latestResult.output,
        verificationOutput: verification.output
      });

      latestResult = bypassApprovals
        ? await codexRunner(repairPrompt, { bypassApprovals: true })
        : await codexRunner(repairPrompt);
      await taskLogger({
        plan,
        output: latestResult.output
      });

      if (!latestResult.success) {
        await sendCodexResult(latestResult, failurePrefix);
        return;
      }
    }
  }

  async function handleApprovalReply(normalizedCommand: string) {
    if (!isApprovalAnswer(normalizedCommand)) {
      await sendMessage(
        "Reply yes to allow the temporary permission, or no to stop the current session."
      );
      return;
    }

    const savedSession = await approvalSession.clear();

    if (NO_ANSWERS.has(normalizedCommand)) {
      await sendMessage("Permission denied. Stopping the current session.");
      return;
    }

    if (!savedSession) {
      await sendMessage(
        "No approval is pending anymore. Please resend the original task."
      );
      return;
    }

    await retrySavedCodexRun(savedSession);
  }

  async function runCodexTask(
    command: string,
    plan: string[],
    processingReply: string
  ) {
    if (isCodeTaskRunning || (await codexRunChecker())) {
      await sendMessage("Codex is still processing another request. Please wait.");
      return;
    }

    isCodeTaskRunning = true;

    try {
      await sendMessage(`Plan:\n${plan}`);

      const prompt = buildCodexPrompt(command, plan);
      const preflightPermission = detectPreflightPermission(command);

      if (preflightPermission) {
        await saveApprovalSession(command, prompt, preflightPermission, plan);
        await sendApprovalRequest(preflightPermission);
        return;
      }

      await sendMessage(processingReply);
      const result = await codexRunner(prompt);
      await taskLogger({
        plan,
        output: result.output
      });
      const blockedPermission = detectBlockedPermission(command, result.output);

      if (blockedPermission) {
        await saveApprovalSession(command, prompt, blockedPermission, plan);
        await sendApprovalRequest(blockedPermission);
        return;
      }

      await finalizeCodexTask(command, plan, result);
    } finally {
      isCodeTaskRunning = false;
    }
  }

  async function handleChatIntent(reply: string) {
    await sendMessage(`${reply}`);
  }

  async function handleIntent(command: string, payload: IntentPayload) {
    logger.log("Intent:", payload.intent);

    if (payload.intent === "chat") {
      await handleChatIntent(payload.reply);
      return;
    }

    if (payload.intent === "code") {
      await runCodexTask(command, payload.plan, payload.processingReply);
      return;
    }

    await sendMessage("Unknown intent.");
  }

  return async function handleTelegramCommand(command: string) {
    logger.log("Incoming:", command);

    const normalizedCommand = command.trim().toLowerCase();

    if (await approvalSession.get()) {
      await handleApprovalReply(normalizedCommand);
      return;
    }

    if (isApprovalAnswer(normalizedCommand)) {
      await sendMessage(
        "No approval is pending anymore. Please resend the original task."
      );
      return;
    }

    if (isIntentRequestRunning) {
      await sendMessage("Schitzo Bot is still processing another request. Please wait.");
      return;
    }

    isIntentRequestRunning = true;

    try {
      logger.log("Using Model (single call)...");

      const response = await askModel(buildIntentPrompt(command));

      if (!response) {
        await sendMessage("Model unavailable or quota exceeded.");
        return;
      }

      const payload = readIntentPayload(response);
      logger.log(payload);

      if (!payload) {
        logger.log("Failed to parse JSON:", response);
        await sendMessage("Failed to understand response.");
        return;
      }

      await handleIntent(command, payload);
    } finally {
      isIntentRequestRunning = false;
    }
  };
}
