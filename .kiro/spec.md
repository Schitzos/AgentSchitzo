# Kiro Integration Spec

## Summary

Replace the Groq + Codex pipeline with a Telegram ↔ CLI model proxy. The app spawns a configurable CLI model (kiro, gemini-cli, codex-cli, or local LLM) as a child process on demand and bridges Telegram messages bidirectionally with its stdin/stdout.

## Supported Adapters

| Adapter | CLI Command | Notes |
|---------|-------------|-------|
| kiro | `kiro` | Default. Requires login on first use. |
| gemini-cli | `gemini` | Google Gemini CLI |
| codex-cli | `codex` | OpenAI Codex CLI |
| local-llm | configurable | e.g. ollama, llama.cpp, any CLI that reads stdin |

## Flow

```
/start → spawn `kiro` as child process (piped stdio)
       → read stdout line by line
       → detect login URL → send to Telegram
       → after auth succeeds, kiro stays running
       → future Telegram messages get piped to kiro's stdin
       → kiro's stdout gets sent back to Telegram
```

## User Interaction

1. User sends `/start` in Telegram.
2. App spawns `kiro` CLI as a child process.
3. Kiro outputs a login URL during first-time auth.
4. App detects the URL and sends it to the user in Telegram.
5. User opens the link on their phone and authenticates.
6. Kiro session is now active.
7. Any subsequent Telegram message is forwarded to kiro's stdin.
8. Kiro processes the task.
9. When kiro finishes processing, app sends a task summary back to Telegram.
10. Any kiro stdout output is forwarded back to Telegram.

## Commands

| Command | Action |
|---------|--------|
| `/start` | Spawn kiro process, send login URL if needed |
| `/stop` | Kill the running kiro process |
| `/interrupt` | Interrupt kiro while it's processing |
| `/status` | Show if kiro is idle, processing, or not running |
| `/model` | Show current model; `/model <name>` to switch adapter |
| `/verbose` | Toggle between summary-only and full raw output mode |
| `/history` | Show last N task summaries |
| `/retry` | Re-send the last message to kiro |
| `/cwd <path>` | Change kiro's working directory |
| `/project <path>` | Kill current session, start new kiro in a different directory |
| `/schedule <time> <msg>` | Queue a command for kiro at a specific time |
| `/undo` | Tell kiro to revert its last change |
| `/help` | List all available commands |
| `> ...` | Escape prefix — forward literally to kiro (bypass command parsing) |
| (any text) | Forward to kiro stdin (queued if kiro is busy) |
| (file/photo) | Save to project directory, notify kiro about the upload |
