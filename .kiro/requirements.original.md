# Requirements: AgentSchitzo

## Product Direction

AgentSchitzo must support two operator surfaces:

- Telegram bot
- Browser app

The browser app is not just an analytics view. It is also an execution surface that lets the user chat with providers, inspect traces, and monitor usage. The browser app must be installable as a PWA.

## Functional Requirements

### Session Management

1. Each command execution creates a unique `session_id` (UUID v4).
2. Session tracks: provider, model, start time, end time, exit code, working directory.
3. Session also tracks whether it is active or inactive.
4. Browser and Telegram must share the same execution/session layer.
5. `/start`, `/stop`, `/interrupt`, `/status` remain available in Telegram.
6. Browser chat prompts also create and extend sessions.

### Provider and Model System

7. Active provider is configurable via `MODEL_ADAPTER`.
8. Supported providers: `kiro`, `codex-cli`, `gemini-cli`, `local-llm`.
9. Provider can be switched at runtime from Telegram and browser UI.
10. Model selection is provider-aware.
11. Pricing calculation is provider-aware and model-aware.

### Execution and Capture

12. CLI tools are spawned with piped stdio.
13. Stdout and stderr are captured in real time.
14. File diffs are captured after execution via `git diff`.
15. Prompt history is preserved inside each session from first prompt to latest prompt.
16. Duration, cost, token usage when available, provider, and model are associated with the trace/session.

### Telegram Integration

17. Existing Telegram interaction remains supported.
18. Telegram non-command messages are forwarded to the active provider session.
19. Telegram output forwarding remains supported.
20. Telegram provider/model/project/history/schedule commands remain supported.

### Browser App

21. Browser app must be built with React + Vite.
22. Browser app must be installable as a PWA.
23. Browser app must support desktop-first layout and remain usable on mobile.

### Browser Menu: Chat

24. A Chat menu must exist in the browser app.
25. Chat is a browser bridge into AgentSchitzo execution, similar in feel to Codex / Claude Code / Gemini.
26. User can send prompts from browser chat.
27. User can view prompt/response history for the current session.
28. User can choose provider and model from the browser app.

### Browser Menu: Dashboard

29. Dashboard must show a summary card with:
   - total cost
   - provider breakdown
   - model breakdown
30. Dashboard must show session usage timeline using Langfuse traces.
31. Dashboard must show top 5 most-used models.
32. Dashboard must show model latency chart.

### Browser Menu: Trace

33. Trace view must show list of sessions with active/inactive status.
34. Trace/session details must show prompt history from first prompt to latest prompt.
35. Session/trace list columns must include:
   - session id
   - time
   - provider
   - model
   - cost
   - duration
   - token usage if available
36. Trace view must include date-range filtering.
37. If a session is active, user can open the realtime screen from that session entry.

### Browser Menu: Realtime

38. Realtime view must show a live graph similar to GitHub/GitLab pipeline visualization.
39. Graph grows as prompts/execution steps happen.
40. Clicking a graph block opens the related trace/session.
41. Each block shows provider, model, and cost.
42. Realtime transport may use WebSocket.

### API and Backend

43. Backend must expose HTTP API for browser app data and actions.
44. Backend must expose realtime event stream for active sessions.
45. Backend must provide endpoints for:
   - dashboard metrics
   - trace list
   - session list
   - session detail
   - browser chat prompt submission
   - provider/model changes

## Non-Functional Requirements

1. Browser app must remain responsive while executions run.
2. Realtime updates should be near-live.
3. Langfuse failures must not block execution.
4. Browser app should support standalone install mode as a PWA.
5. Structured JSON responses are required for frontend consumption.

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

- Multi-user auth
- Multi-workspace tenancy
- Full Langfuse replacement
- Exact billing parity for every provider if the provider CLI does not expose exact usage
