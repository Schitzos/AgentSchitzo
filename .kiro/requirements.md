# Requirements: AgentSchitzo

## Surfaces

Telegram bot + Browser app (PWA). Both share same execution/session layer.

## Session

- UUID per execution. Tracks: provider, model, time, exit code, cwd.
- Active/inactive state. Shared across Telegram & browser.

## Provider/Model

- Providers: kiro, codex-cli, gemini-cli, local-llm. Runtime switchable.
- Model selection per provider. Credit-based cost tracking.

## Execution

- Piped stdio. Realtime stdout/stderr capture. Git diff after exit.
- Prompt history preserved per session. Duration/cost/tokens on trace.

## Telegram

- `/start`, `/stop`, `/interrupt`, `/status`, `/model`, `/provider`, `/project`, `/history`, `/schedule`, `/help`
- Non-command → forward to provider. Output → Telegram.

## Browser App (PWA)

- React + Vite. Desktop-first, mobile-usable. Installable PWA.
- **Chat**: send prompts, view history, select provider/model.
- **Dashboard**: total cost, provider/model breakdown, usage timeline, top models, latency chart.
- **Trace**: session list (active/inactive), prompt history, date filter, columns: id/time/provider/model/cost/duration/tokens.
- **Realtime**: live execution graph (pipeline viz), clickable blocks → trace detail, provider/model/cost per block. WebSocket transport.

## API

- HTTP endpoints: dashboard metrics, traces, sessions, chat submit, provider/model select.
- Realtime events: session.started/updated/output/completed, trace.updated, cost.updated.

## NFR

- Browser responsive during execution. Near-live realtime. Langfuse failures non-blocking. PWA installable. JSON responses.

## Env Vars

`TELEGRAM_TOKEN`, `TELEGRAM_CHAT_ID`, `TELEGRAM_POLL_INTERVAL_MS`, `MODEL_ADAPTER`, `LOCAL_LLM_COMMAND`, `LOCAL_LLM_ARGS`, `KIRO_TIMEOUT_MS`, `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_HOST`

## Out of Scope

Multi-user auth. Multi-workspace. Full Langfuse replacement. Exact billing if provider CLI doesn't expose usage.
