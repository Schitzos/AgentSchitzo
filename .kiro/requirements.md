# Requirements: Kiro Integration

## Functional Requirements

1. `/start` command spawns a `kiro` CLI child process with piped stdio.
2. App captures kiro stdout and detects login URLs (https:// pattern).
3. Detected login URL is sent to the user via Telegram.
4. After authentication, kiro remains running as a persistent session.
5. All subsequent Telegram messages (non-command) are written to kiro's stdin.
6. All kiro stdout/stderr output is forwarded back to Telegram.
7. When kiro finishes processing a task, send a summary of what was done back to Telegram.
7. `/stop` command kills the active kiro process.
8. `/interrupt` command sends an interrupt signal to kiro while it's processing.
9. While kiro is processing, any non-`/interrupt` message receives a reply: "Kiro is processing something. Send /interrupt to cancel."
10. `/model` command replies with current model/session info.
11. Only one kiro session at a time per chat.
12. If kiro process exits unexpectedly, notify the user in Telegram.
13. If no active session exists and user sends a non-command message, reply with a fallback message (e.g. "No active session. Send /start to begin.").
14. `/status` command replies with current kiro state (idle, processing, or not running).
15. `/verbose` toggles output mode between summary-only (default) and full raw streaming.
16. `/history` shows the last N task summaries (stored in memory or logs/).
17. Messages prefixed with `> ` bypass command parsing and are forwarded literally to kiro stdin.
18. If kiro produces no output for a configurable timeout (default 5 minutes), notify the user of a possible hang.
19. If user sends a file or photo, download it to the project directory (e.g. `./uploads/`) and write a message to kiro stdin informing it of the file path.
20. On app restart, check if a previous kiro process is still alive (via stored PID). If so, reattach to it instead of requiring `/start`.
21. `/project <path>` kills the current kiro session and starts a new one in the specified directory.
22. If kiro is processing and user sends a non-command message, queue it and auto-send when kiro becomes idle.
23. If kiro's output contains destructive keywords (delete, drop, force push, rm -rf), send a confirmation prompt to Telegram before allowing kiro to proceed.
24. Strip ANSI escape sequences and collapse repeated/spinner lines from kiro output before sending to Telegram.
25. `/schedule <time> <message>` queues a command to be sent to kiro at the specified time.
26. Support Telegram webhook mode as an alternative to polling for near-instant message delivery.
27. `/undo` sends a revert command to kiro (e.g. `git checkout -- .`) to roll back the last change.
28. Separate message priority levels: "important" (task done, errors, confirmations) sent as normal messages; "info" (progress, verbose output) sent as silent notifications.
29. CLI model is configurable via `MODEL_ADAPTER` env var (default: `kiro`). Supported: `kiro`, `gemini-cli`, `codex-cli`, `local-llm`.
30. `/model <name>` hot-swaps the active adapter at runtime (kills current session, spawns new one with selected adapter).
31. `/model` with no args shows the currently active adapter.
32. Each adapter implements a common interface: spawn, args, login detection, processing detection.

## Non-Functional Requirements

1. Kiro process must not block the Telegram polling loop.
2. Output buffering: aggregate rapid stdout chunks before sending to avoid Telegram rate limits.
3. Telegram message size limit (4096 chars) — split long outputs.
4. Graceful shutdown: kill kiro process when the app stops.
5. Retain existing permission check (TELEGRAM_CHAT_ID only).

## Out of Scope (for now)

- Multiple concurrent kiro sessions.
- Groq/Codex intent classification (removed).
- Code verification pipeline (removed — kiro handles its own workflow).
- Approval flow for risky operations (kiro manages this internally).

## Environment

- `TELEGRAM_TOKEN` — required.
- `TELEGRAM_CHAT_ID` — required.
- `TELEGRAM_POLL_INTERVAL_MS` — optional, default 3000.
- `TELEGRAM_MODE` — optional, `polling` (default) or `webhook`.
- `TELEGRAM_WEBHOOK_URL` — required if mode is webhook.
- `TELEGRAM_WEBHOOK_PORT` — optional, default 3000.
- `MODEL_ADAPTER` — optional, default `kiro`. Options: `kiro`, `gemini-cli`, `codex-cli`, `local-llm`.
- `LOCAL_LLM_COMMAND` — required if adapter is `local-llm`. The CLI command to spawn.
- `LOCAL_LLM_ARGS` — optional, JSON array of args for local LLM command.
- `KIRO_TIMEOUT_MS` — optional, default 300000 (5 minutes). Silence threshold before hang warning.
- CLI for the selected adapter must be installed and available on PATH.
