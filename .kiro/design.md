# Design: AgentSchitzo

## Architecture

```
Browser (PWA) ──HTTP/WS──┐
                          ▼
Telegram ◄──► AgentSchitzo Backend ◄──stdio──► CLI Providers
                          │
                          ▼
                       Langfuse
```

## Stack

- **Frontend**: React + Vite + TypeScript + PWA + WebSocket + charting
- **Backend**: Node.js + TypeScript + HTTP API + WebSocket/SSE
- **Core**: existing provider/session/tracing modules as services

## Browser Menus

- **Chat**: prompt submission, response history, provider/model selector, active session state
- **Dashboard**: cost summary, provider/model breakdown, usage timeline, top 5 models, latency chart
- **Trace**: session list (active/inactive), metadata table, prompt history, date filter, link to realtime
- **Realtime**: live graph, append blocks per execution step, clickable → trace, shows provider/model/cost

## API Endpoints

```
GET  /api/dashboard/summary|usage-timeline|top-models|latencies
GET  /api/sessions|sessions/:id
GET  /api/traces|traces/:id
POST /api/chat/send
POST /api/provider/select|model/select|session/interrupt
```

## Realtime Events

`session.started`, `session.updated`, `session.output`, `session.completed`, `trace.updated`, `cost.updated`

## Module Structure

```
web/          # React PWA
server/       # HTTP + WS backend
adapters/     # CLI providers
session/      # session lifecycle
telegram/     # Telegram listener
tracing/      # Langfuse integration
scheduler/    # deferred jobs
shared/       # DTOs/types
```

## Flow

```
Browser/Telegram prompt → session manager → provider exec → stream output + emit realtime events + persist to Langfuse
```

## PWA

Manifest + icons + standalone display + installable + offline shell.
