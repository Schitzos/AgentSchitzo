import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import type { SessionDTO, TraceDTO } from "../types/dto";

export default function Traces() {
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<SessionDTO[]>([]);
  const [selected, setSelected] = useState<(SessionDTO & { traces: TraceDTO[] }) | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  useEffect(() => {
    api.sessions.list().then(setSessions).catch(() => {});
  }, []);

  useEffect(() => {
    if (id) {
      api.sessions.get(id).then(setSelected).catch(() => {});
    } else {
      setSelected(null);
    }
  }, [id]);

  const filtered = sessions.filter((s) => {
    if (from && s.startedAt < from) return false;
    if (to && s.startedAt > to + "T23:59:59") return false;
    return true;
  });

  return (
    <div className="flex h-[calc(100vh-49px)]">
      {/* Session list */}
      <div className="w-80 border-r border-slate-800 flex flex-col">
        <div className="p-3 border-b border-slate-800 space-y-2">
          <div className="text-xs text-slate-400 font-medium">DATE FILTER</div>
          <div className="flex gap-2">
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
              className="flex-1 bg-slate-800 text-slate-300 text-xs rounded px-2 py-1 outline-none" />
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
              className="flex-1 bg-slate-800 text-slate-300 text-xs rounded px-2 py-1 outline-none" />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 && <div className="p-4 text-slate-500 text-sm">No sessions</div>}
          {filtered.map((s) => (
            <button key={s.id} onClick={() => navigate(`/traces/${s.id}`)}
              className={`w-full text-left p-3 border-b border-slate-800 hover:bg-slate-800 transition-colors ${id === s.id ? "bg-slate-800" : ""}`}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-mono text-slate-400">{s.id.slice(0, 8)}...</span>
                <span className={`text-xs px-1.5 py-0.5 rounded ${s.active ? "bg-green-900 text-green-300" : "bg-slate-700 text-slate-400"}`}>
                  {s.active ? "active" : "done"}
                </span>
              </div>
              <div className="text-xs text-slate-300">{s.provider} / {s.model}</div>
              <div className="text-xs text-slate-500 mt-1">{new Date(s.startedAt).toLocaleString()}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Session detail */}
      <div className="flex-1 overflow-y-auto p-6">
        {!selected && (
          <div className="text-center text-slate-500 mt-20">Select a session to view its trace</div>
        )}
        {selected && (
          <div className="max-w-3xl mx-auto space-y-4">
            <div className="bg-slate-900 rounded-xl p-4 border border-slate-800">
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
                <div><div className="text-slate-500 text-xs">Provider</div><div className="text-white">{selected.provider}</div></div>
                <div><div className="text-slate-500 text-xs">Model</div><div className="text-white">{selected.model}</div></div>
                <div><div className="text-slate-500 text-xs">Started</div><div className="text-white">{new Date(selected.startedAt).toLocaleString()}</div></div>
                <div><div className="text-slate-500 text-xs">Status</div>
                  <div className={selected.active ? "text-green-400" : "text-slate-400"}>{selected.active ? "Active" : "Ended"}</div>
                </div>
                <div><div className="text-slate-500 text-xs">Total Cost</div>
                  <div className="text-yellow-400 font-medium">${selected.traces.reduce((sum, t) => sum + t.costUsd, 0).toFixed(4)}</div>
                </div>
              </div>
            </div>

            <div className="text-slate-400 text-sm font-medium">{selected.traces.length} prompts</div>

            {selected.traces.map((t, i) => (
              <div key={t.id} className="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden">
                <div className="px-4 py-2 bg-slate-800 flex items-center justify-between text-xs text-slate-400">
                  <span>#{i + 1} · {new Date(t.timestamp).toLocaleTimeString()}</span>
                  <span>{t.model} · ${t.costUsd.toFixed(4)} · {(t.durationMs / 1000).toFixed(1)}s</span>
                </div>
                <div className="p-4 space-y-3">
                  <div>
                    <div className="text-xs text-blue-400 mb-1">INPUT</div>
                    <div className="text-sm text-slate-300 whitespace-pre-wrap bg-slate-800 rounded p-3">{t.input}</div>
                  </div>
                  <div>
                    <div className="text-xs text-green-400 mb-1">OUTPUT</div>
                    <div className="text-sm text-slate-300 whitespace-pre-wrap bg-slate-800 rounded p-3">{t.output}</div>
                  </div>
                  {t.diffs && (
                    <div>
                      <div className="text-xs text-yellow-400 mb-1">DIFFS</div>
                      <pre className="text-xs text-slate-400 bg-slate-800 rounded p-3 overflow-x-auto">{t.diffs.slice(0, 2000)}</pre>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
