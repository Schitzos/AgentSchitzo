import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { createTelegramCommandHandler } from "../../../telegram/application/handle-telegram-command.js";

describe("telegram/application/handle-telegram-command", () => {
  const sendMessage = jest.fn();
  const askModel = jest.fn();
  const codexRunner = jest.fn();
  const codeTaskVerifier = jest.fn();
  const taskLogger = jest.fn();
  const logger = { log: jest.fn() };

  beforeEach(() => {
    sendMessage.mockReset();
    askModel.mockReset();
    codexRunner.mockReset();
    codeTaskVerifier.mockReset();
    taskLogger.mockReset();
    logger.log.mockReset();
    codeTaskVerifier.mockResolvedValue({
      success: true,
      coverage: 91,
      output: "npm run test passed. Total line coverage: 91%."
    });
  });

  test("replies immediately for simple chat", async () => {
    const handler = createTelegramCommandHandler({
      sendMessage,
      askModel,
      codexRunner,
      codeTaskVerifier,
      taskLogger,
      logger
    });

    await handler("hi");

    expect(sendMessage).toHaveBeenCalledWith("Hello! I'm your AI agent.");
    expect(askModel).not.toHaveBeenCalled();
  });

  test("reports model outage when no response is returned", async () => {
    const handler = createTelegramCommandHandler({
      sendMessage,
      askModel,
      codexRunner,
      codeTaskVerifier,
      taskLogger,
      logger
    });

    askModel.mockResolvedValue(null);

    await handler("build a bot");

    expect(sendMessage).toHaveBeenCalledWith("Model unavailable or quota exceeded.");
  });

  test("handles chat intent", async () => {
    const handler = createTelegramCommandHandler({
      sendMessage,
      askModel,
      codexRunner,
      codeTaskVerifier,
      taskLogger,
      logger
    });

    askModel.mockResolvedValue("{\"intent\":\"chat\",\"reply\":\"Hello there\"}");

    await handler("say hello");

    expect(sendMessage).toHaveBeenCalledWith("Hello there");
  });

  test("handles code intent", async () => {
    const handler = createTelegramCommandHandler({
      sendMessage,
      askModel,
      codexRunner,
      codeTaskVerifier,
      taskLogger,
      logger
    });

    askModel.mockResolvedValue(
      "{\"intent\":\"code\",\"reply\":\"\",\"processing_reply\":\"Processing your request: connecting to Codex, analyzing request parameters, and running the query.\",\"plan\":[\"Write tests\"]}"
    );
    codexRunner.mockResolvedValue({ success: true, output: "Task executed by Codex" });

    await handler("write tests");

    expect(codexRunner).toHaveBeenCalledWith(
      [
        "User request:",
        "write tests",
        "",
        "Suggested plan from Model:",
        "Write tests",
        "",
        "Execute the task. Use the user request as source of truth. Treat the plan as guidance, not a hard constraint."
      ].join()
    );
    expect(sendMessage).toHaveBeenNthCalledWith(1, "Plan:\nWrite tests");
    expect(sendMessage).toHaveBeenNthCalledWith(
      2,
      "Processing your request: connecting to Codex, analyzing request parameters, and running the query."
    );
    expect(sendMessage).toHaveBeenNthCalledWith(
      3,
      "Codex done:\nTask executed by Codex\n\nCoverage: 91%"
    );
    expect(taskLogger).toHaveBeenCalledWith({
      plan: ["Write tests"],
      output: "Task executed by Codex"
    });
    expect(codeTaskVerifier).toHaveBeenCalledTimes(1);
  });

  test("reports codex failure output", async () => {
    const handler = createTelegramCommandHandler({
      sendMessage,
      askModel,
      codexRunner,
      codeTaskVerifier,
      taskLogger,
      logger
    });

    askModel.mockResolvedValue("{\"intent\":\"code\",\"reply\":\"\",\"plan\":[\"Write tests\"]}");
    codexRunner.mockResolvedValue({ success: false, output: "network error" });

    await handler("write tests");

    expect(sendMessage).toHaveBeenNthCalledWith(3, "Codex failed:\nnetwork error");
    expect(codeTaskVerifier).not.toHaveBeenCalled();
  });

  test("repairs the codebase when npm test coverage is 85% or lower, then sends the final result", async () => {
    const handler = createTelegramCommandHandler({
      sendMessage,
      askModel,
      codexRunner,
      codeTaskVerifier,
      taskLogger,
      logger
    });

    askModel.mockResolvedValue("{\"intent\":\"code\",\"reply\":\"\",\"plan\":[\"Write tests\"]}");
    codexRunner
      .mockResolvedValueOnce({ success: true, output: "Task executed by Codex" })
      .mockResolvedValueOnce({ success: true, output: "Tests fixed and coverage increased." });
    codeTaskVerifier
      .mockResolvedValueOnce({
        success: false,
        coverage: 90,
        output: "Coverage check failed: total branch coverage 90% is not greater than 90%."
      })
      .mockResolvedValueOnce({
        success: true,
        coverage: 91,
        output: "npm run test passed. Total branch coverage: 91%."
      });

    await handler("write tests");

    expect(codexRunner).toHaveBeenNthCalledWith(
      2,
      [
        "The previous Codex attempt completed the task, but project verification still failed.",
        "",
        "Original user request:",
        "write tests",
        "",
        "Previous Codex output:",
        "Task executed by Codex",
        "",
        "Verification failure:",
        "Coverage check failed: total branch coverage 90% is not greater than 90%.",
        "",
        "Fix the codebase so `npm run test` passes and total branch coverage is greater than 90%.",
        "Do not stop at explanation. Make the necessary code and test changes, then finish."
      ].join("\n")
    );
    expect(sendMessage).toHaveBeenNthCalledWith(
      3,
      "Tests or coverage are still failing. Codex is fixing them now (attempt 2/3)."
    );
    expect(sendMessage).toHaveBeenNthCalledWith(
      4,
      "Codex done:\nTests fixed and coverage increased.\n\nCoverage: 91%"
    );
    expect(taskLogger).toHaveBeenNthCalledWith(1, {
      plan: ["Write tests"],
      output: "Task executed by Codex"
    });
    expect(taskLogger).toHaveBeenNthCalledWith(2, {
      plan: ["Write tests"],
      output: "Tests fixed and coverage increased."
    });
    expect(codeTaskVerifier).toHaveBeenCalledTimes(2);
  });

  test("reports verification failure after exhausting the repair attempts", async () => {
    const handler = createTelegramCommandHandler({
      sendMessage,
      askModel,
      codexRunner,
      codeTaskVerifier,
      taskLogger,
      logger
    });

    askModel.mockResolvedValue("{\"intent\":\"code\",\"reply\":\"\",\"plan\":[\"Write tests\"]}");
    codexRunner
      .mockResolvedValueOnce({ success: true, output: "Task executed by Codex" })
      .mockResolvedValueOnce({ success: true, output: "Attempt one fix." })
      .mockResolvedValueOnce({ success: true, output: "Attempt two fix." });
    codeTaskVerifier.mockResolvedValue({
      success: false,
      coverage: 70,
      output: "Coverage check failed: total branch coverage 70% is not greater than 90%."
    });

    await handler("write tests");

    expect(sendMessage).toHaveBeenNthCalledWith(
      5,
      "Codex result after failed attempts:\nAttempt two fix.\n\nCoverage check failed: total branch coverage 70% is not greater than 90%.\n\nCoverage: 70%"
    );
    expect(codeTaskVerifier).toHaveBeenCalledTimes(3);
  });

  test("reports repair failure if a follow-up codex repair attempt fails", async () => {
    const handler = createTelegramCommandHandler({
      sendMessage,
      askModel,
      codexRunner,
      codeTaskVerifier,
      taskLogger,
      logger
    });

    askModel.mockResolvedValue("{\"intent\":\"code\",\"reply\":\"\",\"plan\":[\"Write tests\"]}");
    codexRunner
      .mockResolvedValueOnce({ success: true, output: "Initial result" })
      .mockResolvedValueOnce({ success: false, output: "repair failed" });
    codeTaskVerifier.mockResolvedValueOnce({
      success: false,
      coverage: 88,
      output: "Coverage check failed: total branch coverage 88% is not greater than 90%."
    });

    await handler("write tests");

    expect(sendMessage).toHaveBeenNthCalledWith(4, "Codex failed:\nrepair failed");
  });

  test("asks for telegram approval when codex is blocked by permissions", async () => {
    const handler = createTelegramCommandHandler({
      sendMessage,
      askModel,
      codexRunner,
      codeTaskVerifier,
      taskLogger,
      logger
    });

    askModel.mockResolvedValue("{\"intent\":\"code\",\"reply\":\"\",\"plan\":[\"Install the package\"]}");

    await handler("install a new lib");

    expect(sendMessage).toHaveBeenNthCalledWith(
      2,
      "Codex needs temporary permission to install dependencies. Reply yes to allow it once, or no to stop the current session."
    );
    expect(codexRunner).not.toHaveBeenCalled();
  });

  test("asks for telegram approval before codex runs for delete commands", async () => {
    const handler = createTelegramCommandHandler({
      sendMessage,
      askModel,
      codexRunner,
      codeTaskVerifier,
      taskLogger,
      logger
    });

    askModel.mockResolvedValue("{\"intent\":\"code\",\"reply\":\"\",\"plan\":[\"Delete the root test file\"]}");

    await handler("delete telegram-listener.test.js");

    expect(sendMessage).toHaveBeenNthCalledWith(
      2,
      "Codex needs temporary permission to delete files. Reply yes to allow it once, or no to stop the current session."
    );
    expect(codexRunner).not.toHaveBeenCalled();
  });

  test("asks for telegram approval before codex runs for rename commands", async () => {
    const handler = createTelegramCommandHandler({
      sendMessage,
      askModel,
      codexRunner,
      codeTaskVerifier,
      taskLogger,
      logger
    });

    askModel.mockResolvedValue("{\"intent\":\"code\",\"reply\":\"\",\"plan\":[\"Rename the file\"]}");

    await handler("rename foo.txt to bar.txt");

    expect(sendMessage).toHaveBeenNthCalledWith(
      2,
      "Codex needs temporary permission to rename or move files. Reply yes to allow it once, or no to stop the current session."
    );
    expect(codexRunner).not.toHaveBeenCalled();
  });

  test("still asks for telegram approval when codex reports a policy block for a command that was not preflighted", async () => {
    const handler = createTelegramCommandHandler({
      sendMessage,
      askModel,
      codexRunner,
      codeTaskVerifier,
      taskLogger,
      logger
    });

    askModel.mockResolvedValue("{\"intent\":\"code\",\"reply\":\"\",\"plan\":[\"Modify the environment\"]}");
    codexRunner.mockResolvedValue({
      success: true,
      output: "This action requires approval because the sandbox blocked it."
    });

    await handler("change the environment");

    expect(sendMessage).toHaveBeenNthCalledWith(
      3,
      "Codex needs temporary permission to run the blocked operation. Reply yes to allow it once, or no to stop the current session."
    );
  });

  test("retries once with elevated codex permissions after a yes reply", async () => {
    const handler = createTelegramCommandHandler({
      sendMessage,
      askModel,
      codexRunner,
      codeTaskVerifier,
      taskLogger,
      logger
    });

    askModel.mockResolvedValue("{\"intent\":\"code\",\"reply\":\"\",\"plan\":[\"Install the package\"]}");
    codexRunner
      .mockResolvedValueOnce({
        success: true,
        output: "Installed and finished."
      });

    await handler("install a new lib");
    await handler("yes");

    expect(codexRunner).toHaveBeenNthCalledWith(
      1,
      [
        "User request:",
        "install a new lib",
        "",
        "Suggested plan from Model:",
        "Install the package",
        "",
        "Execute the task. Use the user request as source of truth. Treat the plan as guidance, not a hard constraint."
      ].join(),
      { bypassApprovals: true }
    );
    expect(sendMessage).toHaveBeenNthCalledWith(
      3,
      "Temporary permission granted. Retrying to install dependencies..."
    );
    expect(sendMessage).toHaveBeenNthCalledWith(
      4,
      "Codex done:\nInstalled and finished.\n\nCoverage: 91%"
    );
    expect(taskLogger).toHaveBeenCalledWith({
      plan: ["Install the package"],
      output: "Installed and finished."
    });
    expect(codeTaskVerifier).toHaveBeenCalledTimes(1);
  });

  test("reports retry failures with the retry-specific prefix after approval", async () => {
    const handler = createTelegramCommandHandler({
      sendMessage,
      askModel,
      codexRunner,
      codeTaskVerifier,
      taskLogger,
      logger
    });

    askModel.mockResolvedValue("{\"intent\":\"code\",\"reply\":\"\",\"plan\":[\"Install the package\"]}");
    codexRunner.mockResolvedValueOnce({
      success: false,
      output: "still blocked"
    });

    await handler("install a new lib");
    await handler("yes");

    expect(sendMessage).toHaveBeenNthCalledWith(4, "Codex failed after retry:\nstill blocked");
    expect(codeTaskVerifier).not.toHaveBeenCalled();
  });

  test("keeps bypass approvals enabled during repair attempts after an approved retry", async () => {
    const handler = createTelegramCommandHandler({
      sendMessage,
      askModel,
      codexRunner,
      codeTaskVerifier,
      taskLogger
    });

    askModel.mockResolvedValue("{\"intent\":\"code\",\"reply\":\"\",\"plan\":[\"Install the package\"]}");
    codexRunner
      .mockResolvedValueOnce({ success: true, output: "Installed dependencies." })
      .mockResolvedValueOnce({ success: true, output: "Repaired with elevated access." });
    codeTaskVerifier
      .mockResolvedValueOnce({
        success: false,
        coverage: 89,
        output: "Coverage check failed: total branch coverage 89% is not greater than 90%."
      })
      .mockResolvedValueOnce({
        success: true,
        coverage: 100,
        output: "npm run test passed. Total branch coverage: 100%."
      });

    await handler("install a new lib");
    await handler("yes");

    expect(codexRunner).toHaveBeenNthCalledWith(
      2,
      [
        "The previous Codex attempt completed the task, but project verification still failed.",
        "",
        "Original user request:",
        "install a new lib",
        "",
        "Previous Codex output:",
        "Installed dependencies.",
        "",
        "Verification failure:",
        "Coverage check failed: total branch coverage 89% is not greater than 90%.",
        "",
        "Fix the codebase so `npm run test` passes and total branch coverage is greater than 90%.",
        "Do not stop at explanation. Make the necessary code and test changes, then finish."
      ].join("\n"),
      { bypassApprovals: true }
    );
    expect(sendMessage).toHaveBeenNthCalledWith(
      5,
      "Codex done:\nRepaired with elevated access.\n\nCoverage: 100%"
    );
  });

  test("stops the current session after a no reply", async () => {
    const handler = createTelegramCommandHandler({
      sendMessage,
      askModel,
      codexRunner,
      codeTaskVerifier,
      taskLogger,
      logger
    });

    askModel.mockResolvedValue("{\"intent\":\"code\",\"reply\":\"\",\"plan\":[\"Delete the file\"]}");

    await handler("delete the temp file");
    await handler("no");

    expect(sendMessage).toHaveBeenNthCalledWith(3, "Permission denied. Stopping the current session.");
    expect(codexRunner).not.toHaveBeenCalled();
  });

  test("requires a yes or no reply while approval is pending", async () => {
    const handler = createTelegramCommandHandler({
      sendMessage,
      askModel,
      codexRunner,
      codeTaskVerifier,
      taskLogger,
      logger
    });

    askModel.mockResolvedValue("{\"intent\":\"code\",\"reply\":\"\",\"plan\":[\"Delete the file\"]}");

    await handler("delete the temp file");
    await handler("what happened?");

    expect(sendMessage).toHaveBeenNthCalledWith(
      3,
      "Reply yes to allow the temporary permission, or no to stop the current session."
    );
  });

  test("reports unknown intent", async () => {
    const handler = createTelegramCommandHandler({
      sendMessage,
      askModel,
      codexRunner,
      codeTaskVerifier,
      taskLogger,
      logger
    });

    askModel.mockResolvedValue("{\"intent\":\"other\",\"reply\":\"??\"}");

    await handler("something else");

    expect(sendMessage).toHaveBeenCalledWith("Unknown intent.");
  });

  test("defaults missing intent and reply fields for chat payloads", async () => {
    const defaultLoggerSpy = jest.spyOn(console, "log").mockImplementation(() => {});

    try {
      const handler = createTelegramCommandHandler({
        sendMessage,
        askModel,
        codexRunner,
        codeTaskVerifier,
        taskLogger
      });

      askModel.mockResolvedValue("{\"plan\":\"not-an-array\"}");

      await handler("say something");

      expect(sendMessage).toHaveBeenCalledWith("I couldn't process that.");
      expect(defaultLoggerSpy).toHaveBeenCalledWith("Intent:", "chat");
    } finally {
      defaultLoggerSpy.mockRestore();
    }
  });

  test("reports parse failures", async () => {
    const handler = createTelegramCommandHandler({
      sendMessage,
      askModel,
      codexRunner,
      codeTaskVerifier,
      taskLogger,
      logger
    });

    askModel.mockResolvedValue("this is not valid json");

    await handler("bad payload");

    expect(sendMessage).toHaveBeenCalledWith("Failed to understand response.");
  });

  test("defaults missing payload fields and empty coverage values", async () => {
    const handler = createTelegramCommandHandler({
      sendMessage,
      askModel,
      codexRunner,
      codeTaskVerifier,
      taskLogger,
      logger
    });

    askModel.mockResolvedValue("{\"intent\":\"code\"}");
    codexRunner.mockResolvedValue({ success: true, output: "Task executed by Codex" });
    codeTaskVerifier.mockResolvedValue({
      success: true,
      coverage: null,
      output: "verification passed"
    });

    await handler("write tests");

    expect(sendMessage).toHaveBeenNthCalledWith(1, "Plan:\n");
    expect(sendMessage).toHaveBeenNthCalledWith(
      2,
      "Codex is working right now, enjoy your coffee...."
    );
    expect(sendMessage).toHaveBeenNthCalledWith(
      3,
      "Codex done:\nTask executed by Codex\n\nCoverage: unavailable"
    );
    expect(taskLogger).toHaveBeenCalledWith({
      plan: [],
      output: "Task executed by Codex"
    });
  });
});
