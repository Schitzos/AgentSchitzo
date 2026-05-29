# AgentSchitzo Spec

CLI model wrapper + observability. Telegram & browser → spawn CLI AI tool → capture output/diffs → trace to Langfuse.

## Architecture

```
Command (Telegram/Browser) → session_id → Langfuse trace → CLI tool (kiro/codex/gemini/local) → capture stdout/stderr → git diff → Langfuse
```

## Core

Execution wrapper, not chatbot. Receives task → traceable session → delegates to CLI tool → observes everything → reports to Langfuse.

## Adapters

| Adapter | Command | Status |
|---------|---------|--------|
| kiro | `kiro-cli` | Primary |
| codex-cli | `codex` | Supported |
| gemini-cli | `gemini` | Supported |
| local-llm | configurable | Supported |

## Differentiators

- Session tracking (UUID per execution)
- Full observability (stdout, stderr, diffs, duration, exit code → Langfuse)
- Telegram + Browser bridge
- Execution history via Langfuse
- Credit-based cost tracking
