import { getSettingsWithEnv, getApiKeyForProvider } from "../config/settings.ts";
import { createModel } from "./providers.ts";

export function resolveModel(overrides?: { provider?: string; model?: string }) {
  const settings = getSettingsWithEnv();
  const provider = (overrides?.provider ?? settings.provider) as "openai" | "anthropic" | "openrouter" | "cohere";
  const model = overrides?.model ?? settings.model;
  const apiKey = getApiKeyForProvider(provider);
  return createModel(provider, model, apiKey);
}
