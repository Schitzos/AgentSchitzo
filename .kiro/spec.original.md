# AgentSchitzo Spec

## Summary

AgentSchitzo is a CLI model wrapper with observability. It receives commands (via Telegram or terminal), spawns a configurable CLI AI tool as a child process, captures all output and file changes, and sends structured traces to Langfuse for observability.

The active CLI tool is **pluggable** — currently focused on `kiro-cli`, but the adapter pattern supports any CLI tool (codex, gemini-cli, local LLMs). Switching adapters requires no architectural changes.

## Architecture

```
Terminal/Telegram command received
    ↓
Create session_id
    ↓
Wrapper starts Langfuse trace
    ↓
Run CLI tool (kiro / codex / gemini-cli / local-llm)
    ↓
Capture stdout/stderr
    ↓
Capture file diffs (git diff)
    ↓
Send events to Langfuse
```

## Core Concept

AgentSchitzo is NOT a chatbot. It is an **execution wrapper** that:

1. Receives a task (from Telegram or direct invocation)
2. Creates a traceable session
3. Delegates execution to a CLI AI tool
4. Observes everything the tool does (output, file changes, exit code)
5. Reports structured traces to Langfuse for analysis

## Supported Adapters

| Adapter | CLI Command | Status |
|---------|-------------|--------|
| kiro | `kiro` | **Primary** — current focus |
| codex-cli | `codex` | Supported |
| gemini-cli | `gemini` | Supported |
| local-llm | configurable | Supported |

## Key Differentiator

Unlike running CLI tools directly, AgentSchitzo adds:

- **Session tracking** — every execution gets a unique session_id
- **Full observability** — stdout, stderr, file diffs, duration, exit code traced to Langfuse
- **Telegram bridge** — trigger and monitor executions from mobile
- **Execution history** — query past runs, costs, and outcomes via Langfuse
