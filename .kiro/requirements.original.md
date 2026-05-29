# Requirements: AgentSchitzo

## Functional Requirements

### Session Management

1. Each command execution creates a unique `session_id` (UUID v4).
2. Session tracks: adapter used, start time, end time, exit code, working directory.
3. Only one active session per chat at a time.
4. `/start` spawns the configured CLI tool as a child process.
5. `/stop` kills the active session.
6. `/interrupt` sends SIGINT to the running process.
7. `/status` shows current session state (idle, processing, not running).

### CLI Adapter System

8. Active adapter is configurable via `MODEL_ADAPTER` env var (default: `kiro`).
9. `/model <name>` hot-swaps the adapter at runtime.
10. Each adapter implements: `name`, `command`, `buildArgs()`, optional `detectLoginUrl()`.
11. Supported adapters: `kiro` (primary), `codex-cli`, `gemini-cli`, `local-llm`.
12. Adding a new adapter requires only implementing the `CliModelAdapter` interface.

### Execution & Capture

13. CLI tool is spawned with piped stdio (`stdin`, `stdout`, `stderr`).
14. All stdout/stderr output is captured in real-time.
15. After execution completes, capture file diffs via `git diff`.
16. Strip ANSI escape codes from captured output before storing.
17. Buffer rapid output chunks (500ms debounce) before forwarding.

### Langfuse Tracing

18. On session start, create a Langfuse trace with `session_id` and metadata.
19. Each command execution creates a Langfuse span under the session trace.
20. Span captures: input (user command), output (stdout), duration, exit code.
21. File diffs are attached as span metadata.
22. Stderr is captured as a separate event/observation on the span.
23. Traces are grouped by `session_id` for multi-turn conversations.
24. If Langfuse is unavailable, execution continues (tracing is non-blocking).

### Telegram Integration

25. Telegram messages (non-command) are forwarded to the CLI tool's stdin.
26. CLI tool output is forwarded back to Telegram (respecting 4096 char limit).
27. Login URLs detected in output are sent immediately to Telegram.
28. Messages sent while tool is processing are queued and auto-sent when idle.
29. Only the configured `TELEGRAM_CHAT_ID` can interact with the bot.
30. `/verbose` toggles between summary-only and full streaming output.
31. `/history` shows last N session summaries.

### File & Project Management

32. `/project <path>` kills current session, starts new one in specified directory.
33. File/photo uploads are saved to `./uploads/` and the tool is notified.
34. `/undo` sends a revert instruction to the CLI tool.

## Non-Functional Requirements

1. CLI tool process must not block the Telegram polling loop (async I/O).
2. Langfuse calls are fire-and-forget — never block execution.
3. Graceful shutdown: kill child process when app stops.
4. Output split at 4096 chars for Telegram message limit.
5. Silence timeout (default 5min) warns user if tool appears stuck.
6. Retain permission check (`TELEGRAM_CHAT_ID` allowlist).
7. All tracing metadata is structured (JSON-serializable).

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `TELEGRAM_TOKEN` | Yes | — | Telegram bot token |
| `TELEGRAM_CHAT_ID` | Yes | — | Allowed chat ID |
| `TELEGRAM_POLL_INTERVAL_MS` | No | 3000 | Polling interval |
| `MODEL_ADAPTER` | No | `kiro` | Active CLI adapter |
| `LOCAL_LLM_COMMAND` | If adapter=local-llm | — | Command to spawn |
| `LOCAL_LLM_ARGS` | No | `[]` | JSON array of args |
| `KIRO_TIMEOUT_MS` | No | 300000 | Silence threshold |
| `LANGFUSE_PUBLIC_KEY` | No | — | Langfuse public key |
| `LANGFUSE_SECRET_KEY` | No | — | Langfuse secret key |
| `LANGFUSE_HOST` | No | `https://cloud.langfuse.com` | Langfuse endpoint |

## Out of Scope

- Multiple concurrent sessions per chat.
- Model routing/classification (that's Neural Router's job).
- Code verification pipeline (CLI tool handles its own workflow).
- Response quality evaluation.
