import { useState, useEffect, useRef, useCallback } from "react";
import { api } from "../lib/api";
import { useWebSocket } from "../hooks/useWebSocket";
import { useAppContext } from "../App";
import type { TraceDTO, SessionDTO } from "../types/dto";

interface PendingMessage { id: string; input: string; replyTo?: string }

const QUICK_COMMANDS = ["/status", "/interrupt", "/verbose", "/model", "/history", "/undo", "/help"];

function cleanOutput(text: string): string {
  let out = text.replace(/\x1B\[[0-9;]*[A-Za-z]/g, "");
  out = out.replace(/^.*Reading additional input from stdin.*$/gm, "");
  out = out.replace(/^.*OpenAI Codex v[\d.]+.*$/gm, "");
  out = out.replace(/^-{3,}$/gm, "");
  out = out.replace(/^(?:workdir|model|provider|approval|sandbox|reasoning effort|reasoning summaries|session id):.*$/gm, "");
  out = out.replace(/^(?:user|exec)$/gm, "");
  out = out.replace(/^(?:tokens used|warning:).*$/gm, "");
  out = out.replace(/^\d+[\d.]*$/gm, "");
  const codexMatch = out.match(/^codex\n([\s\S]*?)(?:tokens used|$)/m);
  if (codexMatch) return codexMatch[1].trim();
  out = out.replace(/tokens used[\s\S]*$/m, "").trim();
  return out.replace(/\n{3,}/g, "\n\n").trim();
}

export default function Chat() {
  const [prompt, setPrompt] = useState("");
  const [history, setHistory] = useState<TraceDTO[]>([]);
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const [sessions, setSessions] = useState<SessionDTO[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const [replyTo, setReplyTo] = useState<TraceDTO | null>(null);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [cwd, setCwd] = useState("");
  const { connected, lastEvent } = useWebSocket();
  const { verboseLogs, addLog, clearLogs } = useAppContext();
  const bottomRef = useRef<HTMLDivElement>(null);
  const logsBottomRef = useRef<HTMLDivElement>(null);
  // Use a ref so event handlers always see the current session ID without stale closures
  const activeSessionIdRef = useRef<string | null>(null);

  const loadSessions = useCallback(() => {
    api.sessions.list().then(setSessions).catch(() => {});
  }, []);

  const loadHistory = useCallback((sessionId: string) => {
    api.traces.list({ sessionId, limit: 50 }).then(setHistory).catch(() => {});
  }, []);

  // Keep ref in sync with state
  const setSession = useCallback((id: string | null) => {
    activeSessionIdRef.current = id;
    setActiveSessionId(id);
  }, []);

  // Auto-start on mount
  useEffect(() => {
    setStarting(true);
    api.status().then((s) => {
      if (s.sessions[0]) {
        setSession(s.sessions[0].id);
        loadHistory(s.sessions[0].id);
        setStarting(false);
      } else {
        api.session.start()
          .then(() => api.status().then((s2) => {
            if (s2.sessions[0]) {
              setSession(s2.sessions[0].id);
              loadHistory(s2.sessions[0].id);
            }
          }))
          .catch(() => {})
          .finally(() => setStarting(false));
      }
    }).catch(() => setStarting(false));
    loadSessions();
    api.project.current().then((r) => setCwd(r.cwd)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!lastEvent) return;
    if (lastEvent.type === "trace.updated") {
      setPending([]);
      const sid = (lastEvent.payload.sessionId as string | undefined) ?? activeSessionIdRef.current;
      if (sid) {
        if (sid !== activeSessionIdRef.current) setSession(sid);
        loadHistory(sid);
      }
      loadSessions();
    }
    if (lastEvent.type === "session.started") {
      loadSessions();
    }
    if (lastEvent.type === "session.output") {
      const text = String(lastEvent.payload.text ?? "").trim();
      if (text) addLog(text);
    }
    if (lastEvent.type === "session.completed") {
      addLog("✓ Done");
    }
  }, [lastEvent]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [history, pending]);
  useEffect(() => { logsBottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [verboseLogs]);

  async function send(text?: string) {
    const msg = (text ?? prompt).trim();
    if (!msg || sending) return;
    setSending(true);
    setError("");
    if (!text) setPrompt("");

    const fullMsg = replyTo ? `[Replying to: "${replyTo.output.slice(0, 100)}"]\n${msg}` : msg;
    setReplyTo(null);

    const tempId = `p-${Date.now()}`;
    setPending((prev) => [...prev, { id: tempId, input: msg, replyTo: replyTo?.output.slice(0, 80) }]);

    try {
      const res = await api.chat.send(fullMsg, activeSessionIdRef.current ?? undefined);
      // Sync session ID from backend if it changed (e.g. auto-started new session)
      if (res.sessionId && res.sessionId !== activeSessionIdRef.current) {
        setSession(res.sessionId);
      }
      if (!res.sessionActive) {
        setPending((prev) => prev.filter((p) => p.id !== tempId));
        setError("Session not active. Retrying...");
        await api.session.start();
        await api.chat.send(fullMsg, activeSessionIdRef.current ?? undefined);
      }
    } catch (e: unknown) {
      setPending((prev) => prev.filter((p) => p.id !== tempId));
      setError(e instanceof Error ? e.message : "Failed to send");
    } finally {
      setSending(false);
    }
  }

  async function saveSessionName(id: string) {
    if (!editName.trim()) return;
    await api.sessions.rename(id, editName.trim()).catch(() => {});
    setEditingSessionId(null);
    loadSessions();
  }

  const allItems = [...[...history].reverse(), ...pending];
  const activeSession = sessions.find((s) => s.id === activeSessionId);

  return (
    <div className="flex h-[calc(100vh-49px)]">
      {/* Session sidebar */}
      <div className="w-56 border-r border-slate-800/50 flex flex-col bg-slate-950 shrink-0">
        <div className="flex items-center justify-between px-3 py-2.5 border-b border-slate-800/50">
          <span className="text-xs text-slate-400 font-medium tracking-wide">SESSIONS</span>
          <button
            onClick={async () => {
              setStarting(true);
              setPending([]);
              setHistory([]);
              try {
                const res = await api.session.new();
                if (res.sessionId) { setSession(res.sessionId); setHistory([]); }
                loadSessions();
              } finally { setStarting(false); }
            }}
            className="text-xs px-2.5 py-1 rounded-full bg-blue-600 hover:bg-blue-500 text-white transition-colors font-medium"
          >
            + New
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {sessions.map((s) => (
            <div key={s.id}
              className={`group px-3 py-2.5 border-b border-slate-800/30 cursor-pointer hover:bg-slate-800/40 transition-all ${s.id === activeSessionId ? "bg-slate-800/50 border-l-2 border-l-blue-500" : "border-l-2 border-l-transparent"}`}
              onClick={() => { setSession(s.id); setPending([]); loadHistory(s.id); }}>
              {editingSessionId === s.id ? (
                <input autoFocus value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onBlur={() => saveSessionName(s.id)}
                  onKeyDown={(e) => { if (e.key === "Enter") saveSessionName(s.id); if (e.key === "Escape") setEditingSessionId(null); }}
                  onClick={(e) => e.stopPropagation()}
                  className="w-full bg-slate-700 text-white text-xs rounded px-1 py-0.5 outline-none" />
              ) : (
                <div className="flex items-center justify-between gap-1">
                  <span className="text-xs text-slate-300 truncate flex-1">{s.name || "New Session"}</span>
                  <button onClick={(e) => { e.stopPropagation(); setEditingSessionId(s.id); setEditName(s.name || ""); }}
                    className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-white text-xs">✎</button>
                  <button onClick={async (e) => {
                      e.stopPropagation();
                      if (!confirm("Delete this session?")) return;
                      await api.sessions.delete(s.id).catch(() => {});
                      if (activeSessionIdRef.current === s.id) { setSession(null); setHistory([]); }
                      loadSessions();
                    }}
                    className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-red-400 text-xs">✕</button>
                </div>
              )}
              <div className="flex items-center gap-1 mt-0.5">
                <span className={`w-1.5 h-1.5 rounded-full ${s.active ? "bg-green-500" : "bg-slate-600"}`} />
                <span className="text-xs text-slate-500">{s.provider}/{s.model}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Main chat area */}
      <div className="flex flex-col flex-1 min-w-0 bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950">
        {/* Status bar */}
        <div className="flex items-center gap-3 px-4 py-2 border-b border-slate-800/50 text-sm shrink-0 backdrop-blur-sm">
          <span className={`w-2 h-2 rounded-full ${connected ? "bg-green-500" : "bg-red-500"}`} />
          <span className="text-slate-400">{connected ? "Connected" : "Disconnected"}</span>
          {starting && <span className="text-slate-500 text-xs">Starting session...</span>}
          {activeSession && !starting && (
            <>
              <span className="text-slate-700">|</span>
              <span className="text-slate-300 text-xs">{activeSession.name || "New Session"}</span>
              <span className={`ml-auto text-xs px-2 py-0.5 rounded-full ${activeSession.active ? "bg-green-900/60 text-green-300 border border-green-800/50" : "bg-slate-800 text-slate-400"}`}>
                {activeSession.active ? "active" : "idle"}
              </span>
            </>
          )}
        </div>

        {/* Reply banner */}
        {replyTo && (
          <div className="flex items-center gap-2 px-4 py-2 bg-slate-800/50 border-b border-slate-700/50 text-xs backdrop-blur-sm">
            <span className="text-blue-400">↩ Replying to:</span>
            <span className="text-slate-400 truncate flex-1">{replyTo.output.slice(0, 80)}</span>
            <button onClick={() => setReplyTo(null)} className="text-slate-500 hover:text-white">✕</button>
          </div>
        )}

        {/* History */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {allItems.length === 0 && !starting && (
            <div className="flex flex-col items-center justify-center h-full -mt-8">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-600/20 to-indigo-600/20 border border-blue-500/20 flex items-center justify-center mb-6">
                <svg className="w-8 h-8 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
                </svg>
              </div>
              <h2 className="text-xl font-semibold text-slate-100 mb-2">Welcome to AgentSchitzo</h2>
              <p className="text-slate-400 text-sm mb-8">Send a prompt to get started, or try one of these:</p>
              <div className="grid grid-cols-2 gap-3 max-w-lg w-full">
                {[
                  { icon: "💡", text: "Explain quantum computing in simple terms" },
                  { icon: "⚡", text: "Write a Python function to sort a list" },
                  { icon: "📄", text: "Summarize this document" },
                  { icon: "🔍", text: "Create a SQL query to find active users" },
                ].map((s) => (
                  <button key={s.text} onClick={() => send(s.text)}
                    className="flex items-start gap-3 p-3 rounded-xl border border-slate-700/50 bg-slate-800/30 hover:bg-slate-800/60 hover:border-slate-600/50 transition-all text-left group">
                    <span className="text-lg mt-0.5">{s.icon}</span>
                    <span className="text-xs text-slate-400 group-hover:text-slate-200 transition-colors leading-relaxed">{s.text}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {allItems.map((item) => {
            const isPending = !("output" in item);
            const p = item as PendingMessage;
            const t = item as TraceDTO;
            const replyMatch = item.input.match(/^\[Replying to: "(.*?)"]\n?/s);
            const displayInput = replyMatch ? item.input.slice(replyMatch[0].length) : item.input;
            const replyQuote = isPending ? p.replyTo : replyMatch?.[1];
            return (
              <div key={item.id} className="space-y-2">
                {replyQuote && (
                  <div className="flex justify-end">
                    <div className="text-xs text-slate-500 italic border-l-2 border-blue-500 pl-2 max-w-[60%] truncate">↩ {replyQuote}</div>
                  </div>
                )}
                <div className="flex justify-end">
                  <div className="bg-gradient-to-br from-blue-600 to-blue-700 text-white rounded-2xl rounded-tr-sm px-4 py-2 max-w-[80%] text-sm whitespace-pre-wrap shadow-lg shadow-blue-900/20">
                    {displayInput}
                  </div>
                </div>
                {isPending ? (
                  <div className="flex justify-start">
                    <div className="bg-slate-800/60 text-slate-500 rounded-2xl rounded-tl-sm px-4 py-2 text-sm italic animate-pulse border border-slate-700/30">Thinking...</div>
                  </div>
                ) : (
                  <>
                    <div className="flex justify-start group">
                      <div className="bg-slate-800/60 text-slate-100 rounded-2xl rounded-tl-sm px-4 py-2 max-w-[80%] text-sm whitespace-pre-wrap border border-slate-700/30">
                        {cleanOutput(t.output)}
                      </div>
                      <button onClick={() => setReplyTo(t)}
                        className="ml-2 opacity-0 group-hover:opacity-100 text-slate-500 hover:text-white text-xs self-end pb-2 transition-opacity">
                        ↩
                      </button>
                    </div>
                    <div className="text-xs text-slate-600 text-right">
                      {t.model} · ${t.costUsd.toFixed(4)} · {(t.durationMs / 1000).toFixed(1)}s
                    </div>
                  </>
                )}
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>

        {/* Quick commands */}
        <div className="px-4 pt-2 flex flex-wrap items-center gap-1.5 border-t border-slate-800/50">
          {QUICK_COMMANDS.map((cmd) => (
            <button key={cmd} onClick={() => send(cmd)}
              className="text-xs px-2.5 py-1 rounded-full bg-slate-800/50 text-slate-400 hover:bg-slate-700/60 hover:text-white border border-slate-700/30 transition-colors">
              {cmd}
            </button>
          ))}
          <span className="mx-1 text-slate-700">|</span>
          <button
            onClick={async () => {
              const res = await api.project.pick().catch(() => null);
              if (res?.ok && res.path) {
                const r = await api.project.select(res.path).catch(() => null);
                if (r?.ok) setCwd(r.cwd);
              }
            }}
            className="text-xs px-2.5 py-1 rounded-full bg-slate-800/50 text-slate-400 hover:bg-slate-700/60 hover:text-white border border-slate-700/30 transition-colors flex items-center gap-1"
            title={cwd || "Select project folder"}
          >
            📂 {cwd ? cwd.split("/").pop() : "Project"}
          </button>
        </div>

        {error && <div className="px-4 py-1 bg-red-900/30 text-red-300 text-xs border-t border-red-800/30">{error}</div>}
        <div className="p-4">
          <div className="flex gap-2 bg-slate-800/40 rounded-2xl border border-slate-700/40 p-1.5">
            <textarea
              className="flex-1 bg-transparent text-slate-100 rounded-xl px-4 py-3 text-sm resize-none outline-none placeholder-slate-500"
              rows={1}
              placeholder={starting ? "Starting session..." : "Send a prompt... (Enter to send)"}
              value={prompt}
              disabled={starting}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            />
            <button onClick={() => send()} disabled={sending || !prompt.trim() || starting}
              className="px-5 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-30 text-white rounded-xl text-sm font-medium transition-colors flex items-center gap-1.5 self-end">
              Send <span className="text-blue-200">↵</span>
            </button>
          </div>
        </div>
      </div>

      {/* Live activity panel */}
      <div className="w-64 border-l border-slate-800/50 flex flex-col bg-slate-950 shrink-0">
        <div className="flex items-center justify-between px-3 py-2.5 border-b border-slate-800/50">
          <span className="text-xs text-slate-400 font-medium tracking-wide">LIVE ACTIVITY</span>
          <button onClick={clearLogs} className="text-xs text-slate-600 hover:text-slate-300 transition-colors">Clear</button>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-1">
          {verboseLogs.length === 0 && (
            <div className="text-xs text-slate-600 italic">Activity will appear here...</div>
          )}
          {verboseLogs.map((log, i) => (
            <div key={i} className="text-xs text-slate-400 leading-relaxed break-words">{log}</div>
          ))}
          <div ref={logsBottomRef} />
        </div>
      </div>
    </div>
  );
}
