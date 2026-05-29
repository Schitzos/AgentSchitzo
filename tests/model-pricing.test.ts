import { estimateCostUsd, parseCodexTotalTokens } from "../tracing/model-pricing.ts";

describe("model pricing", () => {
  it("parses Codex total token counts from stderr", () => {
    const stderr = "tokens used\n8.168\n";
    expect(parseCodexTotalTokens(stderr)).toBe(8168);
  });

  it("uses Kiro per-request pricing", () => {
    const estimate = estimateCostUsd("kiro", "claude-sonnet-4.6", "hello", "world", "");
    expect(estimate.costUsd).toBeCloseTo(0.0247, 4); // 1.3 credits × $0.019/credit
    expect(estimate.pricingSource).toBe("kiro:credits-per-request");
  });

  it("uses Codex model-specific pricing with parsed token totals", () => {
    const estimate = estimateCostUsd(
      "codex-cli",
      "gpt-5.4",
      "hello",
      "world",
      "tokens used\n8.168\n"
    );

    expect(estimate.inputTokens).toBe(5718);
    expect(estimate.outputTokens).toBe(2450);
    expect(estimate.totalTokens).toBe(8168);
    expect(estimate.costUsd).toBeCloseTo(0.051045, 6);
    expect(estimate.pricingSource).toBe("codex-cli:stderr-total-tokens-70-30-split");
  });

  it("uses Gemini model-specific pricing with visible text fallback", () => {
    const estimate = estimateCostUsd("gemini-cli", "gemini-2.5-pro", "hello", "world", "");
    expect(estimate.inputTokens).toBeGreaterThan(0);
    expect(estimate.outputTokens).toBeGreaterThan(0);
    expect(estimate.costUsd).toBeGreaterThan(0);
    expect(estimate.pricingSource).toBe("gemini-cli:visible-text-token-estimate");
  });

  it("returns zero for local models", () => {
    const estimate = estimateCostUsd("local-llm", "default", "hello", "world", "");
    expect(estimate.costUsd).toBe(0);
  });
});
