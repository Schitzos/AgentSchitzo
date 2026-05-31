export const KIRO_MODELS = [
  "auto", "claude-opus-4.6", "claude-sonnet-4.6", "claude-opus-4.5",
  "claude-sonnet-4.5", "claude-sonnet-4", "claude-haiku-4.5",
  "deepseek-3.2", "minimax-m2.5", "minimax-m2.1", "glm-5", "qwen3-coder-next",
];

export const CODEX_MODELS = [
  {
    id: "gpt-5.5",
    label: "default",
    description: "Frontier model for complex coding, research, and real-world work.",
  },
  {
    id: "gpt-5.4",
    label: "current",
    description: "Strong model for everyday coding.",
  },
  {
    id: "gpt-5.4-mini",
    label: "",
    description: "Small, fast, and cost-efficient model for simpler coding tasks.",
  },
  {
    id: "gpt-5.3-codex",
    label: "",
    description: "Coding-optimized model.",
  },
  {
    id: "gpt-5.2",
    label: "",
    description: "Optimized for professional work and long-running agents.",
  },
] as const;

export function formatCodexModels(activeModel: string): string {
  return CODEX_MODELS.map((model, index) => {
    const marker = model.id === activeModel ? "▸" : "•";
    return `${marker} ${index + 1}. ${model.id}`;
  }).join("\n");
}
