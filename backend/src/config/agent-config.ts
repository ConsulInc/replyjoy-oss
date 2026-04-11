import agentConfigJson from "../../../shared/agent-config.json" with { type: "json" };

type RawAgentConfig = {
  providers: string[];
  defaultModels: Record<string, string>;
  lookbacks: string[];
};

const rawAgentConfig = agentConfigJson as RawAgentConfig;

export const agentProviders = rawAgentConfig.providers as Array<"gemini">;
export const defaultModelByProvider = rawAgentConfig.defaultModels as Record<"gemini", string>;
export const allowedGeminiModels = [defaultModelByProvider.gemini] as const;
export const lookbackOptions = rawAgentConfig.lookbacks as Array<
  "1d" | "2d" | "3d" | "4d" | "5d"
>;

const legacyModelAliases: Record<"gemini", Record<string, string>> = {
  gemini: {
    "gemini-2.0-flash": defaultModelByProvider.gemini,
  },
};

export function normalizeAgentModel(provider: "gemini", model: string | null | undefined) {
  const normalized = model?.trim();
  if (!normalized) {
    return defaultModelByProvider[provider];
  }

  return legacyModelAliases[provider]?.[normalized] ?? normalized;
}

export function isAllowedAgentModelSelection(provider: "gemini", model: string | null | undefined) {
  const normalized = model?.trim();
  if (!normalized) {
    return false;
  }

  return allowedGeminiModels.includes(normalized as (typeof allowedGeminiModels)[number]);
}
