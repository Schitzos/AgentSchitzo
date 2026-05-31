import { useEffect, useState } from "react";
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import { api } from "../lib/api";
import type { DashboardSummaryDTO, UsageTimelineDTO, TopModelDTO } from "../types/dto";

const COLORS = ["#3b82f6", "#8b5cf6", "#10b981", "#f59e0b", "#ef4444"];

export default function Dashboard() {
  const [summary, setSummary] = useState<DashboardSummaryDTO | null>(null);
  const [timeline, setTimeline] = useState<UsageTimelineDTO[]>([]);
  const [topModels, setTopModels] = useState<TopModelDTO[]>([]);
  const [latencies, setLatencies] = useState<{ model: string; p50: number; p95: number; avg: number }[]>([]);
  const [budget, setBudget] = useState<{ providerLimits: Record<string, number>; providerSpent: Record<string, number> } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.allSettled([
      api.dashboard.summary().then(setSummary),
      api.dashboard.timeline().then(setTimeline),
      api.dashboard.topModels().then(setTopModels),
      api.dashboard.latencies().then(setLatencies),
      api.budget.get().then(setBudget),
    ]).finally(() => setLoading(false));
  }, []);

  const providerData = summary ? Object.entries(summary.byProvider).map(([name, v]) => ({ name, ...v })) : [];
  const modelData = summary ? Object.entries(summary.byModel).map(([name, v]) => ({ name, ...v })) : [];

  // Providers that have a budget limit set
  const budgetProviders = budget ? Object.entries(budget.providerLimits).filter(([, limit]) => limit > 0) : [];

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card label="Total Cost" value={loading ? "..." : `$${(summary?.totalCostUsd ?? 0).toFixed(4)}`} />
        <Card label="Total Requests" value={loading ? "..." : String(summary?.totalRequests ?? 0)} />
        <Card label="Providers" value={loading ? "..." : String(Object.keys(summary?.byProvider ?? {}).length)} />
        <Card label="Models" value={loading ? "..." : String(Object.keys(summary?.byModel ?? {}).length)} />
      </div>

      {/* Budget vs Spend */}
      {budgetProviders.length > 0 && (
        <Section title="Monthly Budget">
          <div className="space-y-3">
            {budgetProviders.map(([provider, limit]) => {
              const spent = budget?.providerSpent[provider] ?? 0;
              const pct = Math.min(100, (spent / limit) * 100);
              const color = pct >= 100 ? "#ef4444" : pct >= 80 ? "#f59e0b" : "#3b82f6";
              return (
                <div key={provider}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-slate-300">{provider}</span>
                    <span className="text-slate-400">
                      <span style={{ color }}>${spent.toFixed(4)}</span>
                      <span className="text-slate-600"> / ${limit}</span>
                      <span className="ml-2 text-slate-500">{Math.round(pct)}%</span>
                    </span>
                  </div>
                  <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
                  </div>
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {/* Usage timeline */}
      <Section title="Cost Over Time">
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={timeline}>
            <XAxis dataKey="date" tick={{ fill: "#94a3b8", fontSize: 11 }} />
            <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} tickFormatter={(v) => `$${v.toFixed(3)}`} />
            <Tooltip formatter={(v: number) => [`$${v.toFixed(4)}`, "Cost"]} contentStyle={{ background: "#1e293b", border: "none" }} />
            <Area type="monotone" dataKey="costUsd" stroke="#3b82f6" fill="#1e3a5f" />
          </AreaChart>
        </ResponsiveContainer>
      </Section>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Provider breakdown */}
        <Section title="By Provider">
          <div className="flex items-center gap-4">
            <PieChart width={140} height={140}>
              <Pie data={providerData} dataKey="requests" cx={65} cy={65} outerRadius={60}>
                {providerData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
            </PieChart>
            <div className="space-y-2 flex-1">
              {providerData.map((p, i) => (
                <div key={p.name} className="flex justify-between text-sm">
                  <span className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
                    {p.name}
                  </span>
                  <span className="text-slate-400">{p.requests} req · ${p.costUsd.toFixed(4)}</span>
                </div>
              ))}
            </div>
          </div>
        </Section>

        {/* Top models */}
        <Section title="Top Models">
          <div className="space-y-2">
            {topModels.map((m, i) => (
              <div key={m.model} className="flex items-center gap-3 text-sm">
                <span className="text-slate-500 w-4">{i + 1}</span>
                <span className="flex-1 truncate">{m.provider}/{m.model}</span>
                <span className="text-slate-400">{m.requests}x</span>
                <span className="text-slate-400">${m.costUsd.toFixed(4)}</span>
              </div>
            ))}
            {topModels.length === 0 && <div className="text-slate-500 text-sm">No data yet</div>}
          </div>
        </Section>
      </div>

      {/* Latency chart */}
      <Section title="Model Latency (ms)">
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={latencies} margin={{ bottom: 40 }}>
            <XAxis dataKey="model" tick={{ fill: "#94a3b8", fontSize: 10 }} angle={-25} textAnchor="end" height={60} interval={0} />
            <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} />
            <Tooltip contentStyle={{ background: "#1e293b", border: "none", color: "#e2e8f0" }} labelStyle={{ color: "#94a3b8" }} />
            <Bar dataKey="avg" name="avg" fill="#10b981" radius={[3, 3, 0, 0]} />
            <Bar dataKey="p50" name="p50" fill="#3b82f6" radius={[3, 3, 0, 0]} />
            <Bar dataKey="p95" name="p95" fill="#8b5cf6" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
        {latencies.length === 0 && <div className="text-slate-500 text-sm text-center -mt-32">No data yet</div>}
      </Section>
    </div>
  );
}

function Card({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-slate-900 rounded-xl p-4 border border-slate-800">
      <div className="text-slate-400 text-xs mb-1">{label}</div>
      <div className="text-white text-2xl font-bold">{value}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-slate-900 rounded-xl p-4 border border-slate-800">
      <h3 className="text-slate-300 text-sm font-medium mb-4">{title}</h3>
      {children}
    </div>
  );
}
