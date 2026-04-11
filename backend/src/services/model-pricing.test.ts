import { describe, expect, it } from "vitest";

import { estimateUsageCostUsd } from "./model-pricing.js";

describe("estimateUsageCostUsd", () => {
  it("prices Gemini 3 Flash Preview from token counts", () => {
    const costUsd = estimateUsageCostUsd({
      provider: "gemini",
      model: "gemini-3-flash-preview",
      usageMetadata: {
        input_tokens: 2_000,
        output_tokens: 500,
        total_tokens: 2_500,
      },
    });

    expect(costUsd).not.toBeNull();
    expect(costUsd!).toBeCloseTo(0.0025, 10);
  });

  it("prices Gemini cached input separately from uncached input", () => {
    const costUsd = estimateUsageCostUsd({
      provider: "gemini",
      model: "gemini-3-flash-preview",
      usageMetadata: {
        input_tokens: 2_000,
        output_tokens: 500,
        total_tokens: 2_500,
        input_token_details: {
          cache_read: 400,
        },
      },
    });

    expect(costUsd).not.toBeNull();
    expect(costUsd!).toBeCloseTo(0.00232, 10);
  });
});
