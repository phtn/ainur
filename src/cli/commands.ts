import pc from 'picocolors'
import { existsSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { crawlCodebase, formatCrawlReport, parseCrawlArgs } from '../../core/crawler/index.ts'
import { analyzeDeadCode, formatDeadCodeReport } from '../../core/crawler/dead-code.ts'
import {
  addOrUpdatePreset,
  DEFAULT_SYSTEM_PROMPT,
  getPresetContent,
  listPresets,
  removePreset,
  setActivePreset
} from '../config/prompts.ts'
import {
  deleteSession,
  ensureSession,
  getCurrentSessionName,
  listSessions,
  loadSession,
  setCurrentSessionName
} from '../config/sessions.ts'
import { loadSettings } from '../config/settings.ts'
import { resolveWorkspacePath } from '../config/workspace.ts'
import {
  getHeartbeatStatus,
  runHeartbeatOnce,
  startHeartbeatDaemon,
  stopHeartbeatDaemon
} from '../services/heartbeat.ts'
import {
  getLaunchdStatus,
  installHeartbeatLaunchd,
  readHeartbeatLaunchdPlist,
  uninstallHeartbeatLaunchd
} from '../services/launchd.ts'
import { requestApproval } from '../tools/approval.ts'
import { fetchCryptoSnapshot, renderCryptoSnapshot } from '../tools/crypto.ts'
import { generateQRCode } from '../tools/qrcode.ts'
import { generateUUIDv7 } from '../tools/uuid.ts'
import { tools } from '../tools/index.ts'
import { out } from './output.ts'
import type { createReadline } from './readline.ts'

export function handleHelp(): void {
  const c = (s: string) => pc.cyan(s)
  const d = (s: string) => pc.dim(s)
  out.write(`
  ${pc.bold('Commands')}
  ${c('/help')}     ${d('Show this help')}
  ${c('/config')}   ${d('Show provider and model')}
  ${c('/crypto')}   ${d('Show crypto market data')} ${d('(/crypto | /crypto BTC)')}
  ${c('/qr')}       ${d('Generate a QR code')} ${d('(/qr <url|address|text> | /qrcode <...>)')}
  ${c('/uuid')}     ${d('Generate UUIDv7 values')} ${d('(/uuid [count] | /uuidv7 [count])')}
  ${c('/crawl')}    ${d('Dead code analysis')} ${d('([<dir>] | <symbol> [--root path] [--git-url url])')}
  ${c('/align')}    ${d('TUI user message alignment')} ${d('(left, right, toggle)')}
  ${c('/model')}    ${d('Switch model')} ${d('(/model list | /model 3 | /model cohere/command-a-plus-05-2026)')}
  ${c('/prompt')}   ${d('Manage system prompts')} ${d('(list, use, add, set, show, remove)')}
  ${c('/session')}  ${d('Manage conversations')} ${d('(list, use, new, remove, current)')}
  ${c('/heartbeat')} ${d('Heartbeat service')} ${d('(status, start, stop, once, launchd)')}
  ${c('/tts')}      ${d('Text-to-speech controls')} ${d('(on, off, use, melo, voice, language, speed, ls)')}
  ${c('/stt')}      ${d('Transcribe audio file')} ${d('(/stt [audio-file])')}
  ${c('\\')}         ${d('Record voice (5s capture + auto-send)')}
  ${c('/onboard')}  ${d('Re-run setup wizard')}
  ${c('/clear')}    ${d('Clear conversation')}
  ${c('/exit')}     ${d('Quit')}

  ${pc.bold('Tools')} ${d(Object.keys(tools).join(', '))}
`)
}

export async function handleQRCode(args: string[]): Promise<void> {
  const input = args.join(' ')
  if (!input) {
    out.error('Usage: /qr <url|address|text>')
    return
  }

  try {
    const result = await generateQRCode(input)
    out.write(`\n${result.qrCode}\n`)
    out.println(result.payload)
  } catch (error) {
    out.error(error instanceof Error ? error.message : String(error))
  }
}

export async function handleCrypto(args: string[]): Promise<void> {
  const ticker = args[0]

  try {
    const snapshot = await fetchCryptoSnapshot(ticker)
    out.write(renderCryptoSnapshot(snapshot))
  } catch (error) {
    out.error(error instanceof Error ? error.message : String(error))
  }
}

export function handleUUID(args: string[]): void {
  const rawCount = args[0]
  const count = rawCount ? Number.parseInt(rawCount, 10) : 1
  if (!Number.isInteger(count) || count < 1 || count > 100) {
    out.error('Usage: /uuid [count]')
    return
  }

  const uuids = generateUUIDv7(count)
  for (const id of uuids) {
    out.println(id)
  }
}

export function handleConfig(): void {
  const s = loadSettings()
  out.println(`provider: ${s.provider}`)
  out.println(`model: ${s.model}`)
  out.println(`ttsProvider: ${s.ttsProvider ?? 'endpoint'}`)
  if (s.ttsModel) out.println(`ttsModel: ${s.ttsModel}`)
  if (s.ttsEndpoint) out.println(`ttsEndpoint: ${s.ttsEndpoint}`)
  if (s.meloTtsEndpoint) out.println(`meloTtsEndpoint: ${s.meloTtsEndpoint}`)
  if (s.meloTtsVoiceId) out.println(`meloTtsVoiceId: ${s.meloTtsVoiceId}`)
  if (s.meloTtsLanguage) out.println(`meloTtsLanguage: ${s.meloTtsLanguage}`)
  if (typeof s.meloTtsSpeed === 'number') out.println(`meloTtsSpeed: ${s.meloTtsSpeed}`)
  out.println(`sttProvider: ${s.sttProvider ?? 'endpoint'}`)
  if (s.sttEndpoint) out.println(`sttEndpoint: ${s.sttEndpoint}`)
  out.println(`soulAlignment: ${s.soulAlignment !== false ? 'true' : 'false'}`)
  if (typeof s.soulTemperature === 'number') {
    out.println(`soulTemperature: ${s.soulTemperature}`)
  }
  out.println(`gatewayEnabled: ${s.gatewayEnabled !== false ? 'true' : 'false'}`)
  out.println(`gatewayAutoStart: ${s.gatewayAutoStart !== false ? 'true' : 'false'}`)
  if (typeof s.gatewayPort === 'number') out.println(`gatewayPort: ${s.gatewayPort}`)
  if (s.gatewayBind) out.println(`gatewayBind: ${s.gatewayBind}`)
  if (s.gatewayToken) out.println('gatewayToken: ***')
}

export function handlePromptList(): void {
  const { active, presets } = listPresets()
  const names = Object.keys(presets)
  if (names.length === 0) {
    out.println('No custom prompts. Using built-in default.')
    out.println('Add one with: /prompt add <name>')
    return
  }
  out.println('System prompt presets:')
  for (const name of names) {
    const marker = active === name ? ' *' : ''
    out.println(`  ${name}${marker}`)
  }
  if (active) {
    out.println(`\nActive: ${active}`)
  }
}

export function handlePromptUse(args: string[]): void {
  const name = args[0]
  if (!name) {
    out.error('Usage: /prompt use <name>')
    return
  }
  try {
    setActivePreset(name)
    out.println(`Using system prompt: ${name}`)
  } catch (e) {
    out.error(e instanceof Error ? e.message : String(e))
  }
}

export function handlePromptShow(args: string[]): void {
  const name = args[0]
  const { active, presets } = listPresets()
  const target = name ?? active
  if (target) {
    const content = presets[target]
    if (content) {
      out.println(`--- ${target} ---`)
      out.println(content)
      return
    }
  }
  if (!name && !active) {
    out.println('--- built-in default ---')
    out.println(DEFAULT_SYSTEM_PROMPT)
    return
  }
  out.error(name ? `Preset "${name}" not found.` : 'No active preset.')
}

export function handlePromptRemove(args: string[]): void {
  const name = args[0]
  if (!name) {
    out.error('Usage: /prompt remove <name>')
    return
  }
  try {
    removePreset(name)
    out.println(`Removed preset: ${name}`)
  } catch (e) {
    out.error(e instanceof Error ? e.message : String(e))
  }
}

function isDirectory(p: string): boolean {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

function firstPositional(args: string[]): string | undefined {
  for (const arg of args) {
    if (!arg.startsWith('-')) return arg
  }
  return undefined
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag)
}

export async function handleCrawl(args: string[]): Promise<void> {
  const json = hasFlag(args, '--json')
  const positional = firstPositional(args)

  // -- Dead code mode: /crawl <directory> [--json]
  // Triggered when the first positional arg is an existing directory,
  // or when no args are given (defaults to cwd), or --dead-code flag is set.
  const deadCodeMode =
    hasFlag(args, '--dead-code') ||
    args.length === 0 ||
    (positional !== undefined && !positional.startsWith('--') && isDirectory(resolve(positional)))

  if (deadCodeMode) {
    const dir = positional ? resolve(positional) : resolveWorkspacePath('.')
    if (!existsSync(dir) || !isDirectory(dir)) {
      out.error(`Not a directory: ${dir}`)
      out.error('Usage: /crawl [<directory>] [--json]')
      return
    }
    try {
      out.write(`Scanning ${dir} for dead code...\n`)
      const result = analyzeDeadCode(dir)
      if (json) {
        out.write(`${JSON.stringify(result, null, 2)}\n`)
        return
      }
      out.write(`\n${formatDeadCodeReport(result)}\n`)
    } catch (error) {
      out.error(error instanceof Error ? error.message : String(error))
    }
    return
  }

  // -- Symbol search mode: /crawl <symbol> [--root <path>] [--git-url <url>] ...
  if (!positional) {
    out.error('Usage:')
    out.error('  /crawl <directory>           — dead code analysis')
    out.error('  /crawl <symbol> [--root dir] — find where symbol is used')
    out.error('  /crawl <symbol> --git-url <url>')
    return
  }

  const parsed = parseCrawlArgs(args)
  const target = parsed.target.trim()
  const gitUrl = parsed.gitUrl?.trim() || undefined
  const gitRef = parsed.gitRef?.trim() || undefined
  const root = parsed.root?.trim() || '.'

  if (gitUrl) {
    const source = gitRef ? `${gitUrl}#${gitRef}` : gitUrl
    const approved = await requestApproval('crawl_codebase', `Clone ${source} and scan for "${target}"`)
    if (!approved) {
      out.warnLine('User declined')
      return
    }
  }

  try {
    const result = gitUrl
      ? crawlCodebase({ target, gitUrl, gitRef })
      : crawlCodebase({ target, root: resolveWorkspacePath(root) })

    if (json) {
      out.write(`${JSON.stringify(result, null, 2)}\n`)
      return
    }
    out.write(`\n${formatCrawlReport(result)}\n`)
  } catch (error) {
    out.error(error instanceof Error ? error.message : String(error))
  }
}

/** Read lines until a line that is exactly the sentinel (e.g. "."). */
function readLinesUntil(rl: ReturnType<typeof createReadline>, prompt: string, sentinel: string): Promise<string> {
  return new Promise((resolve) => {
    const lines: string[] = []
    const ask = (): void => {
      rl.question(lines.length === 0 ? prompt : '', (line) => {
        if (line.trim() === sentinel) {
          resolve(lines.join('\n').trim())
          return
        }
        lines.push(line)
        ask()
      })
    }
    ask()
  })
}

export async function handlePromptAdd(args: string[], rl: ReturnType<typeof createReadline>): Promise<void> {
  const name = args[0]
  if (!name) {
    out.error('Usage: /prompt add <name>')
    return
  }
  out.println("Enter prompt text. End with a line containing only '.'")
  const content = await readLinesUntil(rl, 'Prompt text: ', '.')
  if (!content) {
    out.error('Prompt content cannot be empty.')
    return
  }
  addOrUpdatePreset(name, content)
  out.println(`Added/updated preset: ${name}`)
}

export async function handlePromptSet(args: string[], rl: ReturnType<typeof createReadline>): Promise<void> {
  const name = args[0]
  if (!name) {
    out.error('Usage: /prompt set <name>')
    return
  }
  const existing = getPresetContent(name)
  if (existing) {
    out.println("Current content (end with a line containing only '.'):")
    out.println(existing)
  }
  out.println("Enter new prompt text. End with a line containing only '.'")
  const content = await readLinesUntil(rl, 'Prompt text: ', '.')
  if (!content) {
    out.error('Prompt content cannot be empty.')
    return
  }
  addOrUpdatePreset(name, content)
  out.println(`Updated preset: ${name}`)
}

// --- Session commands (REPL calls save/load when switching) ---

export function handleSessionList(): void {
  const sessions = listSessions()
  const current = getCurrentSessionName()
  if (sessions.length === 0) {
    out.println("No sessions yet. Use /session new <name> or just start chatting (saved as 'default').")
    return
  }
  out.println('Sessions:')
  for (const s of sessions) {
    const marker = current === s.name ? ' *' : ''
    const date = new Date(s.updatedAt).toLocaleString()
    out.println(`  ${s.name}${marker}  (${s.messageCount} messages, ${date})`)
  }
  if (current) out.println(`\nCurrent: ${current}`)
}

export function handleSessionCurrent(): void {
  const current = getCurrentSessionName()
  if (current) {
    const messages = loadSession(current)
    out.println(`Session: ${current} (${messages.length} messages)`)
  } else {
    out.println('No current session. Use /session new <name> or /session use <name>.')
  }
}

/** Returns session name to switch to, or null. Caller must save current and load this one. */
export function handleSessionUse(args: string[]): string | null {
  const name = args[0]
  if (!name) {
    out.error('Usage: /session use <name>')
    return null
  }
  ensureSession(name)
  setCurrentSessionName(name)
  out.println(`Using session: ${name}`)
  return name
}

/** Returns session name to switch to (new session). Caller must save current and load this one. */
export function handleSessionNew(args: string[]): string | null {
  const name = args[0]
  if (!name) {
    out.error('Usage: /session new <name>')
    return null
  }
  const created = ensureSession(name)
  setCurrentSessionName(name)
  out.println(created ? `New session: ${name}` : `Using session: ${name}`)
  return name
}

/** Returns new current session name if we deleted the current one; otherwise null. Caller may need to load. */
export function handleSessionRemove(args: string[]): string | null {
  const name = args[0]
  if (!name) {
    out.error('Usage: /session remove <name>')
    return null
  }
  const current = getCurrentSessionName()
  try {
    deleteSession(name)
    out.println(`Removed session: ${name}`)
    if (current === name) {
      const next = getCurrentSessionName()
      return next
    }
  } catch (e) {
    out.error(e instanceof Error ? e.message : String(e))
  }
  return null
}

export async function handleHeartbeat(args: string[]): Promise<void> {
  const sub = args[0] ?? 'status'

  if (sub === 'launchd') {
    const launchdSub = args[1] ?? 'status'
    if (launchdSub === 'status') {
      const status = getLaunchdStatus()
      out.println(`supported: ${status.supported ? 'yes' : 'no'}`)
      out.println(`installed: ${status.installed ? 'yes' : 'no'}`)
      out.println(`loaded: ${status.loaded ? 'yes' : 'no'}`)
      out.println(`label: ${status.label}`)
      out.println(`plist: ${status.plistPath}`)
      if (status.details) out.println(`details: ${status.details}`)
      return
    }

    if (launchdSub === 'install') {
      const pollArg = args.find((arg) => arg.startsWith('--poll='))
      const poll = pollArg ? Number.parseInt(pollArg.split('=')[1] ?? '', 10) : undefined
      const result = installHeartbeatLaunchd({
        heartbeatPollSeconds: Number.isFinite(poll) ? poll : undefined
      })
      if (!result.ok) {
        out.error(result.message)
        return
      }
      out.println(result.message)
      out.println(`plist: ${result.plistPath}`)
      return
    }

    if (launchdSub === 'uninstall') {
      const result = uninstallHeartbeatLaunchd()
      if (!result.ok) {
        out.error(result.message)
        return
      }
      out.println(result.message)
      out.println(`plist: ${result.plistPath}`)
      return
    }

    if (launchdSub === 'print') {
      const plist = readHeartbeatLaunchdPlist()
      if (!plist) {
        out.error('Heartbeat launchd plist is not installed.')
        return
      }
      out.println(plist)
      return
    }

    out.error('Usage: /heartbeat launchd [status|install|uninstall|print] [--poll=60]')
    return
  }

  if (sub === 'status') {
    const status = getHeartbeatStatus()
    out.println(`running: ${status.running ? 'yes' : 'no'}`)
    if (status.runtime) {
      out.println(`pid: ${status.runtime.pid}`)
      out.println(`startedAt: ${status.runtime.startedAt}`)
      out.println(`workspace: ${status.runtime.workspace}`)
    }
    out.println(`state: ${status.statePath}`)
    out.println(`log: ${status.logPath}`)
    return
  }

  if (sub === 'start') {
    const result = startHeartbeatDaemon()
    if (!result.started) {
      out.error(result.message ?? 'Heartbeat daemon failed to start')
      return
    }
    out.println(`${result.message ?? 'Heartbeat daemon started.'} pid=${result.pid ?? '?'}`)
    out.println(`log: ${result.logPath}`)
    return
  }

  if (sub === 'stop') {
    const result = stopHeartbeatDaemon()
    if (result.stopped) out.println(result.message)
    else out.error(result.message)
    return
  }

  if (sub === 'once') {
    const result = await runHeartbeatOnce({ speakUrgent: true })
    if (result.dueCount === 0) {
      out.println('HEARTBEAT_OK')
      return
    }
    result.runs.forEach((run) => out.println(`${run.ok ? '✓' : '✗'} ${run.title}: ${run.summary}`))
    return
  }

  out.error('Usage: /heartbeat [status|start|stop|once|launchd]')
}
