import { createReadline } from "./readline.ts";
import {
  saveSettings,
  getSettingsWithEnv,
  hasConfigFile,
  loadSettings,
} from "../config/settings.ts";
import type { Provider, CaleSettings } from "../config/settings.ts";
import { out } from "./output.ts";

const PROVIDERS: { id: Provider; name: string; defaultModel: string; envKey: string }[] = [
  { id: "openai", name: "OpenAI (GPT-4, etc.)", defaultModel: "gpt-4o", envKey: "OPENAI_API_KEY" },
  { id: "anthropic", name: "Anthropic (Claude)", defaultModel: "claude-sonnet-4-20250514", envKey: "ANTHROPIC_API_KEY" },
  { id: "cohere", name: "Cohere (Command A)", defaultModel: "command-a-03-2025", envKey: "COHERE_API_KEY" },
  { id: "openrouter", name: "OpenRouter (many models)", defaultModel: "anthropic/claude-3.5-sonnet", envKey: "OPENROUTER_API_KEY" },
  { id: "ollama", name: "Ollama (local models)", defaultModel: "codestral:22b", envKey: "OLLAMA_BASE_URL" },
];

function question(rl: ReturnType<typeof createReadline>, q: string): Promise<string> {
  return new Promise((resolve) => rl.question(q, resolve));
}

function hasApiKey(provider: Provider): boolean {
  const env: Record<Provider, string | undefined> = {
    openai: process.env.OPENAI_API_KEY,
    anthropic: process.env.ANTHROPIC_API_KEY,
    openrouter: process.env.OPENROUTER_API_KEY,
    cohere: process.env.COHERE_API_KEY ?? process.env.CO_API_KEY,
    ollama: process.env.OLLAMA_API_KEY,
  };
  return !!env[provider];
}

export function isConfigured(): boolean {
  if (!hasConfigFile()) return false;
  const s = getSettingsWithEnv();
  if (s.provider === "ollama") return true;
  return !!s.apiKey || hasApiKey(s.provider);
}

export async function runOnboard(rl?: ReturnType<typeof createReadline>): Promise<CaleSettings> {
  const ownRl = rl ?? createReadline();

  out.println("\nWelcome to cale - a minimal AI agent CLI.\n");
  out.println("Let's configure your AI provider.\n");

  // 1. Choose provider
  out.println("Providers:");
  PROVIDERS.forEach((p, i) => {
    out.println(`  ${i + 1}. ${p.name} (${p.id})`);
  });
  let provider: (typeof PROVIDERS)[number];
  for (;;) {
    const providerChoice = await question(ownRl, `\nSelect provider [1-${PROVIDERS.length}]: `);
    const n = parseInt(providerChoice.trim(), 10);
    if (n >= 1 && n <= PROVIDERS.length) {
      provider = PROVIDERS[n - 1]!;
      break;
    }
    out.println(`Enter 1-${PROVIDERS.length}.`);
  }

  // 2. Model
  out.println(`\nSuggested model for ${provider.name}: ${provider.defaultModel}`);
  let model: string;
  for (;;) {
    const modelInput = await question(ownRl, "Model: ");
    model = modelInput.trim();
    if (model) break;
    out.println("Enter a model ID.");
  }

  // 3. API key
  let apiKey: string | undefined;
  if (provider.id === "ollama") {
    out.println("\nOllama runs locally; no API key required.");
  } else if (hasApiKey(provider.id)) {
    out.println(`\nUsing ${provider.envKey} from environment.`);
  } else {
    out.println(`\nGet your API key from:`);
    switch (provider.id) {
      case "openai":
        out.println("  https://platform.openai.com/api-keys");
        break;
      case "anthropic":
        out.println("  https://console.anthropic.com/");
        break;
      case "cohere":
        out.println("  https://dashboard.cohere.com/api-keys");
        break;
      case "openrouter":
        out.println("  https://openrouter.ai/keys");
        break;
    }
    const keyInput = await question(ownRl, `\nPaste API key (or press Enter to use env later): `);
    apiKey = keyInput.trim() || undefined;
  }

  const existing = loadSettings();
  const existingTtsModel = existing.ttsModel;
  const settings: CaleSettings = {
    provider: provider.id,
    model,
    ...(apiKey && { apiKey }),
    ...(existingTtsModel && { ttsModel: existingTtsModel }),
    soulAlignment: existing.soulAlignment,
    soulTemperature: existing.soulTemperature,
  };
  saveSettings(settings);

  out.println("\nConfig saved to ~/.cale/settings.json");
  out.println(`Provider: ${provider.id}, Model: ${model}`);
  if (provider.id !== "ollama" && !apiKey && !hasApiKey(provider.id)) {
    out.println(`\nSet ${provider.envKey} in your environment before running.`);
  }
  out.println("\nYou're ready. Type your prompt and press Enter.\n");

  // Only close if we created our own readline (e.g. /onboard or `cale onboard`)
  if (!rl) ownRl.close();
  return settings;
}
