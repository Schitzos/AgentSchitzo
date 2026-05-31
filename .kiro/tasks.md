# Tasks — AgentSchitzo

## Phase 1: Backend Foundation
- [ ] HTTP API server for browser app
- [ ] Realtime transport (WebSocket/SSE)
- [ ] Shared DTOs for browser/backend
- [ ] Telegram stays working against shared core

## Phase 2: Browser App Setup
- [ ] Scaffold React + Vite + TypeScript
- [ ] Router: Chat, Dashboard, Trace, Realtime
- [ ] PWA support + install metadata
- [ ] App shell layout/navigation

## Phase 3: Chat Menu
- [ ] Browser chat page + prompt submission
- [ ] Prompt/response history display
- [ ] Provider + model selector
- [ ] Active session state in browser

## Phase 4: Dashboard Menu
- [ ] Cost summary card (total + provider/model breakdown)
- [ ] Usage timeline chart
- [ ] Top 5 models list
- [ ] Model latency chart
- [ ] Backed by Langfuse API data

## Phase 5: Trace Menu
- [ ] Session list (active/inactive, id/time/provider/model/cost/duration/tokens)
- [ ] Date-range filter
- [ ] Session detail: prompt history first→latest
- [ ] Link to realtime for active sessions

## Phase 6: Realtime Menu
- [ ] Live graph UI (pipeline viz)
- [ ] Stream realtime events from backend
- [ ] Append blocks as execution grows
- [ ] Clickable blocks → trace detail
- [ ] Provider/model/cost per block

## Phase 7: Integration
- [ ] Browser + Telegram share same session
- [ ] Provider/model switching from both surfaces
- [ ] Langfuse-backed APIs for traces + dashboard
- [ ] Realtime events correlate with stored traces

## Phase 8: MVP Hardening
- [ ] Responsive layout polish
- [ ] PWA install verification
- [ ] Error handling for disconnected realtime
- [ ] Graceful when Langfuse unavailable
- [ ] E2E validation: browser chat, trace, dashboard, realtime, Telegram
