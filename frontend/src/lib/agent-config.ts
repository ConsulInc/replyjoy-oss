import agentConfigJson from "../../../shared/agent-config.json";

import type { UserSettings } from "./api";

type RawAgentConfig = {
  providers: string[];
  defaultModels: Record<string, string>;
  lookbacks: string[];
};

const rawAgentConfig = agentConfigJson as RawAgentConfig;

export const agentProviders = rawAgentConfig.providers as UserSettings["agentProvider"][];
export const defaultModelByProvider = rawAgentConfig.defaultModels as Record<
  UserSettings["agentProvider"],
  string
>;
export const allowedGeminiModels = [defaultModelByProvider.gemini] as const;
export const lookbackOptions = rawAgentConfig.lookbacks as UserSettings["initialAutodraftLookback"][];
