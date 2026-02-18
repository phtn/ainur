import { homedir, platform } from "node:os";
import { join } from "node:path";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";

export type Provider = "openai" | "anthropic" | "openrouter" | "cohere" | "ollama";
export type TtsProvider = "endpoint" | "piper";

function normalizeTtsProvider(value: unknown): TtsProvider | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "endpoint" || normalized === "piper") {
    return normalized;
  }
  return undefined;
}

export interface CaleSettings {
  provider: Provider;
  model: string;
  apiKey?: string;
  ttsModel?: string;
  ttsEndpoint?: string;
  ttsProvider?: TtsProvider;
  sttEndpoint?: string;
  soulAlignment?: boolean;
  soulTemperature?: number;
}

const DEFAULT_SETTINGS: CaleSettings = {
  provider: "openai",
  model: "gpt-4o",
  sttEndpoint: "http://localhost:5002/api/speech-to-text",
  soulAlignment: true,
  soulTemperature: 0.7,
};

export function getConfigDir(): string {
  const env = process.env.CALE_CONFIG_DIR;
  if (env) return env;
  const base = platform() === "win32" ? process.env.APPDATA ?? homedir() : homedir();
  return join(base, ".cale");
}

function getConfigPath(): string {
  const env = process.env.CALE_CONFIG;
  if (env) return env;
  return join(getConfigDir(), "settings.json");
}

export function hasConfigFile(): boolean {
  return existsSync(getConfigPath());
}

let _settings: CaleSettings | null = null;

export function loadSettings(): CaleSettings {
  if (_settings) return _settings;
  const path = getConfigPath();
  if (!existsSync(path)) {
    _settings = { ...DEFAULT_SETTINGS };
    return _settings;
  }
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw) as Partial<CaleSettings>;
    _settings = {
      provider: (parsed.provider ?? DEFAULT_SETTINGS.provider) as Provider,
      model: parsed.model ?? DEFAULT_SETTINGS.model,
      apiKey: parsed.apiKey,
      ttsModel: parsed.ttsModel,
      ttsEndpoint: parsed.ttsEndpoint,
      ttsProvider: normalizeTtsProvider(parsed.ttsProvider),
      sttEndpoint: parsed.sttEndpoint ?? DEFAULT_SETTINGS.sttEndpoint,
      soulAlignment:
        typeof parsed.soulAlignment === "boolean"
          ? parsed.soulAlignment
          : DEFAULT_SETTINGS.soulAlignment,
      soulTemperature:
        typeof parsed.soulTemperature === "number"
          ? parsed.soulTemperature
          : DEFAULT_SETTINGS.soulTemperature,
    };
  } catch {
    _settings = { ...DEFAULT_SETTINGS };
  }
  return _settings;
}

export function saveSettings(settings: CaleSettings): void {
  const dir = getConfigDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const path = getConfigPath();
  writeFileSync(path, JSON.stringify(settings, null, 2), "utf-8");
  _settings = settings;
}

export function getSettingsWithEnv(): CaleSettings {
  const settings = loadSettings();
  const soulAlignmentEnv = process.env.CALE_SOUL_ALIGNMENT?.trim().toLowerCase();
  const soulAlignment =
    soulAlignmentEnv === "true" || soulAlignmentEnv === "1"
      ? true
      : soulAlignmentEnv === "false" || soulAlignmentEnv === "0"
        ? false
        : settings.soulAlignment;
  const soulTemperatureEnv = process.env.CALE_SOUL_TEMPERATURE?.trim();
  const soulTemperatureParsed =
    soulTemperatureEnv !== undefined ? Number.parseFloat(soulTemperatureEnv) : Number.NaN;
  return {
    provider: (process.env.CALE_PROVIDER as Provider | undefined) ?? settings.provider,
    model: process.env.CALE_MODEL ?? settings.model,
    apiKey:
      process.env.OPENAI_API_KEY ??
      process.env.ANTHROPIC_API_KEY ??
      process.env.OPENROUTER_API_KEY ??
      process.env.COHERE_API_KEY ??
      settings.apiKey,
    ttsModel: process.env.CALE_TTS_MODEL ?? settings.ttsModel,
    ttsEndpoint: process.env.CALE_TTS_ENDPOINT ?? settings.ttsEndpoint,
    ttsProvider: normalizeTtsProvider(process.env.CALE_TTS_PROVIDER) ?? settings.ttsProvider,
    sttEndpoint: process.env.CALE_STT_ENDPOINT ?? settings.sttEndpoint,
    soulAlignment,
    soulTemperature:
      Number.isFinite(soulTemperatureParsed) && soulTemperatureParsed >= 0 && soulTemperatureParsed <= 2
        ? soulTemperatureParsed
        : settings.soulTemperature,
  };
}

export function getApiKeyForProvider(provider: Provider): string | undefined {
  const env: Record<Provider, string | undefined> = {
    openai: process.env.OPENAI_API_KEY,
    anthropic: process.env.ANTHROPIC_API_KEY,
    openrouter: process.env.OPENROUTER_API_KEY,
    cohere: process.env.COHERE_API_KEY ?? process.env.CO_API_KEY,
    ollama: process.env.OLLAMA_API_KEY,
  };
  const s = loadSettings();
  const raw =
    env[provider] ??
    (provider !== "ollama" && s.provider === provider ? s.apiKey : undefined);
  return typeof raw === "string" ? raw.trim() : undefined;
}
