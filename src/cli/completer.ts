import { execFileSync } from 'node:child_process'
import { listPresets } from '../config/prompts.ts'
import { listSessions } from '../config/sessions.ts'
import { getSettingsWithEnv, loadSettings } from '../config/settings.ts'

const COMMANDS = [
  '/help',
  '/config',
  '/crypto',
  '/qr',
  '/qrcode',
  '/uuid',
  '/uuidv7',
  '/crawl',
  '/align',
  '/model',
  '/prompt',
  '/session',
  '/heartbeat',
  '/tts',
  '/stt',
  '/onboard',
  '/clear',
  '/exit'
]

const PROMPT_SUBCOMMANDS = ['list', 'use', 'add', 'set', 'show', 'remove']
const SESSION_SUBCOMMANDS = ['list', 'use', 'new', 'remove', 'current']
const HEARTBEAT_SUBCOMMANDS = ['status', 'start', 'stop', 'once', 'launchd']
const HEARTBEAT_LAUNCHD_SUBCOMMANDS = ['status', 'install', 'uninstall', 'print']
const ALIGN_SUBCOMMANDS = ['left', 'right', 'toggle']
const TTS_SUBCOMMANDS = ['on', 'off', 'use', 'melo', 'voice', 'language', 'speed', 'ls']
const TTS_PROVIDERS = ['rhasspy', 'endpoint', 'piper', 'melo']
const MODEL_SUGGESTIONS = [
  'cohere/command-a-plus-05-2026',
  'cohere/command-a-03-2025',
  'openai/gpt-4o',
  'openai/gpt-4.1',
  'openai/o3',
  'openai/o4-mini',
  'anthropic/claude-sonnet-4-20250514',
  'anthropic/claude-3-5-sonnet-latest',
  'openrouter/anthropic/claude-3.5-sonnet',
  'openrouter/openai/gpt-4o',
  'ollama/codestral:22b',
  'ollama/llama3.1:8b'
]
const MELO_VOICE_CACHE_TTL_MS = 5_000

let meloVoiceCache: { endpoint: string; fetchedAt: number; options: string[] } | null = null

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

function getVoiceSelector(voiceId: string): string {
  const trimmed = voiceId.trim()
  const separatorIndex = trimmed.indexOf('-')
  return separatorIndex > 0 ? trimmed.slice(0, separatorIndex) : trimmed
}

function collectVoiceIds(payload: unknown, output: string[]): void {
  if (Array.isArray(payload)) {
    for (const item of payload) collectVoiceIds(item, output)
    return
  }
  if (!payload || typeof payload !== 'object') return
  const record = payload as Record<string, unknown>
  const id = record.id ?? record.voice_id ?? record.voiceId ?? record.name
  if ((typeof id === 'string' || typeof id === 'number') && String(id).trim()) {
    output.push(String(id).trim())
  }
  for (const key of ['voices', 'items', 'results', 'data']) {
    if (key in record) collectVoiceIds(record[key], output)
  }
}

function getMeloVoiceCompletionOptions(): string[] {
  const settings = getSettingsWithEnv()
  if (settings.ttsProvider !== 'melo') return []

  const endpoint = (settings.meloTtsEndpoint ?? 'http://localhost:8000').trim().replace(/\/+$/, '')
  const configuredVoice = settings.meloTtsVoiceId?.trim()
  const configuredOptions = configuredVoice ? unique([getVoiceSelector(configuredVoice), configuredVoice]) : []
  const now = Date.now()
  if (meloVoiceCache && meloVoiceCache.endpoint === endpoint && now - meloVoiceCache.fetchedAt < MELO_VOICE_CACHE_TTL_MS) {
    return unique([...configuredOptions, ...meloVoiceCache.options])
  }

  try {
    const raw = execFileSync('curl', ['-fsS', '--max-time', '1', `${endpoint}/voices`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    })
    const ids: string[] = []
    collectVoiceIds(JSON.parse(raw) as unknown, ids)
    const selectors = ids.map(getVoiceSelector)
    const options = unique([...configuredOptions, ...selectors, ...ids])
    meloVoiceCache = { endpoint, fetchedAt: now, options }
    return options
  } catch {
    meloVoiceCache = { endpoint, fetchedAt: now, options: configuredOptions }
    return configuredOptions
  }
}

function modelMatches(model: string, partial: string): boolean {
  const normalizedModel = model.toLowerCase()
  const normalizedPartial = partial.toLowerCase()
  if (normalizedPartial.includes('/')) {
    return normalizedModel.startsWith(normalizedPartial)
  }
  const slashIndex = normalizedModel.indexOf('/')
  const lastSlashIndex = normalizedModel.lastIndexOf('/')
  const modelOnly = slashIndex >= 0 ? normalizedModel.slice(slashIndex + 1) : normalizedModel
  const modelTail = lastSlashIndex >= 0 ? normalizedModel.slice(lastSlashIndex + 1) : normalizedModel
  return (
    normalizedModel.startsWith(normalizedPartial) ||
    modelOnly.startsWith(normalizedPartial) ||
    modelTail.startsWith(normalizedPartial)
  )
}

/**
 * Tab completion for REPL commands.
 * Returns [completions, originalLine]
 */
export function completer(line: string): [string[], string] {
  const trimmed = line.trimStart()

  // Not a command - no completion
  if (!trimmed.startsWith('/')) {
    return [[], line]
  }

  const parts = trimmed.split(/\s+/)
  const cmd = parts[0] ?? ''

  // Completing the command itself
  if (parts.length === 1) {
    const matches = COMMANDS.filter((c) => c.startsWith(cmd))
    return [matches, line]
  }

  // Completing subcommands or arguments
  const sub = parts[1] ?? ''

  if (cmd === '/model') {
    const partial = parts[1] ?? ''
    const settings = loadSettings()
    const current = `${settings.provider}/${settings.model}`
    const suggestions = unique([current, ...MODEL_SUGGESTIONS])
    const matches = suggestions
      .filter((model) => modelMatches(model, partial))
      .map((model) => `${cmd} ${model}`)
    return [matches, line]
  }

  if (cmd === '/align') {
    if (parts.length === 2) {
      const matches = ALIGN_SUBCOMMANDS.filter((s) => s.startsWith(sub)).map((s) => `${cmd} ${s}`)
      return [matches, line]
    }
  }

  if (cmd === '/prompt') {
    if (parts.length === 2) {
      // Complete subcommand
      const matches = PROMPT_SUBCOMMANDS.filter((s) => s.startsWith(sub)).map((s) => `${cmd} ${s}`)
      return [matches, line]
    }
    if (parts.length === 3) {
      // Complete preset name for use/show/remove
      const subCmd = parts[1]
      if (subCmd !== undefined && ['use', 'show', 'remove', 'set'].includes(subCmd)) {
        const partial = parts[2] ?? ''
        const { presets } = listPresets()
        const names = Object.keys(presets).filter((n) => n.startsWith(partial))
        const matches = names.map((n) => `${cmd} ${subCmd} ${n}`)
        return [matches, line]
      }
    }
  }

  if (cmd === '/session') {
    if (parts.length === 2) {
      // Complete subcommand
      const matches = SESSION_SUBCOMMANDS.filter((s) => s.startsWith(sub)).map((s) => `${cmd} ${s}`)
      return [matches, line]
    }
    if (parts.length === 3) {
      // Complete session name for use/remove
      const subCmd = parts[1]
      if (subCmd !== undefined && ['use', 'remove'].includes(subCmd)) {
        const partial = parts[2] ?? ''
        const sessions = listSessions()
        const names = sessions.map((s) => s.name).filter((n) => n.startsWith(partial))
        const matches = names.map((n) => `${cmd} ${subCmd} ${n}`)
        return [matches, line]
      }
    }
  }

  if (cmd === '/heartbeat') {
    if (parts.length === 2) {
      const matches = HEARTBEAT_SUBCOMMANDS.filter((s) => s.startsWith(sub)).map((s) => `${cmd} ${s}`)
      return [matches, line]
    }
    if (parts.length === 3 && parts[1] === 'launchd') {
      const partial = parts[2] ?? ''
      const matches = HEARTBEAT_LAUNCHD_SUBCOMMANDS.filter((s) => s.startsWith(partial)).map(
        (s) => `${cmd} launchd ${s}`
      )
      return [matches, line]
    }
  }

  if (cmd === '/tts') {
    if (parts.length === 2) {
      const matches = TTS_SUBCOMMANDS.filter((s) => s.startsWith(sub)).map((s) => `${cmd} ${s}`)
      return [matches, line]
    }
    if (parts.length === 3 && parts[1] === 'use') {
      const partial = parts[2] ?? ''
      const matches = TTS_PROVIDERS.filter((provider) => provider.startsWith(partial)).map(
        (provider) => `${cmd} use ${provider}`
      )
      return [matches, line]
    }
    if (parts.length === 3 && parts[1] === 'voice') {
      const partial = parts[2] ?? ''
      const options = ['list', 'ls', ...getMeloVoiceCompletionOptions()]
      const matches = options.filter((opt) => opt.startsWith(partial)).map((opt) => `${cmd} voice ${opt}`)
      return [matches, line]
    }
    if (parts.length === 3 && parts[1] === 'language') {
      const partial = parts[2] ?? ''
      const options = ['list', 'ls']
      const matches = options.filter((opt) => opt.startsWith(partial)).map((opt) => `${cmd} language ${opt}`)
      return [matches, line]
    }
  }

  return [[], line]
}
