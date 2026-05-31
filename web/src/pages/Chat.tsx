import { useState, useEffect, useRef, useCallback } from "react";
import { api } from "../lib/api";
import { useWebSocket } from "../hooks/useWebSocket";
import { useAppContext } from "../App";
import type { TraceDTO, SessionDTO } from "../types/dto";

interface PendingMessage { id: string; input: string; replyTo?: string }
interface CommandMessage { id: string; text: string; isCommand: true }

const QUICK_COMMANDS = ["/status", "/interrupt", "/verbose", "/model", "/history", "/undo", "/help"];

function cleanOutput(text: string): string {
  let out = text.replace(/\x1B\[[0-9;]*[A-Za-z]/g, "");
  // Codex format: "codex <content>tokens used X.XXX<content repeated>"
  // Extract just the content between "codex " and "tokens used"
  const codexInline = out.match(/^codex ([\s\S]*?)tokens used [\d.]+/);
  if (codexInline) return codexInline[1].trim();
  // Fallback: strip "codex " prefix and everything from "tokens used" onward
  out = out.replace(/^codex\s+/, "");
  out = out.replace(/tokens used[\s\S]*$/, "").trim();
  // Strip known metadata-only lines
  out = out.replace(/^(workdir|model|provider|approval|sandbox|reasoning effort|reasoning summaries|session id):.*$/gm, "");
  out = out.replace(/^(user|exec|assistant)$/gm, "");
  out = out.replace(/^-{3,}$/gm, "");
  return out.replace(/\n{3,}/g, "\n\n").trim();
}

const URL_RE = /(https?:\/\/[^\s<>"]+)/;
function renderText(text: string) {
  const parts = text.split(/(https?:\/\/[^\s<>"]+)/);
  return parts.map((part, i) =>
    /^https?:\/\//.test(part)
      ? <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="underline opacity-80 hover:opacity-100 break-all">{part}</a>
      : part
  );
}

export default function Chat() {
  const [prompt, setPrompt] = useState("");
  const [history, setHistory] = useState<TraceDTO[]>([]);
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const [commandMessages, setCommandMessages] = useState<CommandMessage[]>([]);
  const [sessions, setSessions] = useState<SessionDTO[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const [replyTo, setReplyTo] = useState<TraceDTO | null>(null);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [cwd, setCwd] = useState("");
  const [providers, setProviders] = useState<string[]>([]);
  const [showProviderPicker, setShowProviderPicker] = useState(false);
  const [uploadToast, setUploadToast] = useState<{ ok: boolean; msg: string } | null>(null);
  const { connected, lastEvent } = useWebSocket();
  const { verboseLogs, addLog, clearLogs, theme } = useAppContext();
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

  // On mount: if active session exists resume it, otherwise show provider picker
  useEffect(() => {
    api.providers.list().then((r) => setProviders(r.providers)).catch(() => {});
    api.project.current().then((r) => setCwd(r.cwd)).catch(() => {});
    loadSessions();
    api.status().then((s) => {
      if (s.sessions[0]) {
        setSession(s.sessions[0].id);
        loadHistory(s.sessions[0].id);
      } else {
        setShowProviderPicker(true);
      }
    }).catch(() => setShowProviderPicker(true));
  }, []);

  async function startWithProvider(provider: string) {
    setShowProviderPicker(false);
    setStarting(true);
    try {
      const res = await api.session.startWithProvider(provider);
      if (res.sessionId) {
        setSession(res.sessionId);
        loadHistory(res.sessionId);
      }
      loadSessions();
    } catch {
      setError("Failed to start session");
      setShowProviderPicker(true);
    } finally {
      setStarting(false);
    }
  }

  useEffect(() => {
    if (!lastEvent) return;
    if (lastEvent.type === "trace.updated") {
      const sid = (lastEvent.payload.sessionId as string | undefined) ?? activeSessionIdRef.current;
      if (sid === activeSessionIdRef.current) {
        setPending([]);
        setCommandMessages([]);
      }
      if (sid) {
        if (sid !== activeSessionIdRef.current) setSession(sid);
        loadHistory(sid);
      }
      loadSessions();
    }
    if (lastEvent.type === "session.started" || lastEvent.type === "session.updated") {
      loadSessions();
    }
    if (lastEvent.type === "session.output") {
      const text = String(lastEvent.payload.text ?? "").trim();
      if (text) addLog(text);
    }
    if (lastEvent.type === "session.completed") {
      addLog("✓ Done");
    }
    if (lastEvent.type === "command.response") {
      const text = String(lastEvent.payload.text ?? "").trim();
      if (text) {
        setPending([]);
        setCommandMessages((prev) => [...prev, { id: `cmd-${Date.now()}-${Math.random()}`, text, isCommand: true }]);
      }
    }
    if (lastEvent.type === "budget.alert") {
      const level = lastEvent.payload.level as string;
      const provider = lastEvent.payload.provider as string;
      const spent = lastEvent.payload.spent as number;
      const limit = lastEvent.payload.limit as number;
      const msg = level === "exceeded"
        ? `🚨 ${provider} budget exceeded! $${spent.toFixed(4)} of $${limit} limit.`
        : `⚠️ ${provider} budget ${Math.round(spent / limit * 100)}% used — $${spent.toFixed(4)} of $${limit}.`;
      setCommandMessages((prev) => [...prev, { id: `budget-${Date.now()}`, text: msg, isCommand: true }]);
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

    const isCommand = msg.startsWith("/");
    const fullMsg = replyTo ? `[Replying to: "${replyTo.output.slice(0, 100)}"]\n${msg}` : msg;
    setReplyTo(null);

    const tempId = `p-${Date.now()}`;
    if (!isCommand) {
      setPending((prev) => [...prev, { id: tempId, input: msg, replyTo: replyTo?.output.slice(0, 80) }]);
    }

    try {
      const res = await api.chat.send(fullMsg, activeSessionIdRef.current ?? undefined);
      // Sync session ID from backend if it changed (e.g. auto-started new session)
      if (res.sessionId && res.sessionId !== activeSessionIdRef.current) {
        setSession(res.sessionId);
      }
      if (!res.sessionActive) {
        if (!isCommand) setPending((prev) => prev.filter((p) => p.id !== tempId));
        setError("Session not active. Retrying...");
        await api.session.start();
        // Wait briefly for session.started WS event to update the session ID
        await new Promise((r) => setTimeout(r, 500));
        await api.chat.send(fullMsg, activeSessionIdRef.current ?? undefined);
      }
    } catch (e: unknown) {
      if (!isCommand) setPending((prev) => prev.filter((p) => p.id !== tempId));
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

  const allItems = [...[...history].reverse(), ...commandMessages, ...pending];
  const activeSession = sessions.find((s) => s.id === activeSessionId);
  const sessionCost = history.reduce((sum, t) => sum + (t.costUsd ?? 0), 0);

  const themes = {
    default: { bg: "bg-slate-950", panel: "bg-slate-950", border: "border-slate-800/50", accent: "bg-blue-600 hover:bg-blue-500", accentText: "text-blue-400", bubble: "bg-gradient-to-br from-blue-600 to-blue-700", reply: "bg-slate-800/60 text-slate-100 border-slate-700/30", input: "bg-slate-800/40 border-slate-700/40", tag: "bg-slate-800/50 text-slate-400 border-slate-700/30" },
    amber: { bg: "bg-black", panel: "bg-zinc-950", border: "border-amber-900/40", accent: "bg-amber-600 hover:bg-amber-500", accentText: "text-amber-400", bubble: "bg-gradient-to-br from-amber-600 to-red-700", reply: "bg-zinc-900/80 text-amber-100 border-amber-900/30", input: "bg-zinc-900/60 border-amber-900/40", tag: "bg-zinc-900/60 text-amber-500 border-amber-900/30" },
    matrix: { bg: "bg-black", panel: "bg-black", border: "border-green-900/40", accent: "bg-green-700 hover:bg-green-600", accentText: "text-green-400", bubble: "bg-gradient-to-br from-green-800 to-green-900", reply: "bg-black text-green-300 border-green-900/40", input: "bg-black border-green-900/40", tag: "bg-black text-green-500 border-green-900/30" },
  };
  const th = themes[theme];

  const providerIcons: Record<string, string> = {
    kiro: "🤖", "codex-cli": "⚡", "gemini-cli": "✨", "local-llm": "🏠",
  };

  const providerDescriptions: Record<string, string> = {
    kiro: "AWS Kiro (requires login)",
    "codex-cli": "OpenAI Codex CLI",
    "gemini-cli": "Google Gemini CLI",
    "local-llm": "Local LLM",
  };

  return (
    <div className={`flex h-[calc(100vh-49px)] relative overflow-hidden ${th.bg}`}>
      {/* Provider picker modal */}
      {showProviderPicker && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm">
          <div className="w-full max-w-xs mx-4 bg-slate-900 border border-slate-700/50 rounded-2xl shadow-2xl p-6">
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-base font-semibold text-slate-100">Select Provider</h2>
              {activeSessionId && (
                <button onClick={() => setShowProviderPicker(false)} className="text-slate-500 hover:text-white text-lg leading-none">✕</button>
              )}
            </div>
            <p className="text-xs text-slate-500 mb-5">Choose the AI provider to start your session</p>
            {starting ? (
              <div className="text-center text-slate-400 text-sm py-4 animate-pulse">Starting session...</div>
            ) : (
              <div className="space-y-2">
                {(providers.length ? providers : ["kiro", "codex-cli", "gemini-cli"]).map((p) => (
                  <button key={p} onClick={() => startWithProvider(p)}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-slate-800/60 hover:bg-slate-700/70 border border-slate-700/40 hover:border-blue-500/50 transition-all text-left group">
                    <span className="text-xl">{providerIcons[p] ?? "🔌"}</span>
                    <div>
                      <div className="text-sm text-slate-200 font-medium group-hover:text-white">{p}</div>
                      <div className="text-xs text-slate-500">{providerDescriptions[p] ?? ""}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
            {error && <p className="text-xs text-red-400 text-center mt-4">{error}</p>}
          </div>
        </div>
      )}
      {/* Session sidebar */}
      <div className="w-56 border-r border-slate-800/50 flex flex-col bg-slate-950 shrink-0">
        <div className="flex items-center justify-between px-3 py-2.5 border-b border-slate-800/50">
          <span className="text-xs text-slate-400 font-medium tracking-wide">SESSIONS</span>
          <button
            onClick={() => { setPending([]); setHistory([]); setSession(null); setShowProviderPicker(true); }}
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
              ) : confirmDeleteId === s.id ? (
                <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                  <span className="text-xs text-red-400 flex-1">Delete?</span>
                  <button onClick={async () => {
                    await api.sessions.delete(s.id).catch(() => {});
                    if (activeSessionIdRef.current === s.id) { setSession(null); setHistory([]); }
                    setConfirmDeleteId(null);
                    loadSessions();
                  }} className="text-xs px-1.5 py-0.5 rounded bg-red-600 hover:bg-red-500 text-white">Yes</button>
                  <button onClick={() => setConfirmDeleteId(null)} className="text-xs px-1.5 py-0.5 rounded bg-slate-700 hover:bg-slate-600 text-white">No</button>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-1">
                  <span className="text-xs text-slate-300 truncate flex-1">{s.name || "New Session"}</span>
                  <button onClick={(e) => { e.stopPropagation(); setEditingSessionId(s.id); setEditName(s.name || ""); }}
                    className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-white text-xs">✎</button>
                  <button onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(s.id); }}
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
        <div className={`flex items-center gap-3 px-4 py-2 border-b ${th.border} text-sm shrink-0 backdrop-blur-sm`}>
          <span className={`w-2 h-2 rounded-full ${connected ? "bg-green-500" : "bg-red-500"}`} />
          <span className="text-slate-400">{connected ? "Connected" : "Disconnected"}</span>
          {starting && <span className="text-slate-500 text-xs">Starting session...</span>}
          {activeSession && !starting && (
            <>
              <span className="text-slate-700">|</span>
              <span className="text-slate-300 text-xs">{activeSession.name || "New Session"}</span>
              <div className="ml-auto flex items-center gap-2">
                {sessionCost > 0 && <span className={`text-xs ${th.accentText}`}>${sessionCost.toFixed(4)}</span>}
                <span className={`text-xs px-2 py-0.5 rounded-full ${activeSession.active ? "bg-green-900/60 text-green-300 border border-green-800/50" : "bg-slate-800 text-slate-400"}`}>
                  {activeSession.active ? "active" : "idle"}
                </span>
              </div>
            </>
          )}
        </div>


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
            const isPending = !("output" in item) && !("isCommand" in item);
            const isCommand = "isCommand" in item;
            const p = item as PendingMessage;
            const cmd = item as CommandMessage;
            const t = item as TraceDTO;

            if (isCommand) {
              return (
                <div key={cmd.id} className="flex justify-start">
                  <div className="bg-slate-700/50 text-slate-200 rounded-2xl rounded-tl-sm px-4 py-2 max-w-[80%] text-sm whitespace-pre-wrap border border-slate-600/30 font-mono text-xs">
                    {cmd.text}
                  </div>
                </div>
              );
            }

            const replyMatch = item.input.match(/^\[Replying to: "([\s\S]*?)"\]\n/);
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
                      <div className={`${th.reply} rounded-2xl rounded-tl-sm px-4 py-2 max-w-[80%] text-sm whitespace-pre-wrap border`}>
                        {renderText(cleanOutput(t.output))}
                      </div>
                      <button onClick={() => setReplyTo(t)}
                        className="ml-2 opacity-0 group-hover:opacity-100 text-slate-500 hover:text-white text-xs self-end pb-2 transition-opacity">
                        ↩
                      </button>
                    </div>
                    <div className="text-xs text-slate-600 text-right">
                      {t.model} · ${(t.costUsd ?? 0).toFixed(4)} · {(t.durationMs / 1000).toFixed(1)}s
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
        {uploadToast && (
          <div className={`px-4 py-1 text-xs border-t ${uploadToast.ok ? "bg-green-900/30 text-green-300 border-green-800/30" : "bg-red-900/30 text-red-300 border-red-800/30"}`}>
            {uploadToast.msg}
          </div>
        )}
        {replyTo && (
          <div className={`flex items-center gap-2 px-4 py-2 border-t ${th.border} text-xs`}>
            <span className={th.accentText}>↩ Replying to:</span>
            <span className="text-slate-400 truncate flex-1">{replyTo.output.slice(0, 80)}</span>
            <button onClick={() => setReplyTo(null)} className="text-slate-500 hover:text-white">✕</button>
          </div>
        )}
        <div className="p-4">
          <div className={`flex gap-2 ${th.input} rounded-2xl border p-1.5`}>
            <label className="self-end pb-2 px-1 cursor-pointer text-slate-500 hover:text-slate-300 transition-colors" title="Attach file">
              📎
              <input type="file" className="hidden" onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                e.target.value = "";
                try {
                  const res = await api.upload(file);
                  if (res.ok) {
                    setPrompt((p) => p + (p ? "\n" : "") + `[File: ${res.path}]`);
                    setUploadToast({ ok: true, msg: `📎 ${res.name} attached` });
                  } else {
                    setUploadToast({ ok: false, msg: "Upload failed" });
                  }
                } catch (err) {
                  setUploadToast({ ok: false, msg: err instanceof Error ? err.message : "Upload failed" });
                } finally {
                  setTimeout(() => setUploadToast(null), 3000);
                }
              }} />
            </label>
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
      <div className={`w-64 border-l ${th.border} flex flex-col ${th.panel} shrink-0`}>
        <div className={`flex items-center justify-between px-3 py-2.5 border-b ${th.border}`}>
          <span className="text-xs text-slate-400 font-medium tracking-wide">LIVE ACTIVITY</span>
          <button onClick={clearLogs} className="text-xs text-slate-600 hover:text-slate-300 transition-colors">Clear</button>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-0">
          {verboseLogs.length === 0 && (
            <div className="text-xs text-slate-600 italic">Activity will appear here...</div>
          )}
          {verboseLogs.map((log, i) => (
            <div key={i}>
              <div className={`text-xs leading-relaxed break-words py-1 ${th.accentText === "text-green-400" ? "text-green-400/80" : th.accentText === "text-amber-400" ? "text-amber-200/80" : "text-slate-400"}`}>{log}</div>
              {i < verboseLogs.length - 1 && <div className={`border-t ${th.border} opacity-40`} />}
            </div>
          ))}
          <div ref={logsBottomRef} />
        </div>
      </div>
    </div>
  );
}
