import type { ModelMessage } from 'ai'
import { OpenTUIApp } from '../../ui/opentui-app.ts'
import { resolveModel } from '../agent/config.ts'
import { runAgent } from '../agent/loop.ts'
import { resolveProviderAndModel } from '../agent/model-selection.ts'
import { addOrUpdatePreset } from '../config/prompts.ts'
import { getCurrentSessionName, loadSession, saveSession, setCurrentSessionName } from '../config/sessions.ts'
import { getSettingsWithEnv, loadSettings, saveSettings, type Provider, type TtsProvider } from '../config/settings.ts'
import { setApprovalCallback, speakText } from '../tools/index.ts'
import { getConfiguredTtsProvider, listTtsProviders } from '../tools/tts.ts'
import {
  fetchMeloTtsLanguages,
  fetchMeloTtsVoices,
  getMeloTtsEndpoint,
  getMeloTtsLanguage,
  getMeloTtsSpeed,
  getMeloTtsVoiceId,
  getMeloTtsVoiceSelector,
  resolveMeloTtsVoiceId
} from '../services/melo-tts.ts'
import {
  handleConfig,
  handleCrawl,
  handleCrypto,
  handleHeartbeat,
  handleHelp,
  handlePromptList,
  handlePromptRemove,
  handlePromptShow,
  handlePromptUse,
  handleQRCode,
  handleSessionCurrent,
  handleSessionList,
  handleSessionNew,
  handleSessionRemove,
  handleSessionUse,
  handleUUID
} from './commands.ts'
import { completer } from './completer.ts'
import { out } from './output.ts'
import { runSttCli } from './stt.ts'
import { fetchTtsVoiceOptions, getConfiguredTtsEndpoint, getTtsVoiceIdFromEndpoint, withTtsVoice } from './tts-voice.ts'

const ANSI_PATTERN = /\x1b\[[0-9;]*m/g
const TTS_USAGE =
  'Usage: /tts on | off | use <rhasspy|piper|melo> | melo [url] | voice [id|list] | language [code|list] | speed [number] | ls'

function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, '')
}

async function captureCliOutput<T>(fn: () => T | Promise<T>): Promise<{ output: string; result: T }> {
  const originalStdoutWrite = process.stdout.write.bind(process.stdout)
  const originalStderrWrite = process.stderr.write.bind(process.stderr)
  const originalOut = {
    dim: out.dim,
    green: out.green,
    red: out.red,
    cyan: out.cyan,
    write: out.write,
    println: out.println,
    error: out.error,
    bold: out.bold,
    muted: out.muted,
    toolLine: out.toolLine,
    successLine: out.successLine,
    warnLine: out.warnLine,
    clearLine: out.clearLine
  }
  let output = ''

  const append = (text: string): boolean => {
    output += text
    return true
  }

  const captureWrite = (chunk: unknown, encodingOrCallback?: BufferEncoding | ((error?: Error | null) => void), callback?: (error?: Error | null) => void): boolean => {
    output += Buffer.isBuffer(chunk) ? chunk.toString() : String(chunk)
    if (typeof encodingOrCallback === 'function') {
      encodingOrCallback()
    } else {
      callback?.()
    }
    return true
  }

  ;(process.stdout.write as unknown as typeof captureWrite) = captureWrite
  ;(process.stderr.write as unknown as typeof captureWrite) = captureWrite
  out.dim = append
  out.green = append
  out.red = append
  out.cyan = append
  out.write = append
  out.println = (text: string) => append(`${text}\n`)
  out.error = (text: string) => append(`${text}\n`)
  out.bold = append
  out.muted = append
  out.toolLine = (name: string, detail: string) => append(`  ⚙ ${name} ${detail}\n`)
  out.successLine = (text: string) => append(`  ✓ ${text}\n`)
  out.warnLine = (text: string) => append(`  ⚠ ${text}\n`)
  out.clearLine = () => true

  try {
    const result = await fn()
    return { output: stripAnsi(output).trimEnd(), result }
  } finally {
    process.stdout.write = originalStdoutWrite
    process.stderr.write = originalStderrWrite
    out.dim = originalOut.dim
    out.green = originalOut.green
    out.red = originalOut.red
    out.cyan = originalOut.cyan
    out.write = originalOut.write
    out.println = originalOut.println
    out.error = originalOut.error
    out.bold = originalOut.bold
    out.muted = originalOut.muted
    out.toolLine = originalOut.toolLine
    out.successLine = originalOut.successLine
    out.warnLine = originalOut.warnLine
    out.clearLine = originalOut.clearLine
  }
}

function toTtsProviderLabel(provider: TtsProvider): string {
  return provider === 'endpoint' ? 'rhasspy' : provider
}

function textFromMessage(message: ModelMessage): string {
  if (typeof message.content === 'string') {
    return message.content
  }

  if (!Array.isArray(message.content)) {
    return ''
  }

  return message.content
    .map((part) => {
      const maybeTextPart = part as { text?: unknown }
      return typeof maybeTextPart.text === 'string' ? maybeTextPart.text : ''
    })
    .filter(Boolean)
    .join('\n')
}

function summarizeText(text: string, maxLength = 180): string {
  const compact = text.replace(/\s+/g, ' ').trim()
  if (compact.length <= maxLength) {
    return compact
  }
  return `${compact.slice(0, maxLength - 3).trimEnd()}...`
}

function lastMessageSummary(messages: ModelMessage[], role: 'user' | 'assistant'): string | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages.at(i)
    if (!message) continue
    if (message.role !== role) continue

    const summary = summarizeText(textFromMessage(message))
    if (summary) {
      return summary
    }
  }

  return null
}

export async function startTuiRepl(): Promise<void> {
  let currentSession: string = getCurrentSessionName() ?? 'default'
  let messages: ModelMessage[] = loadSession(currentSession)
  let modelOverride: { provider?: Provider; model?: string } | undefined
  let speechEnabled = false
  let abortController: AbortController | null = null
  let isGenerating = false
  let abortNoticeShown = false

  const settings = getSettingsWithEnv()
  const contextLabel = `${settings.provider}/${settings.model}`

  const app = new OpenTUIApp({ contextLabel })
  await app.init()
  app.setCompleter(completer)
  app.onCompletionSuggestions((suggestions) => {
    app.addEntry({
      role: 'system',
      content: suggestions.map((suggestion) => `\`${suggestion}\``).join('\n'),
      timestamp: new Date()
    })
  })

  const addSystemEntry = (content: string): void => {
    app.addEntry({ role: 'system', content, timestamp: new Date() })
  }

  const addCommandOutput = (output: string, fallback = 'Done.'): void => {
    addSystemEntry(output.trim() || fallback)
  }

  const runCapturedCommand = async <T>(fn: () => T | Promise<T>, fallback?: string): Promise<T> => {
    const { output, result } = await captureCliOutput(fn)
    addCommandOutput(output, fallback)
    return result
  }

  const renderSessionOverview = (): void => {
    const activeSettings = getSettingsWithEnv()
    if (messages.length === 0) {
      addSystemEntry(
        [
          '**Cale v0.1.0**',
          '',
          `- Model: \`${activeSettings.provider}/${activeSettings.model}\``,
          `- Session: \`${currentSession}\``,
          '',
          'Type `/help` for commands.'
        ].join('\n')
      )
      return
    }

    app.addEntry({
      role: 'system',
      content: [
        '**Previous session**',
        '',
        `- Session: \`${currentSession}\``,
        `- Model: \`${activeSettings.provider}/${activeSettings.model}\``
      ].join('\n'),
      timestamp: new Date()
    })

    const lastUser = lastMessageSummary(messages, 'user')
    const lastAssistant = lastMessageSummary(messages, 'assistant')

    if (lastUser) {
      app.addEntry({ role: 'user', content: lastUser, timestamp: new Date() })
    }
    if (lastAssistant) {
      app.addEntry({ role: 'assistant', content: lastAssistant, timestamp: new Date() })
    }
  }

  const switchToSession = (name: string): void => {
    saveSession(currentSession, messages)
    setCurrentSessionName(name)
    currentSession = name
    messages = loadSession(name)
    app.clearEntries()
    renderSessionOverview()
  }

  renderSessionOverview()

  app.focusInput()

  // ── Command handling ────────────────────────────────────────

  async function handleCommand(input: string): Promise<boolean> {
    const trimmed = input.trim()
    if (!trimmed.startsWith('/')) return false

    const [cmd, ...args] = trimmed.slice(1).split(/\s+/)

    switch (cmd) {
      case 'help':
        await runCapturedCommand(handleHelp)
        break

      case 'config':
        await runCapturedCommand(handleConfig)
        break

      case 'crypto':
        await runCapturedCommand(() => handleCrypto(args))
        break

      case 'qr':
      case 'qrcode':
        await runCapturedCommand(() => handleQRCode(args))
        break

      case 'uuid':
      case 'uuidv7':
        await runCapturedCommand(() => handleUUID(args))
        break

      case 'crawl':
        await runCapturedCommand(() => handleCrawl(args))
        break

      case 'clear':
        messages = []
        saveSession(currentSession, messages)
        app.clearEntries()
        addSystemEntry('Conversation cleared.')
        break

      case 'model':
        if (args[0]) {
          const s = getSettingsWithEnv()
          const fallbackProvider = modelOverride?.provider ?? s.provider
          const selection = resolveProviderAndModel(args[0], fallbackProvider)
          modelOverride = { ...modelOverride, provider: selection.provider, model: selection.model }
          app.addEntry({
            role: 'system',
            content: `Model set to **${selection.provider}/${selection.model}**`,
            timestamp: new Date()
          })
          app.setContextLabel(`${selection.provider}/${selection.model}`)
        } else {
          addSystemEntry('Usage: /model <model-id>')
        }
        break

      case 'prompt': {
        const sub = args[0]
        if (sub === 'list' || !sub) {
          await runCapturedCommand(handlePromptList)
        } else if (sub === 'use') {
          await runCapturedCommand(() => handlePromptUse(args.slice(1)))
        } else if (sub === 'show') {
          await runCapturedCommand(() => handlePromptShow(args.slice(1)))
        } else if (sub === 'remove') {
          await runCapturedCommand(() => handlePromptRemove(args.slice(1)))
        } else if (sub === 'add' || sub === 'set') {
          const name = args[1]
          const content = args.slice(2).join(' ').trim()
          if (!name || !content) {
            addSystemEntry(`Usage: /prompt ${sub} <name> <prompt text>`)
            break
          }
          addOrUpdatePreset(name, content)
          addSystemEntry(`${sub === 'add' ? 'Added/updated' : 'Updated'} preset: ${name}`)
        } else {
          addSystemEntry(`Unknown: /prompt ${sub}. Use: list, use, add, set, show, remove`)
        }
        break
      }

      case 'session': {
        const sub = args[0]
        if (sub === 'list' || !sub) {
          await runCapturedCommand(handleSessionList)
        } else if (sub === 'use') {
          const { output, result: name } = await captureCliOutput(() => handleSessionUse(args.slice(1)))
          if (name) switchToSession(name)
          if (output) addCommandOutput(output)
        } else if (sub === 'new') {
          const { output, result: name } = await captureCliOutput(() => handleSessionNew(args.slice(1)))
          if (name) switchToSession(name)
          if (output) addCommandOutput(output)
        } else if (sub === 'remove') {
          const { output, result: newCurrent } = await captureCliOutput(() => handleSessionRemove(args.slice(1)))
          if (newCurrent !== null) switchToSession(newCurrent)
          if (output) addCommandOutput(output)
        } else if (sub === 'current' || sub === 'show') {
          await runCapturedCommand(handleSessionCurrent)
        } else {
          addSystemEntry(`Unknown: /session ${sub}. Use: list, use, new, remove, current`)
        }
        break
      }

      case 'heartbeat':
        await runCapturedCommand(() => handleHeartbeat(args))
        break

      case 'tts': {
        const sub = (args[0] ?? '').toLowerCase()
        if (!sub) {
          addSystemEntry(`TTS: ${speechEnabled ? 'on' : 'off'} (${toTtsProviderLabel(getConfiguredTtsProvider())})\n${TTS_USAGE}`)
          break
        }
        if (sub === 'on') {
          speechEnabled = true
          addSystemEntry('Speech on')
          break
        }
        if (sub === 'off') {
          speechEnabled = false
          addSystemEntry('Speech off')
          break
        }
        if (sub === 'use') {
          const target = (args[1] ?? '').toLowerCase()
          const nextProvider: TtsProvider | null =
            target === 'melo'
              ? 'melo'
              : target === 'piper'
                ? 'piper'
                : target === 'rhasspy' || target === 'endpoint'
                  ? 'endpoint'
                  : null
          if (!nextProvider) {
            addSystemEntry('Usage: /tts use <rhasspy|piper|melo>')
            break
          }
          const nextSettings = loadSettings()
          nextSettings.ttsProvider = nextProvider
          saveSettings(nextSettings)
          addSystemEntry(`TTS provider set to ${toTtsProviderLabel(nextProvider)}`)
          break
        }
        if (sub === 'melo') {
          const endpoint = (args[1] ?? '').trim()
          if (!endpoint) {
            addSystemEntry(`meloTtsEndpoint: ${getMeloTtsEndpoint()}`)
            break
          }
          const nextSettings = loadSettings()
          nextSettings.meloTtsEndpoint = endpoint.replace(/\/+$/, '')
          saveSettings(nextSettings)
          addSystemEntry(`MeloTTS endpoint set to ${nextSettings.meloTtsEndpoint}`)
          break
        }
        if (sub === 'ls') {
          const activeProvider = getConfiguredTtsProvider()
          const providers = listTtsProviders()
          addSystemEntry(
            ['TTS providers:', ...providers.map((provider) => {
              const marker = provider.id === activeProvider ? '*' : ' '
              const status = provider.configured ? 'configured' : 'not configured'
              return `  ${marker} ${toTtsProviderLabel(provider.id).padEnd(8)} ${status} ${provider.detail}`
            })].join('\n')
          )
          break
        }
        if (sub === 'voice') {
          const targetVoice = (args[1] ?? '').trim()
          const shouldList = !targetVoice || targetVoice === 'list' || targetVoice === 'ls'
          const activeProvider = getConfiguredTtsProvider()
          if (activeProvider === 'melo') {
            if (shouldList) {
              const currentVoice = getMeloTtsVoiceId()
              const result = await fetchMeloTtsVoices()
              if (!result.items.length) {
                addSystemEntry(`No MeloTTS voices found. ${result.error ?? ''}`.trim())
                break
              }
              addSystemEntry(
                [
                  `MeloTTS endpoint: ${getMeloTtsEndpoint()}`,
                  ...(currentVoice ? [`Current voice: ${currentVoice}`] : []),
                  'Voices:',
                  ...result.items.map((voice) => {
                    const marker = voice.id === currentVoice ? '*' : ' '
                    const selector = getMeloTtsVoiceSelector(voice.id)
                    const label = voice.name && voice.name !== voice.id ? ` (${voice.name})` : ''
                    const suffix = selector === voice.id ? label : ` -> ${voice.id}${label}`
                    return ` ${marker} ${selector}${suffix}`
                  })
                ].join('\n')
              )
              break
            }
            const resolution = await resolveMeloTtsVoiceId(targetVoice)
            if (!resolution.ok || !resolution.voiceId) {
              addSystemEntry(`Error: ${resolution.error ?? 'Unable to resolve MeloTTS voice.'}`)
              break
            }
            const nextSettings = loadSettings()
            nextSettings.meloTtsVoiceId = resolution.voiceId
            saveSettings(nextSettings)
            addSystemEntry(
              resolution.selector && resolution.selector !== resolution.voiceId
                ? `MeloTTS voice set to ${resolution.voiceId}\nVoice selector: ${resolution.selector}`
                : `MeloTTS voice set to ${resolution.voiceId}`
            )
            break
          }

          const endpoint = getConfiguredTtsEndpoint()
          if (shouldList) {
            const currentVoice = getTtsVoiceIdFromEndpoint(endpoint)
            const result = await fetchTtsVoiceOptions(endpoint)
            if (!result.options.length) {
              addSystemEntry(`No voice options found. ${result.error ?? ''}`.trim())
              break
            }
            addSystemEntry(
              [
                `TTS endpoint: ${endpoint}`,
                ...(result.sourceUrl && result.method ? [`Source: ${result.method} ${result.sourceUrl}`] : []),
                ...(currentVoice ? [`Current voice: ${currentVoice}`] : []),
                'Voices:',
                ...result.options.map((option) => {
                  const marker = option.id === currentVoice ? '*' : ' '
                  const suffix = option.label && option.label !== option.id ? ` (${option.label})` : ''
                  return ` ${marker} ${option.id}${suffix}`
                })
              ].join('\n')
            )
            break
          }
          try {
            const nextEndpoint = withTtsVoice(endpoint, targetVoice)
            const nextSettings = loadSettings()
            nextSettings.ttsEndpoint = nextEndpoint
            saveSettings(nextSettings)
            addSystemEntry(`Voice set to ${targetVoice}\nttsEndpoint: ${nextEndpoint}`)
          } catch (error) {
            addSystemEntry(`Error: ${error instanceof Error ? error.message : String(error)}`)
          }
          break
        }
        if (sub === 'language') {
          const language = (args[1] ?? '').trim()
          const shouldList = !language || language === 'list' || language === 'ls'
          if (shouldList) {
            const currentLanguage = getMeloTtsLanguage()
            const result = await fetchMeloTtsLanguages()
            if (!result.items.length) {
              addSystemEntry(`No MeloTTS languages found. ${result.error ?? ''}`.trim())
              break
            }
            addSystemEntry(
              [
                `MeloTTS endpoint: ${getMeloTtsEndpoint()}`,
                `Current language: ${currentLanguage}`,
                'Languages:',
                ...result.items.map((item) => {
                  const marker = item.code === currentLanguage ? '*' : ' '
                  const suffix = item.speaker ? ` (${item.speaker})` : ''
                  return ` ${marker} ${item.code}${suffix}`
                })
              ].join('\n')
            )
            break
          }
          const nextSettings = loadSettings()
          nextSettings.meloTtsLanguage = language
          saveSettings(nextSettings)
          addSystemEntry(`MeloTTS language set to ${language}`)
          break
        }
        if (sub === 'speed') {
          const speedArg = (args[1] ?? '').trim()
          if (!speedArg) {
            addSystemEntry(`meloTtsSpeed: ${getMeloTtsSpeed()}`)
            break
          }
          const speed = Number.parseFloat(speedArg)
          if (!Number.isFinite(speed) || speed <= 0) {
            addSystemEntry('Usage: /tts speed <positive-number>')
            break
          }
          const nextSettings = loadSettings()
          nextSettings.meloTtsSpeed = speed
          saveSettings(nextSettings)
          addSystemEntry(`MeloTTS speed set to ${speed}`)
          break
        }
        addSystemEntry(TTS_USAGE)
        break
      }

      case 'stt':
        await runCapturedCommand(() => runSttCli(args))
        break

      case 'onboard':
        addSystemEntry('The onboarding wizard is interactive. Run `cale onboard` or use the regular REPL for `/onboard`.')
        break

      case 'exit':
      case 'quit':
        saveSession(currentSession, messages)
        app.destroy()
        process.exit(0)

      default:
        addSystemEntry(`Unknown command: /${cmd}. Type /help for available commands.`)
    }

    return true
  }

  // ── Submit handler ──────────────────────────────────────────

  app.onSubmit(async (value) => {
    if (isGenerating) return

    // Handle slash commands
    if (await handleCommand(value)) {
      app.focusInput()
      return
    }

    messages.push({ role: 'user', content: value })
    app.addEntry({ role: 'user', content: value, timestamp: new Date() })

    let streamedText = ''
    let pendingAssistantRender: ReturnType<typeof setTimeout> | null = null
    const flushAssistantRender = (): void => {
      pendingAssistantRender = null
      app.updateLastAssistant(streamedText || '🞄🞄🞄')
    }

    try {
      const model = resolveModel(modelOverride)
      abortController = new AbortController()
      abortNoticeShown = false
      isGenerating = true
      app.setGenerating(true)
      app.blurInput()

      const t0 = performance.now()

      // Add placeholder assistant entry for streaming

      app.addEntry({ role: 'assistant', content: '🞄🞄🞄', timestamp: new Date() })

      const { text: responseText, messages: newMessages } = await runAgent({
        model,
        messages,
        abortSignal: abortController.signal,
        onChunk: (chunk) => {
          streamedText += chunk
          if (!pendingAssistantRender) {
            pendingAssistantRender = setTimeout(flushAssistantRender, 33)
          }
        }
      })

      isGenerating = false
      abortController = null
      app.setGenerating(false)

      // Finalize the entry with the complete text
      const finalText = streamedText || responseText
      if (pendingAssistantRender) {
        clearTimeout(pendingAssistantRender)
        pendingAssistantRender = null
      }
      app.updateLastAssistant(finalText)

      // Append elapsed time
      const elapsed = ((performance.now() - t0) / 1000).toFixed(1)
      app.setLastAssistantElapsed(`${elapsed}s`)

      messages = newMessages
      saveSession(currentSession, messages)

      if (speechEnabled && responseText.trim()) {
        const provider = getConfiguredTtsProvider()
        void speakText(responseText, { provider }).catch(() => {})
      }
    } catch (err) {
      if (pendingAssistantRender) {
        clearTimeout(pendingAssistantRender)
        pendingAssistantRender = null
      }
      isGenerating = false
      abortController = null
      app.setGenerating(false)

      if (err instanceof Error && err.name === 'AbortError') {
        if (!abortNoticeShown) {
          app.addEntry({ role: 'system', content: '*(aborted)*', timestamp: new Date() })
        }
      } else {
        app.addEntry({
          role: 'system',
          content: `**Error:** ${err instanceof Error ? err.message : String(err)}`,
          timestamp: new Date()
        })
      }
    }

    app.focusInput()
  })

  // ── Abort handler ──────────────────────────────────────────

  app.onAbort(() => {
    if (isGenerating && abortController) {
      abortController.abort()
      app.addEntry({ role: 'system', content: '*(aborted)*', timestamp: new Date() })
      abortNoticeShown = true
      isGenerating = false
      abortController = null
      app.setGenerating(false)
      app.focusInput()
      return true
    }
    return false
  })

  // ── Exit handler ────────────────────────────────────────────

  app.onExit(() => {
    saveSession(currentSession, messages)
    app.destroy()
    process.exit(0)
  })

  // ── Approval callback ──────────────────────────────────────

  setApprovalCallback(async ({ tool, summary }) => {
    if (tool === 'speak') return true
    // For now, auto-approve in TUI mode
    // TODO: Add approval UI within the TUI
    return true
  })
}
