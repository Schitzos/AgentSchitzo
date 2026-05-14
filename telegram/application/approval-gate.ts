/**
 * Pre-execution approval gate.
 * Classifies user input risk level and blocks high-risk requests
 * until the user explicitly confirms with /yes.
 */

export type RiskLevel = "low" | "high";

const HIGH_RISK_PATTERNS = [
  /\b(delete|remove|drop|destroy|wipe|purge)\b.*\b(database|db|table|collection|bucket|repo|repository|production|prod)\b/i,
  /\b(force push|push --force|push -f)\b/i,
  /\bgit\s+(reset --hard|clean -f|branch -D)\b/i,
  /\brm\s+-rf?\b/i,
  /\b(deploy|release|publish)\s+.*(prod|production|live)\b/i,
  /\b(drop|truncate)\s+(table|database|schema)\b/i,
  /\b(disable|remove)\s+(auth|authentication|authorization|firewall|security)\b/i,
  /\b(overwrite|replace)\s+.*\b(env|\.env|credentials|secrets?|keys?)\b/i,
  /\bmigrate\b.*\b(prod|production)\b/i,
];

export function classifyRisk(input: string): RiskLevel {
  for (const pattern of HIGH_RISK_PATTERNS) {
    if (pattern.test(input)) return "high";
  }
  return "low";
}

export function buildApprovalPrompt(input: string): string {
  const preview = input.length > 200 ? input.slice(0, 200) + "…" : input;
  return `⚠️ This looks like a high-risk action:\n\n"${preview}"\n\nReply /yes to proceed or /no to cancel.`;
}
