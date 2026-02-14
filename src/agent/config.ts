import { getSettingsWithEnv, getApiKeyForProvider, type Provider } from "../config/settings.ts";
import { createModel } from "./providers.ts";
import { resolveProviderAndModel } from "./model-selection.ts";

export function resolveModel(overrides?: { provider?: string; model?: string }) {
  const settings = getSettingsWithEnv();
  const baseProvider = (overrides?.provider ?? settings.provider) as Provider;
  const rawModel = overrides?.model ?? settings.model;
  const { provider, model } = resolveProviderAndModel(rawModel, baseProvider);
  const apiKey = getApiKeyForProvider(provider);
  return createModel(provider, model, apiKey);
}
