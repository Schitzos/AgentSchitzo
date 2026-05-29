# Requirements: AgentSchitzo

## Core Functions

### Session
- Each command = unique `session_id` (UUID v4)
- Track: adapter, start/end time, exit code, cwd
- One active session per chat
- Commands: `/start`, `/stop`, `/interrupt`, `/status`

### CLI Adapters
- Configurable via `MODEL_ADAPTER` env (default: `kiro`)
- `/model <name>` hot-swap at runtime
- Interface: `name`, `command`, `buildArgs()`, optional `detectLoginUrl()`
- Supported: `kiro` (primary), `codex-cli`, `gemini-cli`, `local-llm`

### Execution & Capture
- Spawn CLI with piped stdio
- Real-time stdout/stderr capture
- Post-execution: `git diff` capture
- Strip ANSI codes, buffer 500ms debounce

### Langfuse Tracing
- Session start → Langfuse trace w/ `session_id` + metadata
- Each command → span (input, output, duration, exit code)
- File diffs → span metadata
- Stderr → separate event/observation
- Non-blocking (continues if Langfuse unavailable)

### Telegram Integration
- Non-command messages → CLI stdin
- CLI output → Telegram (4096 char limit)
- Login URL detection → immediate send
- Message queue while processing
- Only `TELEGRAM_CHAT_ID` allowed
- `/verbose` toggle, `/history` summaries

### File & Project
- `/project <path>` → kill session, start new in dir
- File/photo uploads → `./uploads/` + notify tool
- `/undo` → revert instruction to CLI

## Non-Functional
- Async I/O (no blocking Telegram poll)
- Fire-and-forget Langfuse calls
- Graceful shutdown (kill child)
- 4096 char message splits
- 5min silence timeout warning
- Structured JSON metadata

## Env Vars
| Var | Required | Default | Description |
|-----|----------|---------|-------------|
| `TELEGRAM_TOKEN` | Yes | — | Bot token |
| `TELEGRAM_CHAT_ID` | Yes | — | Allowed chat |
| `TELEGRAM_POLL_INTERVAL_MS` | No | 3000 | Poll interval |
| `MODEL_ADAPTER` | No | `kiro` | Active adapter |
| `LOCAL_LLM_COMMAND` | If local-llm | — | Command |
| `LOCAL_LLM_ARGS` | No | `[]` | JSON args |
| `KIRO_TIMEOUT_MS` | No | 300000 | Silence threshold |
| `LANGFUSE_PUBLIC_KEY` | No | — | Public key |
| `LANGFUSE_SECRET_KEY` | No | — | Secret key |
| `LANGFUSE_HOST` | No | cloud.langfuse.com | Endpoint |

## Out of Scope
- Multi-session per chat
- Model routing/classification
- Code verification pipeline
- Response quality eval
