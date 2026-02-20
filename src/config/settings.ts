import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir, platform } from 'node:os'
import { join } from 'node:path'

export type Provider = 'openai' | 'anthropic' | 'openrouter' | 'cohere' | 'ollama'
export type TtsProvider = 'endpoint' | 'piper'
export type SttProvider = 'openai' | 'endpoint'

function normalizeTtsProvider(value: unknown): TtsProvider | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toLowerCase()
  if (normalized === 'endpoint' || normalized === 'piper') {
    return normalized
  }
  return undefined
}

function normalizeSttProvider(value: unknown): SttProvider | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toLowerCase()
  if (normalized === 'openai' || normalized === 'endpoint') {
    return normalized
  }
  return undefined
}

function normalizeBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  return undefined
}

function normalizeGatewayPort(value: unknown): number | undefined {
  if (typeof value === 'number') {
    if (Number.isInteger(value) && value > 0 && value <= 65535) return value
    return undefined
  }
  if (typeof value !== 'string') return undefined
  const parsed = Number.parseInt(value.trim(), 10)
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 65535) return undefined
  return parsed
}

function normalizeGatewayBind(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  if (trimmed === 'loopback') return '127.0.0.1'
  if (trimmed === 'lan') return '0.0.0.0'
  return trimmed
}

export interface CaleSettings {
  provider: Provider
  model: string
  apiKey?: string
  ttsModel?: string
  ttsEndpoint?: string
  ttsProvider?: TtsProvider
  sttProvider?: SttProvider
  sttEndpoint?: string
  soulAlignment?: boolean
  soulTemperature?: number
  gatewayEnabled?: boolean
  gatewayAutoStart?: boolean
  gatewayPort?: number
  gatewayBind?: string
  gatewayToken?: string
  massive?: string
}

const DEFAULT_SETTINGS: CaleSettings = {
  provider: 'cohere',
  model: 'command-a-03-2025',
  sttProvider: 'openai',
  sttEndpoint: 'http://localhost:5002/api/speech-to-text',
  soulAlignment: true,
  soulTemperature: 0.8,
  gatewayEnabled: true,
  gatewayAutoStart: true,
  gatewayPort: 18889,
  gatewayBind: '127.0.0.1'
}

export function getConfigDir(): string {
  const env = process.env.CALE_CONFIG_DIR
  if (env) return env
  const base = platform() === 'win32' ? (process.env.APPDATA ?? homedir()) : homedir()
  return join(base, '.cale')
}

function getConfigPath(): string {
  const env = process.env.CALE_CONFIG
  if (env) return env
  return join(getConfigDir(), 'settings.json')
}

export function hasConfigFile(): boolean {
  return existsSync(getConfigPath())
}

let _settings: CaleSettings | null = null

export function loadSettings(): CaleSettings {
  if (_settings) return _settings
  const path = getConfigPath()
  if (!existsSync(path)) {
    _settings = { ...DEFAULT_SETTINGS }
    return _settings
  }
  try {
    const raw = readFileSync(path, 'utf-8')
    const parsed = JSON.parse(raw) as Partial<CaleSettings>
    _settings = {
      provider: (parsed.provider ?? DEFAULT_SETTINGS.provider) as Provider,
      model: parsed.model ?? DEFAULT_SETTINGS.model,
      apiKey: parsed.apiKey,
      ttsModel: parsed.ttsModel,
      ttsEndpoint: parsed.ttsEndpoint,
      ttsProvider: normalizeTtsProvider(parsed.ttsProvider),
      sttProvider: normalizeSttProvider(parsed.sttProvider) ?? DEFAULT_SETTINGS.sttProvider,
      sttEndpoint: parsed.sttEndpoint ?? DEFAULT_SETTINGS.sttEndpoint,
      soulAlignment: typeof parsed.soulAlignment === 'boolean' ? parsed.soulAlignment : DEFAULT_SETTINGS.soulAlignment,
      soulTemperature:
        typeof parsed.soulTemperature === 'number' ? parsed.soulTemperature : DEFAULT_SETTINGS.soulTemperature,
      gatewayEnabled:
        typeof parsed.gatewayEnabled === 'boolean' ? parsed.gatewayEnabled : DEFAULT_SETTINGS.gatewayEnabled,
      gatewayAutoStart:
        typeof parsed.gatewayAutoStart === 'boolean' ? parsed.gatewayAutoStart : DEFAULT_SETTINGS.gatewayAutoStart,
      gatewayPort:
        typeof parsed.gatewayPort === 'number' &&
        Number.isInteger(parsed.gatewayPort) &&
        parsed.gatewayPort > 0 &&
        parsed.gatewayPort <= 65535
          ? parsed.gatewayPort
          : DEFAULT_SETTINGS.gatewayPort,
      gatewayBind: normalizeGatewayBind(parsed.gatewayBind) ?? DEFAULT_SETTINGS.gatewayBind,
      gatewayToken:
        typeof parsed.gatewayToken === 'string' && parsed.gatewayToken.trim().length > 0
          ? parsed.gatewayToken.trim()
          : undefined,
      massive: process.env.MASSIVE_API_KEY
    }
  } catch {
    _settings = { ...DEFAULT_SETTINGS }
  }
  return _settings
}

export function saveSettings(settings: CaleSettings): void {
  const dir = getConfigDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const path = getConfigPath()
  writeFileSync(path, JSON.stringify(settings, null, 2), 'utf-8')
  _settings = settings
}

export function getSettingsWithEnv(): CaleSettings {
  const settings = loadSettings()
  const soulAlignmentEnv = process.env.CALE_SOUL_ALIGNMENT?.trim().toLowerCase()
  const soulAlignment =
    soulAlignmentEnv === 'true' || soulAlignmentEnv === '1'
      ? true
      : soulAlignmentEnv === 'false' || soulAlignmentEnv === '0'
        ? false
        : settings.soulAlignment
  const soulTemperatureEnv = process.env.CALE_SOUL_TEMPERATURE?.trim()
  const soulTemperatureParsed = soulTemperatureEnv !== undefined ? Number.parseFloat(soulTemperatureEnv) : Number.NaN
  const gatewayEnabledEnv = normalizeBoolean(process.env.CALE_GATEWAY_ENABLED)
  const gatewayAutoStartEnv = normalizeBoolean(process.env.CALE_GATEWAY_AUTO_START)
  const gatewayPortEnv = normalizeGatewayPort(process.env.CALE_GATEWAY_PORT)
  const gatewayBindEnv = normalizeGatewayBind(process.env.CALE_GATEWAY_BIND)
  const gatewayTokenEnv = process.env.CALE_GATEWAY_TOKEN?.trim()
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
    sttProvider: normalizeSttProvider(process.env.CALE_STT_PROVIDER) ?? settings.sttProvider,
    sttEndpoint: process.env.CALE_STT_ENDPOINT ?? settings.sttEndpoint,
    soulAlignment,
    soulTemperature:
      Number.isFinite(soulTemperatureParsed) && soulTemperatureParsed >= 0 && soulTemperatureParsed <= 2
        ? soulTemperatureParsed
        : settings.soulTemperature,
    gatewayEnabled: gatewayEnabledEnv !== undefined ? gatewayEnabledEnv : settings.gatewayEnabled,
    gatewayAutoStart: gatewayAutoStartEnv !== undefined ? gatewayAutoStartEnv : settings.gatewayAutoStart,
    gatewayPort: gatewayPortEnv ?? settings.gatewayPort,
    gatewayBind: gatewayBindEnv ?? settings.gatewayBind,
    gatewayToken: gatewayTokenEnv && gatewayTokenEnv.length > 0 ? gatewayTokenEnv : settings.gatewayToken,
    massive: process.env.MASSIVE_API_KEY
  }
}

export function getApiKeyForProvider(provider: Provider): string | undefined {
  const env: Record<Provider, string | undefined> = {
    openai: process.env.OPENAI_API_KEY,
    anthropic: process.env.ANTHROPIC_API_KEY,
    openrouter: process.env.OPENROUTER_API_KEY,
    cohere: process.env.COHERE_API_KEY ?? process.env.CO_API_KEY,
    ollama: process.env.OLLAMA_API_KEY
  }
  const s = loadSettings()
  const raw = env[provider] ?? (provider !== 'ollama' && s.provider === provider ? s.apiKey : undefined)
  return typeof raw === 'string' ? raw.trim() : undefined
}
