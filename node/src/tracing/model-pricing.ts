export interface CostEstimate {
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  pricingSource: string;
}

type KiroPricing = {
  kind: "kiro-credits";
  creditsPerRequest: number;
};

type TokenPricing = {
  kind: "token-rates";
  inputPerMillionUsd: number;
  outputPerMillionUsd: number;
};

type LocalPricing = {
  kind: "free";
};

type ModelPricing = KiroPricing | TokenPricing | LocalPricing;

const KIRO_CREDIT_USD = 0.019; // $19/month ÷ 1000 credits

const KIRO_MODEL_PRICING: Record<string, KiroPricing> = {
  "claude-sonnet-4": { kind: "kiro-credits", creditsPerRequest: 1.3 },
  "claude-sonnet-4.5": { kind: "kiro-credits", creditsPerRequest: 1.3 },
  "claude-sonnet-4.6": { kind: "kiro-credits", creditsPerRequest: 1.3 },
  "claude-opus-4.5": { kind: "kiro-credits", creditsPerRequest: 2.2 },
  "claude-opus-4.6": { kind: "kiro-credits", creditsPerRequest: 2.2 },
  "claude-haiku-4.5": { kind: "kiro-credits", creditsPerRequest: 0.4 },
  "deepseek-3.2": { kind: "kiro-credits", creditsPerRequest: 0.25 },
  auto: { kind: "kiro-credits", creditsPerRequest: 1.0 },
};

const CODEX_MODEL_PRICING: Record<string, TokenPricing> = {
  "gpt-5.5": { kind: "token-rates", inputPerMillionUsd: 5.0, outputPerMillionUsd: 30.0 },
  "gpt-5.4": { kind: "token-rates", inputPerMillionUsd: 2.5, outputPerMillionUsd: 15.0 },
  "gpt-5.4-mini": { kind: "token-rates", inputPerMillionUsd: 0.75, outputPerMillionUsd: 4.5 },
  "gpt-5.3-codex": { kind: "token-rates", inputPerMillionUsd: 1.75, outputPerMillionUsd: 14.0 },
  "gpt-5.2": { kind: "token-rates", inputPerMillionUsd: 1.75, outputPerMillionUsd: 14.0 },
};

const GEMINI_MODEL_PRICING: Record<string, TokenPricing> = {
  "gemini-2.5-pro": { kind: "token-rates", inputPerMillionUsd: 1.25, outputPerMillionUsd: 10.0 },
  "gemini-2.5-flash-preview-09-2025": { kind: "token-rates", inputPerMillionUsd: 0.3, outputPerMillionUsd: 2.5 },
  "gemini-2.5-flash-lite": { kind: "token-rates", inputPerMillionUsd: 0.1, outputPerMillionUsd: 0.4 },
  "gemini-2.0-flash": { kind: "token-rates", inputPerMillionUsd: 0.1, outputPerMillionUsd: 0.4 },
  "gemini-2.0-flash-lite": { kind: "token-rates", inputPerMillionUsd: 0.075, outputPerMillionUsd: 0.3 },
};

const LOCAL_MODEL_PRICING: Record<string, LocalPricing> = {
  default: { kind: "free" },
};

export function estimateCostUsd(
  adapter: string,
  model: string,
  input: string,
  output: string,
  stderr: string
): CostEstimate {
  const pricing = getModelPricing(adapter, model);

  if (!pricing || pricing.kind === "free") {
    return {
      costUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      pricingSource: pricing ? `${adapter}:free` : `${adapter}:unknown-model`,
    };
  }

  if (pricing.kind === "kiro-credits") {
    return {
      costUsd: pricing.creditsPerRequest * KIRO_CREDIT_USD,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      pricingSource: `${adapter}:credits-per-request`,
    };
  }

  const tokenEstimate = getTokenEstimate(adapter, input, output, stderr);
  const costUsd =
    (tokenEstimate.inputTokens * pricing.inputPerMillionUsd +
      tokenEstimate.outputTokens * pricing.outputPerMillionUsd) / 1_000_000;

  return {
    costUsd,
    inputTokens: tokenEstimate.inputTokens,
    outputTokens: tokenEstimate.outputTokens,
    totalTokens: tokenEstimate.totalTokens,
    pricingSource: tokenEstimate.pricingSource,
  };
}

function getModelPricing(adapter: string, model: string): ModelPricing | null {
  if (adapter === "kiro") return KIRO_MODEL_PRICING[model] ?? null;
  if (adapter === "codex-cli") return CODEX_MODEL_PRICING[model] ?? null;
  if (adapter === "gemini-cli") return GEMINI_MODEL_PRICING[model] ?? null;
  if (adapter === "local-llm") return LOCAL_MODEL_PRICING[model] ?? LOCAL_MODEL_PRICING.default;
  return null;
}

function getTokenEstimate(
  adapter: string,
  input: string,
  output: string,
  stderr: string
): {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  pricingSource: string;
} {
  if (adapter === "codex-cli") {
    const totalTokens = parseCodexTotalTokens(stderr);
    if (totalTokens !== null) {
      const inputTokens = Math.round(totalTokens * 0.7);
      const outputTokens = Math.max(0, totalTokens - inputTokens);
      return {
        inputTokens,
        outputTokens,
        totalTokens,
        pricingSource: "codex-cli:stderr-total-tokens-70-30-split",
      };
    }
  }

  const inputTokens = estimateVisibleTokens(input);
  const outputTokens = estimateVisibleTokens(output);
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    pricingSource: `${adapter}:visible-text-token-estimate`,
  };
}

export function parseCodexTotalTokens(stderr: string): number | null {
  const match = stderr.match(/tokens used\s*[\r\n]+\s*([0-9][0-9.,]*)/i);
  if (!match) return null;
  return parseHumanNumber(match[1]);
}

function parseHumanNumber(value: string): number | null {
  const trimmed = value.trim();

  if (/^\d{1,3}([.,]\d{3})+$/.test(trimmed)) {
    return Number(trimmed.replace(/[.,]/g, ""));
  }

  if (/^\d+[.,]\d+$/.test(trimmed)) {
    const parsed = Number(trimmed.replace(",", "."));
    return Number.isFinite(parsed) ? parsed : null;
  }

  const parsed = Number(trimmed.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function estimateVisibleTokens(text: string): number {
  const compact = text.trim();
  if (!compact) return 0;
  return Math.max(1, Math.ceil(compact.length / 4));
}
