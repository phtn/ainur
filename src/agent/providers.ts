import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createCohere } from "@ai-sdk/cohere";
import type { Provider } from "../config/settings.ts";
import { getApiKeyForProvider } from "../config/settings.ts";

export function createModel(
  provider: Provider,
  modelId: string,
  apiKey?: string
) {
  const key = apiKey ?? getApiKeyForProvider(provider);

  switch (provider) {
    case "openai": {
      const openai = createOpenAI({
        apiKey: key ?? process.env.OPENAI_API_KEY,
      });
      return openai(modelId as "gpt-4o");
    }
    case "anthropic": {
      const anthropic = createAnthropic({
        apiKey: key ?? process.env.ANTHROPIC_API_KEY,
      });
      return anthropic(modelId as "claude-sonnet-4-20250514");
    }
    case "openrouter": {
      const openrouter = createOpenAI({
        baseURL: "https://openrouter.ai/api/v1",
        apiKey: key ?? process.env.OPENROUTER_API_KEY,
      });
      return openrouter(modelId);
    }
    case "cohere": {
      const cohereProvider = createCohere({
        apiKey: key ?? process.env.COHERE_API_KEY ?? process.env.CO_API_KEY,
      });
      return cohereProvider(modelId as "command-a-03-2025");
    }
    case "ollama": {
      const rawBaseUrl = process.env.OLLAMA_BASE_URL ?? process.env.OLLAMA_HOST ?? "http://localhost:11434";
      const baseUrl = rawBaseUrl.endsWith("/v1")
        ? rawBaseUrl
        : `${rawBaseUrl.replace(/\/$/, "")}/v1`;
      const ollama = createOpenAI({
        baseURL: baseUrl,
        apiKey: key ?? "ollama",
      });
      return ollama(modelId);
    }
    default: {
      throw new Error(`Unknown provider: ${provider}`);
    }
  }
}
