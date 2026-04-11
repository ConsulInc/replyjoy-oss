import type { UsageMetadata } from "langsmith/schemas";

import type { AgentProvider } from "../types/models.js";

type ModelRateCard = {
  inputPerMillion: number;
  outputPerMillion: number;
  cachedInputPerMillion?: number;
  cacheCreationPerMillion?: number;
  cacheReadPerMillion?: number;
};

function resolveRateCard(provider: AgentProvider, model: string): ModelRateCard | null {
  const normalizedModel = model.trim().toLowerCase();

  if (normalizedModel === "gemini-3-flash-preview") {
    return {
      inputPerMillion: 0.5,
      cachedInputPerMillion: 0.05,
      outputPerMillion: 3,
    };
  }

  return null;
}

function getUsageNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function estimateUsageCostUsd(params: {
  provider: AgentProvider;
  model: string;
  usageMetadata: UsageMetadata | undefined;
}) {
  const { provider, model, usageMetadata } = params;
  if (!usageMetadata) {
    return null;
  }

  const rateCard = resolveRateCard(provider, model);
  if (!rateCard) {
    return null;
  }

  const inputTokens = getUsageNumber(usageMetadata.input_tokens);
  const outputTokens = getUsageNumber(usageMetadata.output_tokens);
  const inputTokenDetails =
    usageMetadata.input_token_details && typeof usageMetadata.input_token_details === "object"
      ? usageMetadata.input_token_details
      : undefined;
  const cacheReadTokens = getUsageNumber((inputTokenDetails as { cache_read?: number } | undefined)?.cache_read);

  const uncachedInputTokens = Math.max(inputTokens - cacheReadTokens, 0);
  return (
    (uncachedInputTokens / 1_000_000) * rateCard.inputPerMillion +
    (cacheReadTokens / 1_000_000) * (rateCard.cachedInputPerMillion ?? rateCard.inputPerMillion) +
    (outputTokens / 1_000_000) * rateCard.outputPerMillion
  );
}

export function formatCostUsd(costUsd: number) {
  return costUsd.toFixed(8);
}
