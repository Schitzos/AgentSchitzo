import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useWebSocket } from "../hooks/useWebSocket";
import type { WsEvent } from "../types/dto";

interface GraphBlock {
  id: string;
  sessionId: string;
  type: WsEvent["type"];
  label: string;
  detail: string;
  timestamp: string;
  traceId?: string;
}

const EVENT_LABELS: Partial<Record<WsEvent["type"], string>> = {
  "session.started": "Session Started",
  "session.output": "Output",
  "session.completed": "Completed",
  "trace.updated": "Trace Saved",
  "cost.updated": "Cost Updated",
  "session.updated": "Session Updated",
};

const EVENT_COLORS: Partial<Record<WsEvent["type"], string>> = {
  "session.started": "border-green-500 bg-green-900/20",
  "session.output": "border-blue-500 bg-blue-900/20",
  "session.completed": "border-purple-500 bg-purple-900/20",
  "trace.updated": "border-yellow-500 bg-yellow-900/20",
  "cost.updated": "border-orange-500 bg-orange-900/20",
  "session.updated": "border-slate-500 bg-slate-800",
};

export default function Realtime() {
  const { connected, events, clearEvents } = useWebSocket();
  const [blocks, setBlocks] = useState<GraphBlock[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    const seen = new Set<string>();
    const newBlocks: GraphBlock[] = events
      .filter((e) => e.type !== "connected")
      .map((e) => ({
        id: `${e.type}-${e.timestamp}`,
        sessionId: (e.payload.sessionId as string) ?? "",
        type: e.type,
        label: EVENT_LABELS[e.type] ?? e.type,
        detail: formatDetail(e),
        timestamp: e.timestamp,
        traceId: e.payload.traceId as string | undefined,
      }))
      .filter((b) => {
        if (seen.has(b.id)) return false;
        seen.add(b.id);
        return true;
      });
    setBlocks(newBlocks);
  }, [events]);

  function formatDetail(e: WsEvent): string {
    if (e.type === "session.started") return `${e.payload.provider}/${e.payload.model}`;
    if (e.type === "session.output") return String(e.payload.text ?? "").slice(0, 60) + "...";
    if (e.type === "trace.updated") return `$${Number(e.payload.costUsd ?? 0).toFixed(4)}`;
    if (e.type === "cost.updated") return `$${Number(e.payload.costUsd ?? 0).toFixed(4)}`;
    if (e.type === "session.completed") return String(e.payload.output ?? "").slice(0, 60);
    return "";
  }

  // Group blocks by session
  const bySessions = blocks.reduce<Record<string, GraphBlock[]>>((acc, b) => {
    if (!acc[b.sessionId]) acc[b.sessionId] = [];
    acc[b.sessionId].push(b);
    return acc;
  }, {});

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className={`w-2.5 h-2.5 rounded-full ${connected ? "bg-green-500 animate-pulse" : "bg-red-500"}`} />
          <span className="text-slate-300 text-sm">{connected ? "Live" : "Disconnected"}</span>
          <span className="text-slate-500 text-sm">{blocks.length} events</span>
        </div>
        <button onClick={() => { clearEvents(); setBlocks([]); }}
          className="text-xs text-slate-400 hover:text-white px-3 py-1 rounded bg-slate-800 hover:bg-slate-700 transition-colors">
          Clear
        </button>
      </div>

      {blocks.length === 0 && (
        <div className="text-center text-slate-500 mt-20">
          <div className="text-4xl mb-4">⚡</div>
          <div>Waiting for events...</div>
          <div className="text-xs mt-2">Start a session from Telegram or Chat to see live execution</div>
        </div>
      )}

      {Object.entries(bySessions).map(([sessionId, sessionBlocks]) => (
        <div key={sessionId} className="bg-slate-900 rounded-xl border border-slate-800 p-4">
          <div className="text-xs text-slate-500 mb-3 font-mono">Session: {sessionId.slice(0, 16)}...</div>
          <div className="flex flex-wrap gap-2 items-center">
            {sessionBlocks.map((block, i) => (
              <div key={block.id} className="flex items-center gap-2">
                <button
                  onClick={() => block.sessionId && navigate(`/traces/${block.sessionId}`)}
                  className={`border rounded-lg px-3 py-2 text-left transition-all hover:scale-105 ${EVENT_COLORS[block.type] ?? "border-slate-600 bg-slate-800"} ${block.sessionId ? "cursor-pointer hover:brightness-125" : "cursor-default"}`}
                >
                  <div className="text-xs font-medium text-white">{block.label}</div>
                  {block.detail && <div className="text-xs text-slate-400 mt-0.5 max-w-[150px] truncate">{block.detail}</div>}
                  <div className="text-xs text-slate-600 mt-1">{new Date(block.timestamp).toLocaleTimeString()}</div>
                </button>
                {i < sessionBlocks.length - 1 && <span className="text-slate-600">→</span>}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
