import type { Provider } from "../config/settings.ts";

const PROVIDERS: Provider[] = ["openai", "anthropic", "openrouter", "cohere", "ollama"];

function isProvider(value: string): value is Provider {
  return PROVIDERS.includes(value as Provider);
}

export function resolveProviderAndModel(modelId: string, fallbackProvider: Provider): {
  provider: Provider;
  model: string;
} {
  const trimmed = modelId.trim();
  const slashIndex = trimmed.indexOf("/");
  if (slashIndex <= 0) return { provider: fallbackProvider, model: trimmed };

  const prefix = trimmed.slice(0, slashIndex).toLowerCase();
  const remainder = trimmed.slice(slashIndex + 1).trim();
  if (!remainder || !isProvider(prefix)) {
    return { provider: fallbackProvider, model: trimmed };
  }

  return { provider: prefix, model: remainder };
}
