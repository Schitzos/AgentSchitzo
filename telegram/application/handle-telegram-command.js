import { buildIntentPrompt } from "../config.js";
import {
  buildCodexPrompt,
  buildVerificationRepairPrompt,
  extractJSON,
  isSimpleChat
} from "../domain/message-utils.js";
import {
  detectBlockedPermission,
  detectPreflightPermission,
  isApprovalAnswer,
  NO_ANSWERS
} from "./command-permissions.js";
import { runCodeTaskVerification } from "./code-task-verifier.js";
import { callGroq } from "../../models/text/groq.js";
import { runCodex } from "../../models/code/codex.js";
import { appendTaskLog } from "../infrastructure/task-log.js";

function createApprovalSessionStore() {
  let session = null;

  return {
    get() {
      return session;
    },
    set(value) {
      session = value;
    },
    clear() {
      const currentSession = session;
      session = null;
      return currentSession;
    }
  };
}

function createReplyPlan(plan) {
  return Array.isArray(plan) ? plan : [];
}

const MAX_CODE_REPAIR_ATTEMPTS = 3;

function formatCoverageSuffix(coverage) {
  return coverage == null ? "Coverage: unavailable" : `Coverage: ${coverage}%`;
}

function readIntentPayload(response) {
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
  codeTaskVerifier = runCodeTaskVerification,
  taskLogger = appendTaskLog,
  logger = console
}) {
  const approvalSession = createApprovalSessionStore();

  async function sendApprovalRequest(action) {
    await sendMessage(
      `Codex needs temporary permission to ${action}. Reply yes to allow it once, or no to stop the current session.`
    );
  }

  async function sendCodexResult(result, failurePrefix) {
    await sendMessage(`${failurePrefix}:\n${result.output}`);
  }

  function saveApprovalSession(command, prompt, permission, plan) {
    approvalSession.set({
      command,
      prompt,
      permission,
      plan
    });
  }

  async function retrySavedCodexRun(savedSession) {
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

    await finalizeCodexTask(savedSession.command, savedSession.plan, retriedResult, {
      bypassApprovals: true,
      failurePrefix: "Codex failed after retry"
    });
  }

  async function finalizeCodexTask(
    command,
    plan,
    result,
    {
      bypassApprovals = false,
      failurePrefix = "Codex failed"
    } = {}
  ) {
    if (!result.success) {
      await sendCodexResult(result, failurePrefix);
      return;
    }

    let latestResult = result;

    for (let attempt = 1; attempt <= MAX_CODE_REPAIR_ATTEMPTS; attempt += 1) {
      const verification = await codeTaskVerifier();

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

  async function handleApprovalReply(normalizedCommand) {
    if (!isApprovalAnswer(normalizedCommand)) {
      await sendMessage(
        "Reply yes to allow the temporary permission, or no to stop the current session."
      );
      return;
    }

    const savedSession = approvalSession.clear();

    if (NO_ANSWERS.has(normalizedCommand)) {
      await sendMessage("Permission denied. Stopping the current session.");
      return;
    }

    await retrySavedCodexRun(savedSession);
  }

  async function runCodexTask(command, plan, processingReply) {
    await sendMessage(`Plan:\n${plan}`);

    const prompt = buildCodexPrompt(command, plan);
    const preflightPermission = detectPreflightPermission(command);

    if (preflightPermission) {
      saveApprovalSession(command, prompt, preflightPermission, plan);
      await sendApprovalRequest(preflightPermission.action);
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
      saveApprovalSession(command, prompt, blockedPermission, plan);
      await sendApprovalRequest(blockedPermission.action);
      return;
    }

    await finalizeCodexTask(command, plan, result);
  }

  async function handleChatIntent(reply) {
    await sendMessage(`${reply}`);
  }

  async function handleIntent(command, payload) {
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

  return async function handleTelegramCommand(command) {
    logger.log("Incoming:", command);

    const normalizedCommand = command.trim().toLowerCase();

    if (approvalSession.get()) {
      await handleApprovalReply(normalizedCommand);
      return;
    }

    if (isSimpleChat(command)) {
      await sendMessage("Hello! I'm your AI agent.");
      return;
    }

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
  };
}
