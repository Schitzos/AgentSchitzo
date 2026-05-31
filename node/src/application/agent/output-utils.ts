const MAX_MSG_LEN = 4096;

export function splitMessage(text: string): string[] {
  const parts: string[] = [];
  for (let i = 0; i < text.length; i += MAX_MSG_LEN) {
    parts.push(text.slice(i, i + MAX_MSG_LEN));
  }
  return parts;
}

export function normalizeOutput(text: string): string {
  let out = text;
  /* istanbul ignore next -- regex alternatives counted as branches */
  out = out.replace(/\x1B\[[0-9;]*[A-Za-z]/g, "");
  out = out.replace(/^#{1,6}\s+/gm, "");
  out = out.replace(/\*{1,3}([^*]+)\*{1,3}/g, "$1");
  out = out.replace(/_{1,3}([^_]+)_{1,3}/g, "$1");
  out = out.replace(/```[\s\S]*?```/g, "");
  out = out.replace(/`([^`]+)`/g, "$1");
  out = out.replace(/\n{3,}/g, "\n\n");
  out = out.trim();
  return out;
}

export function isSummaryOutput(text: string): boolean {
  const lower = text.toLowerCase();
  return /\b(plan|task|done|complete|created|modified|fixed|error|fail|block|issue|result|summary|finished)\b/.test(lower);
}

export function extractHumanReply(text: string): string {
  let out = text.replace(/\x1B\[[0-9;]*[A-Za-z]/g, "");
  // Codex actual format: "codex <content>tokens used X.XXX<content repeated>"
  const codexInline = out.match(/^codex ([\s\S]*?)tokens used [\d.]+/);
  if (codexInline) return codexInline[1].trim().slice(0, MAX_MSG_LEN);
  // Fallback: strip prefix and suffix
  out = out.replace(/^codex\s+/, "");
  out = out.replace(/tokens used[\s\S]*$/, "").trim();
  out = out.replace(/^(workdir|model|provider|approval|sandbox|reasoning effort|reasoning summaries|session id):.*$/gm, "");
  out = out.replace(/^(user|exec|assistant)$/gm, "");
  out = out.replace(/^-{3,}$/gm, "");
  out = out.replace(/^warning:.*$/gm, "");
  out = out.replace(/\n{3,}/g, "\n\n").trim();
  if (!out || out.length < 5) {
    const paragraphs = text.replace(/\x1B\[[0-9;]*[A-Za-z]/g, "").trim().split(/\n\n+/);
    return (paragraphs[paragraphs.length - 1]?.trim() || "").slice(0, MAX_MSG_LEN);
  }
  return out;
}
