import { WebSocketServer, WebSocket } from "ws";
import type { WsEvent, WsEventType } from "../shared/dto.ts";

let wss: WebSocketServer | null = null;

export function initWss(server: import("http").Server): void {
  wss = new WebSocketServer({ server, path: "/ws" });
  wss.on("connection", (ws) => {
    const event: WsEvent = { type: "connected", payload: { message: "Connected to AgentSchitzo realtime" }, timestamp: new Date().toISOString() };
    ws.send(JSON.stringify(event));
    ws.on("error", () => {});
  });
}

export function emit(type: WsEventType, payload: Record<string, unknown>): void {
  if (!wss) return;
  const event: WsEvent = { type, payload, timestamp: new Date().toISOString() };
  const msg = JSON.stringify(event);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  });
}
