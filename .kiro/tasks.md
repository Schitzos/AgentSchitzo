# Tasks — Kiro Integration

## Phase 0: Cleanup & Spike

- [x] Archive old Groq/Codex/verifier code to `archive/`
- [x] Remove stale temp files (`codex-write-check.tmp`, `sandbox-write-test.txt`)
- [ ] Spike: confirm `kiro` works headlessly via piped stdio (see `scripts/spike-kiro.sh`)
- [ ] Document findings (latency, auth flow, output format)

## Phase 1: Core Session

- [ ] Create `adapters/cli-model-adapter.ts` interface
- [ ] Implement `adapters/kiro.ts` adapter
- [ ] Implement `session/model-session.ts` (spawn, write, interrupt, kill, events)
- [ ] Implement `session/output-buffer.ts` (debounced flush, ANSI strip)
- [ ] Unit tests for session and buffer
- [ ] Manual end-to-end test: spawn kiro, send prompt, receive output

## Phase 2: Telegram Integration

- [ ] Rewrite `telegram/application/handle-telegram-command.ts` as command router
- [ ] Wire model-session into Telegram polling loop
- [ ] Implement `/start`, `/stop`, `/interrupt`, `/status`
- [ ] Implement output forwarding (summary mode + verbose toggle)
- [ ] Implement message queue (hold messages while kiro is processing)
- [ ] Login URL detection and forwarding
- [ ] Split long messages at 4096 char boundary
- [ ] Integration test: Telegram → kiro → Telegram round-trip

## Phase 3: Advanced Features

- [ ] `/project <path>` — switch working directory
- [ ] `/history` — in-memory task summaries
- [ ] `/schedule <time> <msg>` — deferred commands
- [ ] `/undo` — revert last change
- [ ] Destructive-action confirmation (keyword scan + pause)
- [ ] File/photo upload → save to `./uploads/` → notify kiro
- [ ] Webhook mode (`TELEGRAM_MODE=webhook`)
- [ ] Notification priority levels (silent for info, audible for important)
- [ ] Session auto-resume on restart (PID file check)
- [ ] Additional adapters: `gemini-cli`, `codex-cli`, `local-llm`
- [ ] `/model <name>` hot-swap
