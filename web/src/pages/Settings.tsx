import { useAppContext, type Theme } from "../App";
import { useState, useEffect } from "react";
import { api } from "../lib/api";

const THEMES: { value: Theme; label: string; preview: string }[] = [
  { value: "default", label: "Default", preview: "bg-slate-900 border-slate-700 text-blue-400" },
  { value: "amber", label: "Amber / Red", preview: "bg-black border-amber-800 text-amber-400" },
  { value: "matrix", label: "Matrix Green", preview: "bg-black border-green-900 text-green-400" },
];

const PROVIDERS = ["kiro", "codex-cli", "gemini-cli"];

export default function Settings() {
  const { theme, setTheme } = useAppContext();
  const [limits, setLimits] = useState<Record<string, string>>({});
  const [spent, setSpent] = useState<Record<string, number>>({});
  const [threshold, setThreshold] = useState("80");
  const [resetMonth, setResetMonth] = useState("");
  const [saved, setSaved] = useState<"idle" | "ok" | "err">("idle");

  function loadBudget() {
    api.budget.get().then((b) => {
      const l: Record<string, string> = {};
      for (const p of PROVIDERS) l[p] = b.providerLimits[p] != null ? String(b.providerLimits[p]) : "";
      setLimits(l);
      setSpent(b.providerSpent ?? {});
      setThreshold(String(Math.round((b.alertThreshold ?? 0.8) * 100)));
      setResetMonth((b as { resetMonth?: string }).resetMonth ?? "");
    }).catch(() => {});
  }

  useEffect(() => { loadBudget(); }, []);

  async function saveBudget() {
    const providerLimits: Record<string, number> = {};
    for (const [p, v] of Object.entries(limits)) {
      if (v) providerLimits[p] = parseFloat(v);
    }
    try {
      await api.budget.set({ providerLimits, alertThreshold: parseFloat(threshold) / 100 });
      setSaved("ok");
    } catch {
      setSaved("err");
    } finally {
      setTimeout(() => setSaved("idle"), 2000);
    }
  }

  return (
    <div className="p-8 max-w-md space-y-8">
      <h1 className="text-lg font-semibold text-slate-100">Settings</h1>

      {/* Theme */}
      <div>
        <div className="mb-2 text-xs text-slate-400 font-medium tracking-wide uppercase">Chat Theme</div>
        <div className="space-y-2">
          {THEMES.map((t) => (
            <button key={t.value} onClick={() => setTheme(t.value)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border transition-all text-left ${t.preview} ${theme === t.value ? "ring-2 ring-white/20" : "opacity-70 hover:opacity-100"}`}>
              <span className="w-3 h-3 rounded-full border-2 border-current flex-shrink-0" style={{ background: theme === t.value ? "currentColor" : "transparent" }} />
              <span className="text-sm font-medium">{t.label}</span>
              {theme === t.value && <span className="ml-auto text-xs opacity-60">Active</span>}
            </button>
          ))}
        </div>
      </div>

      {/* Budget */}
      <div>
        <div className="mb-2 text-xs text-slate-400 font-medium tracking-wide uppercase">Provider Budget Limits</div>
        <div className="bg-slate-900 border border-slate-700/50 rounded-xl p-4 space-y-4">
          <p className="text-xs text-slate-500">Set a monthly spend limit per provider. Resets automatically on the 1st of each month.</p>
          {resetMonth && <p className="text-xs text-slate-500">Current period: <span className="text-slate-300">{resetMonth}</span></p>}
          <div className="space-y-3">
            {PROVIDERS.map((p) => {
              const limit = parseFloat(limits[p] || "0") || 0;
              const s = spent[p] ?? 0;
              const pct = limit > 0 ? Math.min(100, Math.round(s / limit * 100)) : 0;
              return (
                <div key={p}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs text-slate-300 w-24">{p}</span>
                    <input type="number" min="0" step="1" placeholder="No limit"
                      value={limits[p] ?? ""} onChange={(e) => setLimits((prev) => ({ ...prev, [p]: e.target.value }))}
                      className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-100 outline-none focus:border-blue-500" />
                    <span className="text-xs text-slate-500 w-20 text-right">${s.toFixed(4)} spent</span>
                  </div>
                  {limit > 0 && (
                    <div className="h-1 bg-slate-800 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${pct >= 100 ? "bg-red-500" : pct >= parseInt(threshold) ? "bg-amber-500" : "bg-blue-500"}`}
                        style={{ width: `${pct}%` }} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1">Alert at {threshold}% of limit</label>
            <input type="range" min="50" max="99" value={threshold} onChange={(e) => setThreshold(e.target.value)}
              className="w-full accent-blue-500" />
          </div>
          <div className="flex gap-2">
            <button onClick={saveBudget}
              className={`flex-1 py-2 rounded-lg text-white text-sm font-medium transition-colors ${saved === "err" ? "bg-red-600" : "bg-blue-600 hover:bg-blue-500"}`}>
              {saved === "ok" ? "✓ Saved" : saved === "err" ? "✗ Failed" : "Save Budget"}
            </button>
            <button onClick={async () => { await api.budget.reset(); loadBudget(); }}
              className="px-3 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs transition-colors" title="Reset spend counters now">
              Reset Now
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
