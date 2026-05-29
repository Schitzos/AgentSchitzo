# Design: AgentSchitzo

## Architecture

```
                 ┌──────────────────────────────┐
                 │      Browser App (PWA)       │
                 │  React + Vite + WebSocket    │
                 └──────────────┬───────────────┘
                                │ HTTP / WS
                                ▼
┌──────────────┐       ┌──────────────────────────────┐       ┌─────────────┐
│  Telegram    │◄─────►│      AgentSchitzo Backend    │◄─────►│  CLI Tool   │
│    Bot       │       │ API + Session + Realtime     │ stdio │ Providers   │
└──────────────┘       └──────────────┬───────────────┘       └─────────────┘
                                      │
                                      ▼
                               ┌──────────────┐
                               │   Langfuse   │
                               │ traces/data  │
                               └──────────────┘
```

## System Shape

The product becomes a local full-stack app with:

- browser client
- Telegram client
- Node.js backend/API
- provider execution core
- Langfuse-backed trace data

Telegram and browser are parallel control surfaces over the same execution engine.

## Frontend Stack

- React
- Vite
- TypeScript
- PWA support
- router for menu navigation
- charting library for dashboard/realtime
- WebSocket client for realtime graph updates

## Backend Stack

- Node.js
- TypeScript
- HTTP server for browser APIs
- WebSocket or SSE for realtime events
- existing provider/session/tracing modules reused as core services

## Browser App Menus

### Chat

Browser chat is a first-class execution surface.

Responsibilities:

- send prompts into AgentSchitzo
- display prompt/response history
- select provider and model
- continue active session across prompts

### Dashboard

Responsibilities:

- total cost summary
- provider/model breakdown
- session usage timeline
- top 5 model usage
- model latency chart

### Trace

Responsibilities:

- list sessions
- show active/inactive state
- show trace/session metadata
- show prompt history
- filter by date range
- open realtime view for active sessions

### Realtime

Responsibilities:

- render live execution graph
- append blocks as execution progresses
- link blocks to traces
- surface provider/model/cost per block

## Backend Responsibilities

### Execution Core

- manage active session
- spawn CLI providers
- track provider/model selection
- bridge Telegram/browser prompts into same execution path

### API Layer

Suggested endpoints:

- `GET /api/dashboard/summary`
- `GET /api/dashboard/usage-timeline`
- `GET /api/dashboard/top-models`
- `GET /api/dashboard/latencies`
- `GET /api/sessions`
- `GET /api/sessions/:id`
- `GET /api/traces`
- `GET /api/traces/:id`
- `POST /api/chat/send`
- `POST /api/provider/select`
- `POST /api/model/select`
- `POST /api/session/interrupt`

### Realtime Layer

Suggested events:

- `session.started`
- `session.updated`
- `session.output`
- `session.completed`
- `trace.updated`
- `cost.updated`

## Data Sources

### Live State

- in-process session manager
- provider execution events

### Historical State

- Langfuse traces
- Langfuse cost/latency/session metadata

## Module Direction

Suggested structure:

```
web/                     # React + Vite PWA
server/                  # HTTP + WebSocket backend
adapters/                # CLI providers
session/                 # session lifecycle
telegram/                # Telegram listener/router
tracing/                 # Langfuse integration
scheduler/               # deferred jobs
shared/                  # shared DTOs/types
```

## Realtime Flow

```
Browser chat prompt / Telegram prompt
    │
    ▼
Session manager receives prompt
    │
    ▼
Provider execution starts
    │
    ├── stream output to Telegram/browser
    ├── emit realtime execution events
    ├── append graph nodes/edges
    └── persist trace data to Langfuse
```

## PWA Requirements

- manifest
- icons
- standalone display mode
- installable browser shell
- offline shell for UI chrome

## MVP Notes

- Browser app is local-first and installable
- Telegram stays operational
- Langfuse remains the observability source
- Exact billing may remain estimated where provider CLIs do not expose exact token accounting
