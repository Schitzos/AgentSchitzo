# Design: Kiro Integration

## Architecture

```
┌──────────────┐       ┌──────────────────┐       ┌─────────────┐
│  Telegram    │◄─────►│  AgentSchitzo    │◄─────►│  kiro CLI   │
│  (user)      │ HTTP  │  (Node.js app)   │ stdio │  (child)    │
└──────────────┘       └──────────────────┘       └─────────────┘
```

## Module Changes

### New: `adapters/cli-model-adapter.ts`

Common interface all CLI model adapters implement:

```ts
interface CliModelAdapter {
  name: string;
  command: string;
  buildArgs(cwd: string): string[];
  detectLoginUrl?(output: string): string | null;
  detectProcessing?(output: string): boolean;
  detectIdle?(output: string): boolean;
}
```

### New: `adapters/kiro.ts`

```ts
export const kiroAdapter: CliModelAdapter = {
  name: "kiro",
  command: "kiro",
  buildArgs: () => [],
  detectLoginUrl: (output) => output.match(/https:\/\/\S+/)?.[0] || null,
};
```

### New: `adapters/gemini-cli.ts`

```ts
export const geminiCliAdapter: CliModelAdapter = {
  name: "gemini-cli",
  command: "gemini",
  buildArgs: () => [],
};
```

### New: `adapters/codex-cli.ts`

```ts
export const codexCliAdapter: CliModelAdapter = {
  name: "codex-cli",
  command: "codex",
  buildArgs: () => ["exec", "--full-auto", "-"],
};
```

### New: `adapters/local-llm.ts`

```ts
export const localLlmAdapter: CliModelAdapter = {
  name: "local-llm",
  command: process.env.LOCAL_LLM_COMMAND || "ollama",
  buildArgs: () => JSON.parse(process.env.LOCAL_LLM_ARGS || "[]"),
};
```

### New: `adapters/index.ts`

Registry that resolves adapter by name:

```ts
function getAdapter(name: string): CliModelAdapter;
```

### New: `kiro/kiro-session.ts` → `session/model-session.ts`

Manages the CLI model child process lifecycle. Uses the active `CliModelAdapter` to determine spawn command and args.

```ts
interface KiroSession {
  spawn(): void;
  write(input: string): void;
  interrupt(): void;
  kill(): void;
  isRunning(): boolean;
  isProcessing(): boolean;
  onOutput(callback: (text: string) => void): void;
  onExit(callback: (code: number | null) => void): void;
}
```

Responsibilities:
- Spawn `kiro` with `stdio: ['pipe', 'pipe', 'pipe']`.
- Buffer stdout/stderr chunks into complete lines.
- Expose event callbacks for output and exit.
- Track running state and processing state (processing = kiro is generating output).
- `interrupt()` sends SIGINT to the child process to cancel current work.

### New: `kiro/output-buffer.ts`

Aggregates rapid stdout chunks and flushes after a debounce (e.g. 500ms) to avoid spamming Telegram.

```ts
interface OutputBuffer {
  append(text: string): void;
  onFlush(callback: (text: string) => void): void;
  destroy(): void;
}
```

### Modified: `telegram/application/handle-telegram-command.ts`

Replace intent classification with simple command routing:

```ts
if (command === "/start")          → spawn kiro session
if (command === "/stop")           → kill kiro session
if (command === "/interrupt")      → send interrupt signal to kiro
if (command === "/status")         → reply with kiro state + queue length
if (command === "/model")          → reply with session info
if (command === "/verbose")        → toggle output mode
if (command === "/history")        → reply with last N task summaries
if (command === "/project <path>") → kill session, spawn in new dir
if (command === "/schedule ...")    → schedule a future command
if (command === "/help")           → list commands
if (command starts with "> ")      → strip prefix, forward to kiro stdin
else if no session                 → reply "No active session. Send /start to begin."
else if kiro is processing         → queue message, reply "Queued."
else                               → forward to kiro stdin
```

Remove: Groq calls, Codex runner, approval flow, code-task-verifier integration.

### Modified: `telegram-listener.ts`

Wire KiroSession into the app factory instead of askModel/codexRunner.

### Removed dependencies (can drop later)

- `models/text/groq.ts` — no longer in main flow
- `models/code/codex.ts` — replaced by kiro
- `telegram/application/code-task-verifier.ts` — kiro handles verification
- `telegram/application/command-permissions.ts` — kiro handles approvals

## Output Handling

1. kiro stdout emits chunks → `OutputBuffer` collects them.
2. After 500ms of silence, buffer flushes.
3. If flushed text > 4096 chars, split into multiple Telegram messages.
4. URL detection runs on each chunk immediately (login URL sent without waiting for buffer flush).
5. When kiro transitions from processing → idle, send a task summary to Telegram (last meaningful output or a condensed recap of what kiro did).

### Output Modes

- **Summary mode (default)**: only send the final task summary when kiro finishes.
- **Verbose mode** (`/verbose` toggle): stream all raw kiro output to Telegram in real-time (buffered at 500ms).

### Timeout

- If kiro produces no stdout/stderr for 5 minutes while in processing state, send a warning: "Kiro has been silent for 5 minutes. It may be stuck. Send /interrupt to cancel."
- Configurable via `KIRO_TIMEOUT_MS` env var (default 300000).

### Task History

- Store last 10 task summaries in memory.
- `/history` returns them as a numbered list.
- Reset on `/stop` or app restart.

### File Uploads

- When user sends a file/photo in Telegram, download it via Telegram Bot API `getFile`.
- Save to `./uploads/<original_filename>` (create dir if needed).
- Write to kiro stdin: `"User uploaded file: ./uploads/<filename>"`.
- Supports documents, photos, and voice (saved as .ogg).

### Session Auto-Resume

- On kiro spawn, write PID to `logs/kiro-session.json` (`{ pid, startedAt, cwd }`).
- On app startup, read `kiro-session.json` and check if PID is still alive (`kill(pid, 0)`).
- If alive, reattach stdout/stderr streams (re-open `/proc/<pid>/fd/1` or use a PTY/socket approach).
- If not alive, clean up the file and wait for `/start`.
- Note: true reattach to a child process's stdio is not trivial on all platforms. Fallback: detect alive process, notify user "Previous session still running (PID X)", and let `/stop` kill it before starting fresh.

### Project Switching

- `/project <path>` kills the active kiro session, then spawns a new one with `cwd` set to `<path>`.
- Validates path exists before spawning.
- Updates `kiro-session.json` with new cwd.

### Command Queue

- When kiro is processing and user sends a message (not `/interrupt`), push it to an in-memory queue.
- When kiro transitions from processing → idle, dequeue and send the next message to kiro stdin.
- Notify user: "Queued. Will send when kiro is ready."
- `/status` shows queue length.

### Destructive Action Confirmation

- After each kiro output flush, scan for destructive keywords: `delete`, `drop`, `force push`, `rm -rf`, `reset --hard`.
- If detected, pause kiro (SIGSTOP or hold stdin) and send confirmation to Telegram: "Kiro wants to: <action>. Reply /yes or /no."
- `/yes` resumes, `/no` sends interrupt.

### Output Filtering

- Strip ANSI escape sequences (`/\x1b\[[0-9;]*m/g` and cursor movement codes).
- Collapse consecutive identical lines into one (e.g. spinner frames).
- Trim trailing whitespace per line.
- Applied before OutputBuffer flush.

### Scheduled Commands

- `/schedule <HH:MM> <message>` stores a job in memory.
- A timer checks every 30s if any scheduled job is due.
- When due, sends the message to kiro stdin (or queues it if kiro is busy).
- `/schedule` with no args lists pending jobs.

### Webhook Mode

- Alternative to polling. Set via `TELEGRAM_MODE=webhook` env var.
- Requires `TELEGRAM_WEBHOOK_URL` and optionally `TELEGRAM_WEBHOOK_PORT` (default 3000).
- On startup, call Telegram `setWebhook` API.
- Spin up a minimal HTTP server to receive updates.
- Same `handleCommand` pipeline — only the ingestion layer changes.
- Fallback to polling if webhook setup fails.

### Undo

- `/undo` writes `"revert the last change you made"` to kiro stdin.
- Kiro handles the actual revert (git checkout, file restore, etc.).
- After kiro responds, forward the result to Telegram as normal.

### Notification Channels

- Messages classified into two priority levels:
  - **Important**: task complete summaries, errors, confirmation prompts, login URLs.
  - **Info**: verbose streaming output, progress updates, queue notifications.
- Important messages sent normally (with notification sound).
- Info messages sent with `disable_notification: true` (silent).
- Controlled via Telegram `sendMessage` API's `disable_notification` parameter.

## Login Flow Detail

```
spawn kiro
  │
  ├─ stdout contains "https://" → extract URL → sendMessage(url)
  │
  ├─ user clicks link, authenticates in browser
  │
  └─ kiro prints success message → forward to Telegram
      session is now active
```

## Error Handling

| Scenario | Action |
|----------|--------|
| kiro not found on PATH | Send error message to Telegram |
| kiro exits unexpectedly | Notify user, set session to null |
| `/start` while session active | Reply "session already running" |
| `/stop` with active session | Kill process |
| Non-command message while no session | Reply "No active session. Send /start to begin." |

## File Structure

```
.kiro/
├── spec.md
├── requirements.md
└── design.md
adapters/
├── cli-model-adapter.ts    (interface)
├── kiro.ts
├── gemini-cli.ts
├── codex-cli.ts
├── local-llm.ts
└── index.ts                (registry)
session/
├── model-session.ts
└── output-buffer.ts
telegram/
└── application/
    └── handle-telegram-command.ts  (simplified command router)
```
