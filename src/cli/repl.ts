import type { ModelMessage } from 'ai'
import { statSync } from 'node:fs'
import { emitKeypressEvents } from 'node:readline'
import pc from 'picocolors'
import animations from 'unicode-animations'
import { resolveModel } from '../agent/config.ts'
import { runAgent } from '../agent/loop.ts'
import { resolveProviderAndModel } from '../agent/model-selection.ts'
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
  handlePromptAdd,
  handlePromptList,
  handlePromptRemove,
  handlePromptSet,
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
import { runOnboard } from './onboard.ts'
import { out } from './output.ts'
import { createReadline } from './readline.ts'
import { runSttCli, transcribeAudioFile } from './stt.ts'
import { fetchTtsVoiceOptions, getConfiguredTtsEndpoint, getTtsVoiceIdFromEndpoint, withTtsVoice } from './tts-voice.ts'
import { startVoiceRecording, type VoiceRecordingSession } from './voice-recorder.ts'

function question(rl: ReturnType<typeof createReadline>, query: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(query, resolve)
  })
}

function visibleWidth(text: string): number {
  const withoutAnsi = text.replace(/\x1b\[[0-9;]*m/g, '')
  return [...withoutAnsi].length
}
const ITALIC_DIM = '\x1b[2;3m' // dim + italic
const RESET = '\x1b[0m'
const FALLBACK_TTS_SPINNER = {
  frames: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
  interval: 80
}
const TTS_STATUS_SPINNER = animations.cascade ?? FALLBACK_TTS_SPINNER
const VOICE_HOTKEY = '\\'
const VOICE_CAPTURE_DURATION_MS = 5000
const VOICE_CAPTURE_DURATION_SECONDS = VOICE_CAPTURE_DURATION_MS / 1000
const TTS_USAGE =
  'Usage: /tts on | off | use <rhasspy|piper|melo> | melo [url] | voice [id|list] | language [code|list] | speed [number] | ls'

interface PromptRightIndicator {
  plain: string
  styled: string
}

function toTtsProviderLabel(provider: TtsProvider): string {
  return provider === 'endpoint' ? 'rhasspy' : provider
}

function makePrompt(): string {
  return `${pc.cyan('➜')} `
}

function printBanner(session: string): void {
  const settings = getSettingsWithEnv()
  out.write('\n')
  out.write(`  ${pc.bold(pc.cyan('cale'))} ${pc.dim('v0.1.0')}\n`)
  out.write(`  ${pc.dim('model')}  ${settings.provider}/${settings.model}\n`)
  out.write(`  ${pc.dim('session')} ${session}\n`)
  out.write(`  ${pc.dim('type')}   /help for commands\n`)
  out.write('\n')
}

export async function startRepl(rl?: ReturnType<typeof createReadline>): Promise<void> {
  const replRl = rl ?? createReadline(completer)
  const ttyLayout = Boolean(process.stdin.isTTY && process.stdout.isTTY)
  let currentSession: string = getCurrentSessionName() ?? 'default'
  let messages: ModelMessage[] = loadSession(currentSession)
  let modelOverride: { provider?: Provider; model?: string } | undefined
  let speechEnabled = false
  let voiceRecording: VoiceRecordingSession | null = null
  let voiceActionInFlight = false
  let voiceHotkeyTimer: ReturnType<typeof setTimeout> | null = null
  let voiceCaptureTimer: ReturnType<typeof setTimeout> | null = null
  let resolveVoiceCaptureWindow: (() => void) | null = null
  let abortController: AbortController | null = null
  let isGenerating = false
  let ttsServiceWaiting = false
  let ttsSpinnerFrame = 0
  let ttsSpinnerTimer: ReturnType<typeof setInterval> | null = null
  let promptActive = false

  const clearConsole = (): void => {
    if (!ttyLayout) return
    out.write('\x1b[2J\x1b[H')
  }

  const placeInputAtBottom = (): void => {
    if (!ttyLayout) return
    const rows = process.stdout.rows ?? 24
    out.write(`\x1b[${rows};1H\x1b[2K`)
  }

  const buildTtsIndicator = (): PromptRightIndicator => {
    const provider = getConfiguredTtsProvider()
    const providerLabel = toTtsProviderLabel(provider)
    const icon = !speechEnabled
      ? '○'
      : ttsServiceWaiting
        ? (TTS_STATUS_SPINNER.frames[ttsSpinnerFrame % TTS_STATUS_SPINNER.frames.length] ?? '⠋')
        : '●'
    const plain = `${icon} ${providerLabel}`
    const styled = !speechEnabled ? pc.dim(plain) : ttsServiceWaiting ? pc.yellow(plain) : pc.green(plain)
    return { plain, styled }
  }

  const renderRightIndicator = (): void => {
    if (!ttyLayout || !promptActive) return
    const indicator = buildTtsIndicator()
    const rightWidth = visibleWidth(indicator.plain)
    const columns = process.stdout.columns ?? 80
    const rightCol = Math.max(1, columns - rightWidth)
    out.write(`\x1b[s\x1b[${rightCol}G${indicator.styled}\x1b[K\x1b[u`)
  }

  const stopTtsIndicatorSpinner = (): void => {
    ttsServiceWaiting = false
    if (ttsSpinnerTimer) {
      clearInterval(ttsSpinnerTimer)
      ttsSpinnerTimer = null
    }
    ttsSpinnerFrame = 0
    renderRightIndicator()
  }

  const setTtsServiceWaiting = (waiting: boolean): void => {
    if (ttsServiceWaiting === waiting) return
    ttsServiceWaiting = waiting
    if (!ttyLayout) return
    if (waiting) {
      if (!ttsSpinnerTimer) {
        ttsSpinnerTimer = setInterval(() => {
          ttsSpinnerFrame = (ttsSpinnerFrame + 1) % TTS_STATUS_SPINNER.frames.length
          renderRightIndicator()
        }, TTS_STATUS_SPINNER.interval)
      }
      renderRightIndicator()
      return
    }
    stopTtsIndicatorSpinner()
  }

  const clearVoiceCaptureWindow = (): void => {
    if (voiceCaptureTimer) {
      clearTimeout(voiceCaptureTimer)
      voiceCaptureTimer = null
    }
    if (resolveVoiceCaptureWindow) {
      const resolve = resolveVoiceCaptureWindow
      resolveVoiceCaptureWindow = null
      resolve()
    }
  }

  const waitForVoiceCaptureWindow = (): Promise<void> =>
    new Promise((resolve) => {
      resolveVoiceCaptureWindow = () => {
        resolveVoiceCaptureWindow = null
        resolve()
      }
      voiceCaptureTimer = setTimeout(() => {
        const done = resolveVoiceCaptureWindow
        voiceCaptureTimer = null
        resolveVoiceCaptureWindow = null
        done?.()
      }, VOICE_CAPTURE_DURATION_MS)
    })

  const ask = async (query: string): Promise<string> => {
    placeInputAtBottom()
    promptActive = true
    try {
      const pending = question(replRl, query)
      setImmediate(renderRightIndicator)
      return await pending
    } finally {
      promptActive = false
    }
  }

  clearConsole()
  printBanner(currentSession)

  function switchToSession(name: string): void {
    saveSession(currentSession, messages)
    setCurrentSessionName(name)
    currentSession = name
    messages = loadSession(name)
  }

  setApprovalCallback(async ({ tool, summary }) => {
    if (tool === 'speak' && speechEnabled) return true
    out.spinner.stop()
    const prompt = `  ${pc.yellow('?')} ${pc.cyan(summary)} ${pc.dim('[y/n]')}: `
    const answer = await ask(prompt)
    return answer.toLowerCase().startsWith('y')
  })

  const onKeypress = (str: string, key?: { name?: string; ctrl?: boolean; meta?: boolean; shift?: boolean }): void => {
    if (!process.stdin.isTTY) return
    if (key?.ctrl || key?.meta || key?.shift) return
    if (str !== VOICE_HOTKEY) return

    if (voiceActionInFlight || isGenerating) return

    if (voiceHotkeyTimer) clearTimeout(voiceHotkeyTimer)
    voiceHotkeyTimer = setTimeout(() => {
      voiceHotkeyTimer = null
      if (voiceActionInFlight || isGenerating || voiceRecording) return
      if ((replRl as unknown as { line?: string }).line !== VOICE_HOTKEY) return

      voiceActionInFlight = true
      // Remove the literal hotkey before injecting transcript.
      replRl.write('', { ctrl: true, name: 'u' })
      replRl.pause()
      out.write('\n')

      void (async () => {
        let active: VoiceRecordingSession | null = null
        try {
          active = await startVoiceRecording({
            onReady: () => {
              out.spinner.start(`Ϙ `)
            }
          })
          voiceRecording = active

          await waitForVoiceCaptureWindow()
          if (voiceRecording !== active) return
          out.spinner.stop()
          await active.stop()
          let fileSize = 0
          try {
            fileSize = statSync(active.filePath).size
          } catch {
            /* ignore */
          }
          const minBytesForFiveSec = 50_000
          if (fileSize < minBytesForFiveSec) {
            out.spinner.stop()
            out.error(
              'No audio captured (file too small). Check microphone, input device, and permissions (e.g. Terminal → Input).'
            )
            return
          }

          const transcript = await transcribeAudioFile({
            filePath: active.filePath
          })
          const text = transcript.trim()
          if (!text) {
            out.spinner.stop()
            out.error(
              'Voice transcription was empty. Audio was captured but nothing was recognized. Try speaking clearly or check CALE_WHISPER_CLI.'
            )
            return
          }
          out.spinner.stop()
          replRl.resume()
          replRl.write('✦ ' + text)
          replRl.write('\n')
        } catch (error) {
          out.spinner.stop()
          out.error(error instanceof Error ? error.message : String(error))
        } finally {
          out.spinner.stop()
          clearVoiceCaptureWindow()
          if (active && voiceRecording === active) {
            voiceRecording = null
          }
          if (active) {
            try {
              active.cleanup()
            } catch {
              /* ignore */
            }
          }
          replRl.resume()
          voiceActionInFlight = false
        }
      })()
    }, 180)
  }

  if (process.stdin.isTTY) {
    emitKeypressEvents(process.stdin, replRl)
    process.stdin.on('keypress', onKeypress)
  }

  replRl.on('SIGINT', () => {
    stopTtsIndicatorSpinner()
    if (voiceHotkeyTimer) {
      clearTimeout(voiceHotkeyTimer)
      voiceHotkeyTimer = null
    }
    clearVoiceCaptureWindow()

    if (voiceRecording) {
      const active = voiceRecording
      voiceRecording = null
      voiceActionInFlight = true
      out.spinner.stop()
      out.write('\n')
      void active
        .stop()
        .catch(() => {})
        .finally(() => {
          try {
            active.cleanup()
          } catch {
            /* ignore */
          }
          replRl.resume()
          voiceActionInFlight = false
        })
      out.write(pc.dim('  (recording cancelled)\n\n'))
      return
    }

    if (isGenerating && abortController) {
      abortController.abort()
      out.spinner.stop()
      out.write('\n')
      out.write(pc.dim('  (aborted)\n\n'))
      isGenerating = false
      return
    }
    stopTtsIndicatorSpinner()
    out.write('\n')
    if (process.stdin.isTTY) {
      process.stdin.off('keypress', onKeypress)
    }
    replRl.close()
    process.exit(0)
  })

  for (;;) {
    const input = await ask(makePrompt())
    const trimmed = input.trim()
    if (!trimmed) continue

    if (trimmed.startsWith('/')) {
      const [cmd, ...args] = trimmed.slice(1).split(/\s+/)
      switch (cmd) {
        case 'help':
          handleHelp()
          break
        case 'config':
          handleConfig()
          break
        case 'crypto':
          await handleCrypto(args)
          break
        case 'qr':
        case 'qrcode':
          await handleQRCode(args)
          break
        case 'uuid':
        case 'uuidv7':
          handleUUID(args)
          break
        case 'crawl':
          await handleCrawl(args.slice(1))
          break
        case 'align':
          out.println('/align is only available in the TUI.')
          break
        case 'onboard':
          await runOnboard(replRl)
          break
        case 'model':
          if (args[0]) {
            const settings = getSettingsWithEnv()
            const fallbackProvider = modelOverride?.provider ?? settings.provider
            const selection = resolveProviderAndModel(args[0], fallbackProvider)
            modelOverride = { ...modelOverride, provider: selection.provider, model: selection.model }
            out.successLine(`Model set to ${selection.provider}/${selection.model}`)
          } else {
            out.error('Usage: /model <model-id>')
          }
          break
        case 'tts': {
          const sub = (args[0] ?? '').toLowerCase()
          if (!sub) {
            out.println(`TTS: ${speechEnabled ? 'on' : 'off'} (${toTtsProviderLabel(getConfiguredTtsProvider())})`)
            out.println(TTS_USAGE)
            break
          }
          if (sub === 'on') {
            speechEnabled = true
            renderRightIndicator()
            out.successLine('Speech on')
            break
          }
          if (sub === 'off') {
            speechEnabled = false
            setTtsServiceWaiting(false)
            renderRightIndicator()
            out.successLine('Speech off')
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
              out.error('Usage: /tts use <rhasspy|piper|melo>')
              break
            }
            const settings = loadSettings()
            settings.ttsProvider = nextProvider
            saveSettings(settings)
            renderRightIndicator()
            out.successLine(`TTS provider set to ${toTtsProviderLabel(nextProvider)}`)
            if (process.env.CALE_TTS_PROVIDER) {
              out.warnLine('CALE_TTS_PROVIDER is set and overrides config for this session.')
            }
            const activeProvider = getConfiguredTtsProvider()
            if (activeProvider !== nextProvider) {
              out.warnLine(`Active provider remains ${toTtsProviderLabel(activeProvider)} due to env override.`)
            }
            break
          }
          if (sub === 'melo') {
            const endpoint = (args[1] ?? '').trim()
            if (!endpoint) {
              out.println(`meloTtsEndpoint: ${getMeloTtsEndpoint()}`)
              break
            }
            const settings = loadSettings()
            settings.meloTtsEndpoint = endpoint.replace(/\/+$/, '')
            saveSettings(settings)
            out.successLine(`MeloTTS endpoint set to ${settings.meloTtsEndpoint}`)
            if (process.env.CALE_MELO_TTS_ENDPOINT || process.env.MELO_TTS_ENDPOINT) {
              out.warnLine('MeloTTS endpoint env var is set and overrides config for this session.')
            }
            break
          }
          if (sub === 'ls') {
            const activeProvider = getConfiguredTtsProvider()
            const providers = listTtsProviders()
            out.println('TTS providers:')
            for (const provider of providers) {
              const marker = provider.id === activeProvider ? '*' : ' '
              const status = provider.configured ? pc.green('configured') : pc.yellow('not configured')
              const providerLabel = toTtsProviderLabel(provider.id)
              out.println(`  ${marker} ${providerLabel.padEnd(8)} ${status} ${pc.dim(provider.detail)}`)
            }
            break
          }
          if (sub === 'voice') {
            const targetVoice = (args[1] ?? '').trim()
            const shouldList = !targetVoice || targetVoice === 'list' || targetVoice === 'ls'
            const activeProvider = getConfiguredTtsProvider()

            if (activeProvider === 'melo') {
              if (shouldList) {
                const result = await fetchMeloTtsVoices()
                if (!result.items.length) {
                  out.error(`No MeloTTS voices found. ${result.error ?? ''}`.trim())
                  break
                }
                const currentVoice = getMeloTtsVoiceId()
                out.println(`MeloTTS endpoint: ${getMeloTtsEndpoint()}`)
                if (currentVoice) out.println(`Current voice: ${currentVoice}`)
                out.println('Voices:')
                for (const voice of result.items) {
                  const marker = voice.id === currentVoice ? '*' : ' '
                  const selector = getMeloTtsVoiceSelector(voice.id)
                  const label = voice.name && voice.name !== voice.id ? ` (${voice.name})` : ''
                  const suffix = selector === voice.id ? label : ` -> ${voice.id}${label}`
                  out.println(` ${marker} ${selector}${suffix}`)
                }
                break
              }

              const resolution = await resolveMeloTtsVoiceId(targetVoice)
              if (!resolution.ok || !resolution.voiceId) {
                out.error(resolution.error ?? 'Unable to resolve MeloTTS voice.')
                break
              }
              const settings = loadSettings()
              settings.meloTtsVoiceId = resolution.voiceId
              saveSettings(settings)
              out.successLine(`MeloTTS voice set to ${resolution.voiceId}`)
              if (resolution.selector && resolution.selector !== resolution.voiceId) {
                out.println(`Voice selector: ${resolution.selector}`)
              }
              if (process.env.CALE_MELO_TTS_VOICE_ID || process.env.MELO_TTS_VOICE_ID) {
                out.warnLine('MeloTTS voice env var is set and overrides config for this session.')
              }
              break
            }

            const endpoint = getConfiguredTtsEndpoint()

            if (shouldList) {
              const currentVoice = getTtsVoiceIdFromEndpoint(endpoint)
              const result = await fetchTtsVoiceOptions(endpoint)
              if (!result.options.length) {
                out.error(`No voice options found. ${result.error ?? ''}`.trim())
                break
              }
              out.println(`TTS endpoint: ${endpoint}`)
              if (result.sourceUrl && result.method) {
                out.println(`Source: ${result.method} ${result.sourceUrl}`)
              }
              if (currentVoice) out.println(`Current voice: ${currentVoice}`)
              out.println('Voices:')
              for (const option of result.options) {
                const marker = option.id === currentVoice ? '*' : ' '
                const suffix = option.label && option.label !== option.id ? ` (${option.label})` : ''
                out.println(` ${marker} ${option.id}${suffix}`)
              }
              break
            }

            try {
              const nextEndpoint = withTtsVoice(endpoint, targetVoice)
              const settings = loadSettings()
              settings.ttsEndpoint = nextEndpoint
              saveSettings(settings)
              out.successLine(`Voice set to ${targetVoice}`)
              out.println(`ttsEndpoint: ${nextEndpoint}`)
              if (process.env.CALE_TTS_ENDPOINT) {
                out.warnLine('CALE_TTS_ENDPOINT is set and overrides config for this session.')
              }
            } catch (error) {
              out.error(error instanceof Error ? error.message : String(error))
            }
            break
          }
          if (sub === 'language') {
            const language = (args[1] ?? '').trim()
            const shouldList = !language || language === 'list' || language === 'ls'
            if (shouldList) {
              const result = await fetchMeloTtsLanguages()
              if (!result.items.length) {
                out.error(`No MeloTTS languages found. ${result.error ?? ''}`.trim())
                break
              }
              const currentLanguage = getMeloTtsLanguage()
              out.println(`MeloTTS endpoint: ${getMeloTtsEndpoint()}`)
              out.println(`Current language: ${currentLanguage}`)
              out.println('Languages:')
              for (const item of result.items) {
                const marker = item.code === currentLanguage ? '*' : ' '
                const suffix = item.speaker ? ` (${item.speaker})` : ''
                out.println(` ${marker} ${item.code}${suffix}`)
              }
              break
            }

            const settings = loadSettings()
            settings.meloTtsLanguage = language
            saveSettings(settings)
            out.successLine(`MeloTTS language set to ${language}`)
            break
          }
          if (sub === 'speed') {
            const speedArg = (args[1] ?? '').trim()
            if (!speedArg) {
              out.println(`meloTtsSpeed: ${getMeloTtsSpeed()}`)
              break
            }
            const speed = Number.parseFloat(speedArg)
            if (!Number.isFinite(speed) || speed <= 0) {
              out.error('Usage: /tts speed <positive-number>')
              break
            }
            const settings = loadSettings()
            settings.meloTtsSpeed = speed
            saveSettings(settings)
            out.successLine(`MeloTTS speed set to ${speed}`)
            break
          }
          out.error(TTS_USAGE)
          break
        }
        case 'stt':
          try {
            await runSttCli(args)
          } catch (error) {
            out.error(error instanceof Error ? error.message : String(error))
          }
          break
        case 'clear':
          messages = []
          saveSession(currentSession, messages)
          clearConsole()
          printBanner(currentSession)
          out.successLine('Conversation cleared')
          break
        case 'prompt': {
          const sub = args[0]
          if (sub === 'list' || !sub) {
            handlePromptList()
          } else if (sub === 'use') {
            handlePromptUse(args.slice(1))
          } else if (sub === 'show') {
            handlePromptShow(args.slice(1))
          } else if (sub === 'remove') {
            handlePromptRemove(args.slice(1))
          } else if (sub === 'add') {
            await handlePromptAdd(args.slice(1), replRl)
          } else if (sub === 'set') {
            await handlePromptSet(args.slice(1), replRl)
          } else {
            out.error(`Unknown: /prompt ${sub}. Use: list, use, add, set, show, remove`)
          }
          break
        }
        case 'session': {
          const sub = args[0]
          if (sub === 'list' || !sub) {
            handleSessionList()
          } else if (sub === 'use') {
            const name = handleSessionUse(args.slice(1))
            if (name) switchToSession(name)
          } else if (sub === 'new') {
            const name = handleSessionNew(args.slice(1))
            if (name) switchToSession(name)
          } else if (sub === 'remove') {
            const newCurrent = handleSessionRemove(args.slice(1))
            if (newCurrent !== null) switchToSession(newCurrent)
          } else if (sub === 'current' || sub === 'show') {
            handleSessionCurrent()
          } else {
            out.error(`Unknown: /session ${sub}. Use: list, use, new, remove, current`)
          }
          break
        }
        case 'heartbeat':
          await handleHeartbeat(args)
          break
        case 'exit':
          if (voiceHotkeyTimer) {
            clearTimeout(voiceHotkeyTimer)
            voiceHotkeyTimer = null
          }
          clearVoiceCaptureWindow()
          if (process.stdin.isTTY) {
            process.stdin.off('keypress', onKeypress)
          }
          stopTtsIndicatorSpinner()
          saveSession(currentSession, messages)
          replRl.close()
          process.exit(0)
        default:
          out.error(`Unknown command: /${cmd}`)
      }
      continue
    }

    messages.push({ role: 'user', content: trimmed })
    const gestureRegex = /\*([^*]+)\*/g

    try {
      const model = resolveModel(modelOverride)
      abortController = new AbortController()
      isGenerating = true
      const t0 = performance.now()
      let firstChunk = true
      let buffer = ''
      out.spinner.start('')

      const { text: responseText, messages: newMessages } = await runAgent({
        model,
        messages,
        abortSignal: abortController.signal,
        onChunk: (chunk: string) => {
          if (firstChunk) {
            out.spinner.stop()
            out.write('\n ')
            firstChunk = false
          }

          buffer += chunk

          // Process all complete *gesture* blocks and plain text between them
          let searchFrom = 0
          while (true) {
            const openIdx = buffer.indexOf('*', searchFrom)
            if (openIdx === -1) break

            const closeIdx = buffer.indexOf('*', openIdx + 1)
            if (closeIdx === -1) break // gesture not yet complete — keep buffering

            // Flush any plain text before the gesture
            const before = buffer.slice(searchFrom, openIdx)
            if (before) out.write(before)

            // Write the gesture italic + dimmed on its own line
            const gesture = buffer.slice(openIdx, closeIdx + 1)
            out.write(`${ITALIC_DIM}${gesture.replaceAll('*', ' ')}${RESET}\n`)

            searchFrom = closeIdx + 1
          }

          // Keep only the unprocessed tail (may contain an incomplete gesture)
          buffer = buffer.slice(searchFrom)

          // Flush plain text that can't possibly be part of a gesture yet
          // (i.e. no opening * is lurking in the buffer)
          const pendingOpen = buffer.indexOf('*')
          if (pendingOpen === -1) {
            // No gesture opening in sight — safe to flush everything
            out.write(buffer)
            buffer = ''
          }
          // Otherwise hold the buffer until the closing * arrives
        }
      })

      // Flush any remaining buffer (e.g. plain text at end of response)
      if (buffer) out.write(buffer)

      isGenerating = false
      abortController = null
      if (firstChunk) out.spinner.stop()
      messages = newMessages
      saveSession(currentSession, messages)
      out.write(out.elapsed(performance.now() - t0))
      out.write('\n\n')

      if (speechEnabled && responseText.trim()) {
        const provider = getConfiguredTtsProvider()
        void speakText(responseText, {
          provider,
          onServiceWaitChange: setTtsServiceWaiting
        }).catch(() => {
          setTtsServiceWaiting(false)
        })
      }
    } catch (err) {
      isGenerating = false
    }
  }
}
