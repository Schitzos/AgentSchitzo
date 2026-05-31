import fs from "fs";
import path from "path";
import { emit as wsEmit } from "../../server/ws-emitter.ts";

const BUDGET_FILE = path.join(process.cwd(), "logs", "budget.json");

interface BudgetConfig {
  providerLimits: Record<string, number>;
  alertThreshold: number;
  // baseline: DB total at last reset, per provider
  baseline: Record<string, number>;
  resetMonth: string; // "YYYY-MM"
}

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

function load(): BudgetConfig {
  try {
    return JSON.parse(fs.readFileSync(BUDGET_FILE, "utf-8")) as BudgetConfig;
  } catch {
    return { providerLimits: {}, alertThreshold: 0.8, baseline: {}, resetMonth: currentMonth() };
  }
}

function save(cfg: BudgetConfig): void {
  fs.mkdirSync(path.dirname(BUDGET_FILE), { recursive: true });
  fs.writeFileSync(BUDGET_FILE, JSON.stringify(cfg, null, 2));
}

// Auto-reset baseline at start of new month
function maybeReset(cfg: BudgetConfig, getTotal: (p: string) => number): boolean {
  if (!cfg.baseline) cfg.baseline = {};
  if (cfg.resetMonth === currentMonth()) return false;
  for (const provider of Object.keys(cfg.providerLimits)) {
    cfg.baseline[provider] = getTotal(provider);
  }
  cfg.resetMonth = currentMonth();
  firedAlerts.clear();
  save(cfg);
  return true;
}

export function getBudget(getTotal: (p: string) => number): BudgetConfig & { providerSpent: Record<string, number> } {
  const cfg = load();
  maybeReset(cfg, getTotal);
  const providerSpent: Record<string, number> = {};
  for (const p of Object.keys(cfg.providerLimits)) {
    providerSpent[p] = Math.max(0, getTotal(p) - (cfg.baseline[p] ?? 0));
  }
  return { ...cfg, providerSpent };
}

export function setBudget(config: Partial<Pick<BudgetConfig, "providerLimits" | "alertThreshold">>): void {
  const cfg = load();
  if (config.providerLimits !== undefined) cfg.providerLimits = config.providerLimits;
  if (config.alertThreshold !== undefined) cfg.alertThreshold = config.alertThreshold;
  save(cfg);
}

export function manualReset(getTotal: (p: string) => number): void {
  const cfg = load();
  for (const provider of Object.keys(cfg.providerLimits)) {
    cfg.baseline[provider] = getTotal(provider);
  }
  cfg.resetMonth = currentMonth();
  firedAlerts.clear();
  save(cfg);
}

type NotifyFn = (msg: string) => void;
const firedAlerts = new Set<string>();

export function checkBudget(provider: string, getTotal: (p: string) => number, notify: NotifyFn): void {
  const cfg = load();
  maybeReset(cfg, getTotal);
  const limit = cfg.providerLimits[provider];
  if (!limit) return;

  const spent = Math.max(0, getTotal(provider) - (cfg.baseline[provider] ?? 0));
  const ratio = spent / limit;
  const bucket = Math.floor(ratio * 10);
  const exceededKey = `${provider}-${cfg.resetMonth}-exceeded`;
  const warnKey = `${provider}-${cfg.resetMonth}-warn-${bucket}`;

  if (ratio >= 1 && !firedAlerts.has(exceededKey)) {
    firedAlerts.add(exceededKey);
    notify(`🚨 ${provider} budget exceeded! $${spent.toFixed(4)} of $${limit} this month.`);
    wsEmit("budget.alert", { provider, level: "exceeded", spent, limit });
  } else if (ratio >= cfg.alertThreshold && !firedAlerts.has(warnKey)) {
    firedAlerts.add(warnKey);
    notify(`⚠️ ${provider} budget ${Math.round(ratio * 100)}% used — $${spent.toFixed(4)} of $${limit} this month.`);
    wsEmit("budget.alert", { provider, level: "warning", spent, limit });
  }
}
