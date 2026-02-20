import type { ModelMessage } from 'ai'
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
  handleConfig,
  handleHeartbeat,
  handleHelp,
  handlePromptAdd,
  handlePromptList,
  handlePromptRemove,
  handlePromptSet,
  handlePromptShow,
  handlePromptUse,
  handleSessionCurrent,
  handleSessionList,
  handleSessionNew,
  handleSessionRemove,
  handleSessionUse
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

const FALLBACK_TTS_SPINNER = {
  frames: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
  interval: 80
}
const TTS_STATUS_SPINNER = animations.cascade ?? FALLBACK_TTS_SPINNER
const VOICE_HOTKEY = '\\'
const VOICE_CAPTURE_DURATION_MS = 5000
const VOICE_CAPTURE_DURATION_SECONDS = VOICE_CAPTURE_DURATION_MS / 1000

interface PromptRightIndicator {
  plain: string
  styled: string
}

function toTtsProviderLabel(provider: TtsProvider): string {
  return provider === 'endpoint' ? 'moody' : 'piper'
}

function makePrompt(): string {
  return `${pc.green('➜')} `
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
          out.println('Starting recorder...')
          active = await startVoiceRecording({
            onReady: () => {
              out.successLine(`Ready to record. Capturing for ${VOICE_CAPTURE_DURATION_SECONDS} seconds...`)
            }
          })
          voiceRecording = active
          out.println(`Recording via ${active.recorder}.`)
          await waitForVoiceCaptureWindow()
          if (voiceRecording !== active) return
          out.println('Stopping recording...')
          await active.stop()
          out.println('Transcribing...')
          const transcript = await transcribeAudioFile({
            filePath: active.filePath
          })
          const text = transcript.trim()
          if (!text) {
            out.error('Voice transcription was empty.')
            return
          }
          out.successLine('Voice captured. Sending...')
          replRl.resume()
          replRl.write(text)
          replRl.write('\n')
        } catch (error) {
          out.error(error instanceof Error ? error.message : String(error))
        } finally {
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
            out.println('Usage: /tts on | off | use <moody|piper> | voice [id|list] | ls')
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
              target === 'piper' ? 'piper' : target === 'moody' || target === 'endpoint' ? 'endpoint' : null
            if (!nextProvider) {
              out.error('Usage: /tts use <moody|piper>')
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
          out.error('Usage: /tts on | off | use <moody|piper> | voice [id|list] | ls')
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

    try {
      const model = resolveModel(modelOverride)
      abortController = new AbortController()
      isGenerating = true
      const t0 = performance.now()
      let firstChunk = true

      out.spinner.start('thinking')

      const { text: responseText, messages: newMessages } = await runAgent({
        model,
        messages,
        abortSignal: abortController.signal,
        onChunk: (chunk) => {
          if (firstChunk) {
            out.spinner.stop()
            out.write('\n')
            firstChunk = false
          }
          out.write(chunk)
        }
      })

      isGenerating = false
      abortController = null

      if (firstChunk) out.spinner.stop()

      messages = newMessages
      saveSession(currentSession, messages)
      out.write('\n')
      out.elapsed(performance.now() - t0)
      out.write('\n')

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
      abortController = null
      out.spinner.stop()
      if (err instanceof Error && err.name === 'AbortError') continue
      out.error(err instanceof Error ? err.message : String(err))
    }
  }
}
