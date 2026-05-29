# AgentSchitzo Spec

## Summary
CLI model wrapper w/ observability. Receives commands (Telegram/terminal), spawns configurable CLI AI tool as child process, captures output + file changes, sends structured traces to Langfuse.

Active CLI tool is **pluggable** — focused on `kiro-cli`, but adapter pattern supports any CLI tool (codex, gemini-cli, local LLMs). Switching adapters = no arch changes.

## Architecture
```
Terminal/Telegram command → Create session_id → Langfuse trace → Run CLI tool → Capture stdout/stderr → Capture file diffs → Send to Langfuse
```

## Core Concept
AgentSchitzo = **execution wrapper**, NOT chatbot:
1. Receives task (Telegram/direct)
2. Creates traceable session
3. Delegates to CLI AI tool
4. Observes everything (output, file changes, exit code)
5. Reports structured traces to Langfuse

## Supported Adapters
| Adapter | CLI Command | Status |
|---------|-------------|--------|
| kiro | `kiro` | **Primary** |
| codex-cli | `codex` | Supported |
| gemini-cli | `gemini` | Supported |
| local-llm | configurable | Supported |

## Key Differentiator
Unlike running CLI tools directly, adds:
- **Session tracking** — unique session_id per execution
- **Full observability** — stdout, stderr, file diffs, duration, exit code → Langfuse
- **Telegram bridge** — trigger/monitor from mobile
- **Execution history** — query past runs, costs, outcomes via Langfuse
