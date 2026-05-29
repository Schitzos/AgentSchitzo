# Tasks — AgentSchitzo

## Phase 1: Core Session (done)
- [x] `adapters/cli-model-adapter.ts` interface
- [x] `adapters/kiro.ts` adapter
- [x] `adapters/codex-cli.ts`, `gemini-cli.ts`, `local-llm.ts`
- [x] `session/model-session.ts` (spawn, write, interrupt, kill, events)
- [x] `session/output-buffer.ts` (debounced flush, ANSI strip)
- [x] Unit tests for session and buffer

## Phase 2: Telegram Integration (done)
- [x] Rewrite `handle-telegram-command.ts` as command router
- [x] Wire model-session into Telegram polling loop
- [x] `/start`, `/stop`, `/interrupt`, `/status`
- [x] Output forwarding (summary + verbose toggle)
- [x] Message queue
- [x] Login URL detection and forwarding
- [x] Split long messages at 4096 char boundary

## Phase 3: Langfuse Tracing (NEW)
- [ ] Install `langfuse` SDK
- [ ] `tracing/langfuse-client.ts` — thin wrapper (init, startTrace, startSpan, endSpan, flush)
- [ ] `tracing/trace-session.ts` — orchestrates trace lifecycle per execution
- [ ] Add `git diff` capture after CLI tool exits
- [ ] Wire `TraceSession` into `handle-telegram-command.ts` flow
- [ ] Add `LANGFUSE_*` env vars to `utils/env.ts`
- [ ] Graceful degradation: tracing fails silently if Langfuse unavailable
- [ ] Test: verify traces appear in Langfuse dashboard
- [ ] Add stderr capture as separate metadata on span

## Phase 4: Advanced Features
- [ ] `/project <path>` — switch working directory
- [ ] `/history` — in-memory task summaries
- [ ] `/schedule <time> <msg>` — deferred commands
- [ ] `/undo` — revert last change
- [ ] Destructive-action confirmation (keyword scan + pause)
- [ ] File/photo upload → save to `./uploads/` → notify tool
- [ ] Webhook mode (`TELEGRAM_MODE=webhook`)
- [ ] Notification priority levels (silent for info, audible for important)
- [ ] Session auto-resume on restart (PID file check)
- [ ] `/model <name>` hot-swap
