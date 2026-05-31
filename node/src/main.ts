import { runAgentRuntime } from "./application/bootstrap/agent-runtime.ts";

export {
  createSendFn,
  createWebhookHandler,
  createWebhookServer,
  downloadFile,
  processUpdate,
  type TelegramUpdate,
} from "./application/telegram/update-service.ts";

const isMainModule = process.argv[1]?.endsWith("node/src/main.ts") ||
  process.argv[1]?.endsWith("node/src/main.js") ||
  process.argv[1]?.endsWith("dist/node/src/main.js");

/* istanbul ignore next -- bootstrap code not unit-testable */
if (isMainModule) {
  runAgentRuntime().catch((error: unknown) => {
    console.error("Agent runtime failed to start:", error);
    process.exit(1);
  });
}
