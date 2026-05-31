# Tasks — AgentSchitzo

## Phase 1: Backend Foundation

- [ ] Keep existing provider/session/tracing core as backend foundation
- [ ] Introduce HTTP API server for browser app
- [ ] Introduce realtime transport (WebSocket or SSE)
- [ ] Define shared DTOs for browser/backend communication
- [ ] Keep Telegram integration working against shared execution core

## Phase 2: Browser App Setup

- [ ] Scaffold React + Vite app
- [ ] Add TypeScript frontend setup
- [ ] Add router for `Chat`, `Dashboard`, `Trace`, `Realtime`
- [ ] Add PWA support and install metadata
- [ ] Add app shell layout/navigation

## Phase 3: Chat Menu

- [ ] Build browser chat page
- [ ] Submit prompts from browser to backend
- [ ] Display prompt/response history
- [ ] Add provider selector
- [ ] Add model selector
- [ ] Show active session state in browser

## Phase 4: Dashboard Menu

- [ ] Build total cost summary card
- [ ] Add provider/model breakdown in summary
- [ ] Add per-session usage timeline chart
- [ ] Add top 5 model usage list
- [ ] Add model latency chart
- [ ] Back dashboard with Langfuse-derived API data

## Phase 5: Trace Menu

- [ ] Build session list view
- [ ] Show active/inactive session status
- [ ] Add session/trace table columns:
  - session id
  - time
  - provider
  - model
  - cost
  - duration
  - token usage
- [ ] Add date-range filter
- [ ] Build session/trace detail page
- [ ] Show prompt history from first prompt to latest prompt
- [ ] Add link/button to realtime view for active sessions

## Phase 6: Realtime Menu

- [ ] Build live graph UI
- [ ] Stream realtime session updates from backend
- [ ] Append graph blocks as execution grows
- [ ] Make graph blocks clickable to open trace detail
- [ ] Show provider/model/cost per block

## Phase 7: Integration

- [ ] Make browser and Telegram share same active session model
- [ ] Ensure provider/model switching works from browser and Telegram
- [ ] Expose Langfuse-backed APIs for traces and dashboard metrics
- [ ] Verify realtime events correlate with stored traces

## Phase 8: MVP Hardening

- [ ] Responsive layout polish
- [ ] PWA install verification
- [ ] Error handling for disconnected realtime stream
- [ ] Graceful behavior when Langfuse is unavailable
- [ ] Basic end-to-end validation: browser chat, trace list, dashboard, realtime, Telegram
