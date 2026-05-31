import { useEffect, useRef, useState, useCallback } from "react";
import type { WsEvent } from "../types/dto";

export function useWebSocket() {
  const [connected, setConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState<WsEvent | null>(null);
  const ws = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmounted = useRef(false);

  const connect = useCallback(() => {
    if (unmounted.current) return;
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const socket = new WebSocket(`${proto}://${location.host}/ws`);
    ws.current = socket;

    socket.onopen = () => { if (!unmounted.current) setConnected(true); };
    socket.onclose = () => {
      if (unmounted.current) return;
      setConnected(false);
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      reconnectTimer.current = setTimeout(connect, 3000);
    };
    socket.onerror = () => socket.close();
    socket.onmessage = (e) => {
      if (unmounted.current) return;
      try {
        const event: WsEvent = JSON.parse(e.data);
        setLastEvent(event);
      } catch {}
    };
  }, []);

  useEffect(() => {
    unmounted.current = false;
    connect();
    return () => {
      unmounted.current = true;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      ws.current?.close();
    };
  }, [connect]);

  return { connected, lastEvent };
}

// Separate hook for pages that need event history (Realtime page)
export function useWebSocketEvents() {
  const { connected, lastEvent } = useWebSocket();
  const [events, setEvents] = useState<WsEvent[]>([]);

  useEffect(() => {
    if (!lastEvent) return;
    setEvents((prev) => [lastEvent, ...prev].slice(0, 200));
  }, [lastEvent]);

  const clearEvents = useCallback(() => setEvents([]), []);
  return { connected, lastEvent, events, clearEvents };
}
