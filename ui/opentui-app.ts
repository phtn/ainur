import {
  BoxRenderable,
  createCliRenderer,
  InputRenderable,
  InputRenderableEvents,
  MarkdownRenderable,
  RGBA,
  ScrollBoxRenderable,
  StyledText,
  SyntaxStyle,
  TextAttributes,
  TextRenderable,
  type CliRenderer,
  type TextChunk
} from '@jitl/opentui-core'

// ── Colour palette ──────────────────────────────────────────────
const C = {
  bg: '#080A0F',
  surface: '#10131A',
  surfaceRaised: '#151A22',
  border: '#2A3545',
  borderMuted: '#1B2430',
  text: '#ECEBFA',
  textStrong: '#FFFFFF',
  dim: '#7B8796',
  muted: '#A7B0BE',
  accent: '#6FE4D4',
  accentWarm: '#F6C177',
  user: '#8AB4FF',
  inputBg: '#0E1219',
  inputFocusedBg: '#141B24',
  helpBg: '#0B0E14',
  helpText: '#8E99A8'
}

// ── Syntax style for markdown ───────────────────────────────────
function buildSyntaxStyle(): SyntaxStyle {
  return SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromHex(C.text) },
    'heading.1': { fg: RGBA.fromHex(C.textStrong), bold: true },
    'heading.2': { fg: RGBA.fromHex(C.textStrong), bold: true },
    'heading.3': { fg: RGBA.fromHex(C.muted) },
    emphasis: { italic: true, fg: RGBA.fromHex(C.accentWarm) },
    strong: { bold: true, fg: RGBA.fromHex(C.textStrong) },
    code: { fg: RGBA.fromHex(C.accent) },
    'code.block': { fg: RGBA.fromHex(C.text) },
    link: { fg: RGBA.fromHex(C.user), underline: true },
    'hr.marker': { dim: true },
    'blockquote.marker': { fg: RGBA.fromHex(C.accent) },
    'list.marker': { fg: RGBA.fromHex(C.accent) }
  })
}

// ── Types ───────────────────────────────────────────────────────
export interface OpenTUIAppConfig {
  contextLabel?: string
  sessionLabel?: string
  tokenContextLabel?: string
}

export interface ChatEntry {
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: Date
  elapsed?: string
  renderMode?: 'markdown' | 'crypto'
}

export type UserMessageAlignment = 'left' | 'right'

type Completer = (line: string) => [string[], string]

type AssistantSegment = {
  kind: 'text' | 'gesture'
  content: string
}

// ── App ─────────────────────────────────────────────────────────
export class OpenTUIApp {
  private renderer!: CliRenderer
  private inputRef!: InputRenderable
  private inputFrameRef!: BoxRenderable
  private scrollBox!: ScrollBoxRenderable
  private sessionLabelRef!: TextRenderable
  private tokenContextLabelRef!: TextRenderable
  private contextLabelRef!: TextRenderable
  private helpBarRef!: TextRenderable
  private statusRef!: TextRenderable
  private entryFrameRefs: BoxRenderable[] = []
  private entryMetaRefs: TextRenderable[] = []
  private entryBodyRefs: BoxRenderable[] = []
  private syntaxStyle: SyntaxStyle
  private entries: ChatEntry[] = []
  private _onSubmit: ((value: string) => void) | null = null
  private _onAbort: (() => boolean | void) | null = null
  private _onExit: (() => void) | null = null
  private _onCompletionSuggestions: ((suggestions: string[]) => void) | null = null
  private _config: OpenTUIAppConfig
  private destroyed = false
  private completer: Completer | null = null
  private generating = false
  private completionSuggestions: string[] = []
  private userMessageAlignment: UserMessageAlignment = 'left'

  constructor(config: OpenTUIAppConfig = {}) {
    this._config = config
    this.syntaxStyle = buildSyntaxStyle()
  }

  async init(): Promise<void> {
    this.renderer = await createCliRenderer({
      exitOnCtrlC: false,
      targetFps: 30,
      backgroundColor: C.bg
    })
    this.renderer.setTerminalTitle('Cale')

    this.buildUI()
    this.wireEvents()
  }

  // ── UI construction ─────────────────────────────────────────

  private buildUI(): void {
    const ctx = this.renderer

    // ── Header ────────────────────────────────────────────────
    const brand = new TextRenderable(ctx, {
      id: 'brand',
      content: 'v0.4',
      fg: RGBA.fromHex(C.textStrong),
      bg: RGBA.fromHex(C.surfaceRaised),
      width: 8,
      truncate: true
    })

    this.sessionLabelRef = new TextRenderable(ctx, {
      id: 'session-label',
      content: this._config.sessionLabel ?? 'default',
      fg: RGBA.fromHex(C.dim),
      bg: RGBA.fromHex(C.bg),
      maxWidth: 24,
      truncate: true
    })

    this.tokenContextLabelRef = new TextRenderable(ctx, {
      id: 'token-context-label',
      content: this._config.tokenContextLabel ?? '0/ctx',
      fg: RGBA.fromHex(C.dim),
      bg: RGBA.fromHex(C.bg),
      flexGrow: 1,
      truncate: true
    })

    this.contextLabelRef = new TextRenderable(ctx, {
      id: 'context-label',
      content: this.formatPill(this._config.contextLabel ?? 'cale'),
      fg: RGBA.fromHex(C.muted),
      bg: RGBA.fromHex(C.surface),
      maxWidth: 44,
      truncate: true
    })

    this.statusRef = new TextRenderable(ctx, {
      id: 'status',
      content: this.formatPill('ready'),
      fg: RGBA.fromHex(C.accent),
      bg: RGBA.fromHex(C.surface),
      width: 10,
      truncate: true
    })

    const header = new BoxRenderable(ctx, {
      id: 'header',
      width: '100%',
      height: 2,
      flexDirection: 'row',
      alignItems: 'center',
      columnGap: 1,
      paddingX: 1,
      backgroundColor: C.bg,
      border: ['bottom'],
      borderColor: C.borderMuted
    })
    header.add(brand)
    header.add(this.sessionLabelRef)
    header.add(this.tokenContextLabelRef)
    header.add(this.contextLabelRef)
    header.add(this.statusRef)

    // ── Chat scroll area ───────────────────────────────────────
    this.scrollBox = new ScrollBoxRenderable(ctx, {
      id: 'chat-scroll',
      flexGrow: 1,
      width: '100%',
      marginTop: 1,
      marginBottom: 0,
      paddingX: 1,
      paddingY: 1,
      backgroundColor: C.surface,
      border: true,
      borderStyle: 'rounded',
      borderColor: C.border,
      title: ' conversation ',
      titleAlignment: 'left',
      scrollY: true,
      stickyScroll: true,
      stickyStart: 'bottom',
      verticalScrollbarOptions: {
        trackOptions: {
          backgroundColor: C.surface,
          foregroundColor: C.border
        }
      }
    })

    // ── Prompt marker ─────────────────────────────────────────
    const arrow = new TextRenderable(ctx, {
      id: 'prompt-arrow',
      content: '➜',
      fg: RGBA.fromHex(C.accent),
      bg: RGBA.fromHex(C.inputBg),
      width: 3,
      truncate: true
    })

    // ── Input field ────────────────────────────────────────────
    this.inputRef = new InputRenderable(ctx, {
      id: 'cmd-input',
      placeholder: 'message or /help',
      flexGrow: 1,
      backgroundColor: C.bg,
      focusedBackgroundColor: C.bg,
      textColor: C.text,
      focusedTextColor: C.textStrong,
      placeholderColor: C.dim,
      cursorColor: C.accent
    })

    // ── Input row (horizontal) ─────────────────────────────────
    const inputRow = new BoxRenderable(ctx, {
      id: 'input-row',
      flexDirection: 'row',
      backgroundColor: C.bg,
      width: '100%',
      height: 1,
      paddingY: 1
    })
    inputRow.add(arrow)
    inputRow.add(this.inputRef)

    this.inputFrameRef = new BoxRenderable(ctx, {
      id: 'input-frame',
      flexDirection: 'row',
      width: '100%',
      height: 3,
      paddingX: 1,
      paddingY: 1,
      alignItems: 'center',
      backgroundColor: C.bg,
      border: true,
      borderStyle: 'rounded',
      borderColor: C.border,
      title: ' compose ',
      titleAlignment: 'left'
    })
    this.inputFrameRef.add(inputRow)

    // ── Help bar ───────────────────────────────────────────────
    this.helpBarRef = new TextRenderable(ctx, {
      id: 'help-bar',
      content: this.buildHelpText(false),
      fg: RGBA.fromHex(C.dim),
      bg: RGBA.fromHex(C.inputBg),
      width: '100%',
      height: 1,
      marginTop: 1,
      truncate: true
    })

    // ── Root layout (vertical column) ──────────────────────────
    const root = new BoxRenderable(ctx, {
      id: 'root',
      width: '100%',
      height: '100%',
      flexDirection: 'column',
      backgroundColor: C.bg,
      paddingX: 1
    })
    root.add(header)
    root.add(this.scrollBox)
    root.add(this.inputFrameRef)
    root.add(this.helpBarRef)

    ctx.root.add(root)
  }

  // ── Help bar text ───────────────────────────────────────────

  private buildHelpText(generating: boolean): string {
    if (generating) {
      return '  streaming response  |  Ctrl+C abort'
    }
    return '  Enter send  |  Tab complete  |  Esc clear input  |  Ctrl+C exit  |  /help commands'
  }

  // ── Events ──────────────────────────────────────────────────

  private wireEvents(): void {
    this.inputRef.on(InputRenderableEvents.ENTER, () => {
      this.clearCompletionSuggestions()
      const val = this.inputRef.value.trim()
      if (!val) return
      this.inputRef.value = ''
      this._onSubmit?.(val)
    })

    this.renderer.keyInput.on('keypress', (key: any) => {
      if (key.name === 'tab') {
        key.preventDefault?.()
        this.completeInput()
        return
      }
      if (key.ctrl && key.name === 'c') {
        this.clearCompletionSuggestions()
        const abortHandled = this._onAbort?.()
        if (abortHandled) return
        this._onExit?.()
        return
      }
      if (key.name === 'escape') {
        this.inputRef.value = ''
        this.clearCompletionSuggestions()
      }
      setImmediate(() => {
        if (!this.inputRef.value.trimStart().startsWith('/')) {
          this.clearCompletionSuggestions()
        }
      })
    })
  }

  // ── Public API ──────────────────────────────────────────────

  onSubmit(fn: (value: string) => void): void {
    this._onSubmit = fn
  }

  onAbort(fn: () => boolean | void): void {
    this._onAbort = fn
  }

  onExit(fn: () => void): void {
    this._onExit = fn
  }

  onCompletionSuggestions(fn: (suggestions: string[]) => void): void {
    this._onCompletionSuggestions = fn
  }

  setCompleter(completer: Completer): void {
    this.completer = completer
  }

  addEntry(entry: ChatEntry): void {
    this.entries.push(entry)
    this.addEntryRenderable(entry, this.entries.length - 1)
  }

  clearEntries(): void {
    for (const frame of this.entryFrameRefs) {
      if (frame) {
        this.scrollBox.remove(frame.id)
      }
    }
    this.entries = []
    this.entryFrameRefs = []
    this.entryMetaRefs = []
    this.entryBodyRefs = []
  }

  setUserMessageAlignment(alignment: UserMessageAlignment): void {
    if (this.userMessageAlignment === alignment) return
    this.userMessageAlignment = alignment
    this.rerenderEntries()
  }

  getUserMessageAlignment(): UserMessageAlignment {
    return this.userMessageAlignment
  }

  toggleUserMessageAlignment(): UserMessageAlignment {
    const next = this.userMessageAlignment === 'left' ? 'right' : 'left'
    this.setUserMessageAlignment(next)
    return next
  }

  updateLastAssistant(content: string): void {
    const index = this.entries.length - 1
    const last = this.entries[index]
    if (last && last.role === 'assistant') {
      last.content = content
      const body = this.entryBodyRefs[index]
      if (body) {
        this.renderEntryBody(body, last, index)
      }
    }
  }

  setLastAssistantElapsed(elapsed: string): void {
    const index = this.entries.length - 1
    const last = this.entries[index]
    if (last && last.role === 'assistant') {
      last.elapsed = elapsed
      this.updateEntryMeta(index)
    }
  }

  setContextLabel(label: string): void {
    this._config.contextLabel = label
    if (this.contextLabelRef) {
      this.contextLabelRef.content = this.formatPill(label)
    }
  }

  setSessionLabel(label: string): void {
    this._config.sessionLabel = label
    if (this.sessionLabelRef) {
      this.sessionLabelRef.content = label
    }
  }

  setTokenContextLabel(label: string): void {
    this._config.tokenContextLabel = label
    if (this.tokenContextLabelRef) {
      this.tokenContextLabelRef.content = label
    }
  }

  setGenerating(generating: boolean): void {
    this.generating = generating
    if (this.statusRef) {
      this.statusRef.content = this.formatPill(generating ? 'busy' : 'ready')
      this.statusRef.fg = RGBA.fromHex(generating ? C.accentWarm : C.accent)
    }
    if (this.helpBarRef) {
      this.updateHelpBar()
    }
    if (this.inputFrameRef) {
      this.inputFrameRef.borderColor = generating ? C.accentWarm : C.border
      this.inputFrameRef.title = generating ? ' ⭓ ' : ' ⌨ '
    }
    if (this.scrollBox) {
      this.scrollBox.borderColor = generating ? C.accentWarm : C.border
    }
  }

  focusInput(): void {
    this.inputRef.focus()
  }

  blurInput(): void {
    this.inputRef.blur()
  }

  getInputValue(): string {
    return this.inputRef.value
  }

  setInputValue(val: string): void {
    this.inputRef.value = val
    if (!val.trimStart().startsWith('/')) {
      this.clearCompletionSuggestions()
    }
  }

  getRenderer(): CliRenderer {
    return this.renderer
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    try {
      this.syntaxStyle.destroy()
    } catch {
      /* ignore */
    }
    try {
      this.renderer.destroy()
    } catch {
      /* ignore */
    }
  }

  // ── Message rendering ───────────────────────────────────────

  private rerenderEntries(): void {
    for (const frame of this.entryFrameRefs) {
      if (frame) {
        this.scrollBox.remove(frame.id)
      }
    }
    this.entryFrameRefs = []
    this.entryMetaRefs = []
    this.entryBodyRefs = []
    this.entries.forEach((entry, index) => this.addEntryRenderable(entry, index))
  }

  private addEntryRenderable(entry: ChatEntry, index: number): void {
    const ctx = this.renderer
    const isAssistant = entry.role === 'assistant'
    const isUser = entry.role === 'user'
    const bg = isAssistant ? C.inputBg : C.surface
    const fg = isUser ? C.dim : entry.role === 'system' ? C.muted : C.text
    const userAlignSelf = this.userMessageAlignment === 'right' ? 'flex-end' : 'flex-start'
    const isRightAlignedUser = isUser && this.userMessageAlignment === 'right'

    const frame = new BoxRenderable(ctx, {
      id: `chat-entry-${index}`,
      width: isUser ? '75%' : '100%',
      alignSelf: isUser ? userAlignSelf : undefined,
      flexDirection: 'column',
      marginBottom: 1,
      paddingX: isAssistant ? 2 : 1,
      paddingY: isAssistant ? 1 : 0,
      backgroundColor: bg,
      border: false
    })

    const header = new BoxRenderable(ctx, {
      id: `chat-entry-header-${index}`,
      width: '100%',
      flexDirection: 'row',
      justifyContent: isRightAlignedUser ? 'flex-end' : undefined,
      columnGap: 1,
      backgroundColor: bg
    })

    const label = new TextRenderable(ctx, {
      id: `chat-entry-label-${index}`,
      content: this.entryLabel(entry.role),
      fg: RGBA.fromHex(isUser ? C.accent : entry.role === 'system' ? C.muted : C.accentWarm),
      bg: RGBA.fromHex(bg),
      width: 3,
      truncate: true
    })

    const meta = new TextRenderable(ctx, {
      id: `chat-entry-meta-${index}`,
      content: this.entryMeta(entry),
      fg: RGBA.fromHex(C.dim),
      bg: RGBA.fromHex(bg),
      flexGrow: isRightAlignedUser ? undefined : 1,
      width: isRightAlignedUser ? 'auto' : undefined,
      truncate: true
    })

    const body = new BoxRenderable(ctx, {
      id: `chat-entry-body-${index}`,
      width: '100%',
      flexDirection: 'column',
      alignItems: isUser && this.userMessageAlignment === 'right' ? 'flex-end' : 'flex-start',
      backgroundColor: bg
    })

    if (isRightAlignedUser) {
      header.add(meta)
      header.add(label)
    } else {
      header.add(label)
      header.add(meta)
    }
    frame.add(header)
    frame.add(body)
    this.renderEntryBody(body, entry, index)
    this.scrollBox.add(frame)
    this.entryFrameRefs[index] = frame
    this.entryMetaRefs[index] = meta
    this.entryBodyRefs[index] = body
  }

  private renderEntryBody(body: BoxRenderable, entry: ChatEntry, index: number): void {
    const isAssistant = entry.role === 'assistant'
    const isUser = entry.role === 'user'
    const bg = isAssistant ? C.inputBg : C.surface
    const fg = isUser ? C.dim : entry.role === 'system' ? C.muted : C.text

    for (const child of body.getChildren()) {
      body.remove(child.id)
    }

    if (isAssistant) {
      const lines = this.assistantContentToStyledTextLines(entry.content, fg, bg)
      lines.forEach((line, lineIndex) => {
        body.add(
          new TextRenderable(this.renderer, {
            id: `chat-entry-assistant-text-${index}-${lineIndex}`,
            content: line,
            fg: RGBA.fromHex(fg),
            bg: RGBA.fromHex(bg),
            width: '100%',
            wrapMode: 'word'
          })
        )
      })
      return
    }

    if (entry.role === 'system' && entry.renderMode === 'crypto') {
      this.addCryptoBody(body, entry.content.trimEnd() || '', fg, bg, `chat-entry-crypto-${index}`)
      return
    }

    if (isUser && this.userMessageAlignment === 'right') {
      this.addPlainTextBody(body, entry.content.trimEnd() || '', fg, bg, `chat-entry-user-text-${index}`)
      return
    }

    if (!isAssistant) {
      this.addMarkdownBody(body, entry.content.trimEnd() || '', fg, bg, `chat-entry-markdown-${index}-0`)
      return
    }
  }

  private addPlainTextBody(body: BoxRenderable, content: string, fg: string, bg: string, idPrefix: string): void {
    const lines = content.split('\n')
    lines.forEach((line, lineIndex) => {
      body.add(
        new TextRenderable(this.renderer, {
          id: `${idPrefix}-${lineIndex}`,
          content: line.trimEnd(),
          fg: RGBA.fromHex(fg),
          bg: RGBA.fromHex(bg),
          maxWidth: '100%',
          alignSelf: 'flex-end',
          wrapMode: 'word'
        })
      )
    })
  }

  private addCryptoBody(body: BoxRenderable, content: string, fg: string, bg: string, idPrefix: string): void {
    const lines = content.split('\n')
    lines.forEach((line, lineIndex) => {
      body.add(
        new TextRenderable(this.renderer, {
          id: `${idPrefix}-${lineIndex}`,
          content: this.cryptoLineToStyledText(line, fg, bg),
          fg: RGBA.fromHex(fg),
          bg: RGBA.fromHex(bg),
          width: '100%',
          wrapMode: 'word'
        })
      )
    })
  }

  private cryptoLineToStyledText(line: string, fg: string, bg: string): StyledText {
    const chunks: TextChunk[] = []
    const parts = line.split(/(\s{2,})/)
    let fieldIndex = 0

    for (const part of parts) {
      if (!part) continue
      const isSeparator = /^\s{2,}$/.test(part)
      const isNegativeChange = !isSeparator && fieldIndex === 3 && part.trimStart().startsWith('-')
      chunks.push({
        __isChunk: true,
        text: part,
        fg: RGBA.fromHex(isNegativeChange ? C.dim : fg),
        bg: RGBA.fromHex(bg)
      })
      if (!isSeparator) {
        fieldIndex += 1
      }
    }

    return new StyledText(
      chunks.length > 0
        ? chunks
        : [
            {
              __isChunk: true,
              text: '',
              fg: RGBA.fromHex(fg),
              bg: RGBA.fromHex(bg)
            }
          ]
    )
  }

  private addMarkdownBody(body: BoxRenderable, content: string, fg: string, bg: string, id: string): void {
    body.add(
      new MarkdownRenderable(this.renderer, {
        id,
        syntaxStyle: this.syntaxStyle,
        conceal: true,
        fg: RGBA.fromHex(fg),
        bg: RGBA.fromHex(bg),
        content,
        tableOptions: {
          style: 'columns',
          widthMode: 'full',
          wrapMode: 'word',
          borders: false
        }
      })
    )
  }

  private parseAssistantSegments(content: string): AssistantSegment[] {
    const segments: AssistantSegment[] = []
    let searchFrom = 0

    while (true) {
      const openIdx = content.indexOf('*', searchFrom)
      if (openIdx === -1) break

      const closeIdx = content.indexOf('*', openIdx + 1)
      if (closeIdx === -1) break

      const before = content.slice(searchFrom, openIdx)
      if (before) {
        segments.push({ kind: 'text', content: before })
      }

      segments.push({
        kind: 'gesture',
        content: content.slice(openIdx + 1, closeIdx).trim()
      })

      searchFrom = closeIdx + 1
    }

    const rest = content.slice(searchFrom)
    if (rest) {
      segments.push({ kind: 'text', content: rest })
    }

    return segments
  }

  private assistantContentToStyledTextLines(content: string, fg: string, bg: string): StyledText[] {
    const segments = this.parseAssistantSegments(content)
    const lines: TextChunk[][] = [[]]

    const appendChunk = (chunk: TextChunk): void => {
      const currentLine = lines[lines.length - 1]
      if (currentLine) {
        currentLine.push(chunk)
      }
    }

    const pushLine = (): void => {
      lines.push([])
    }

    for (const segment of segments) {
      if (segment.kind === 'text') {
        const parts = segment.content.replace(/\r\n/g, '\n').split('\n')
        parts.forEach((part, partIndex) => {
          if (partIndex > 0) {
            pushLine()
          }
          const currentLine = lines[lines.length - 1]
          const isAtLineStart = !currentLine || currentLine.length === 0
          const textContent = partIndex > 0 || isAtLineStart ? part.replace(/^[ \t]+/, '') : part
          if (!textContent) return
          appendChunk({
            __isChunk: true,
            text: textContent,
            fg: RGBA.fromHex(fg),
            bg: RGBA.fromHex(bg)
          })
        })
        continue
      }

      appendChunk({
        __isChunk: true,
        text: segment.content,
        fg: RGBA.fromHex(C.dim),
        bg: RGBA.fromHex(bg),
        attributes: TextAttributes.DIM | TextAttributes.ITALIC
      })
      pushLine()
    }

    while (lines.length > 1 && lines[lines.length - 1]?.length === 0) {
      lines.pop()
    }

    if (lines.length === 0 || lines.every((line) => line.length === 0)) {
      return [
        new StyledText([
          {
            __isChunk: true,
            text: '',
            fg: RGBA.fromHex(fg),
            bg: RGBA.fromHex(bg)
          }
        ])
      ]
    }

    return lines.map((line) => new StyledText(line))
  }

  private updateEntryMeta(index: number): void {
    const entry = this.entries[index]
    const meta = this.entryMetaRefs[index]
    if (entry && meta) {
      meta.content = this.entryMeta(entry)
    }
  }

  private entryLabel(role: ChatEntry['role']): string {
    return role === 'user' ? '⯅' : role === 'assistant' ? '⯌' : '⛑'
  }

  private entryMeta(entry: ChatEntry): string {
    const elapsed = entry.elapsed ? `  ${entry.elapsed}` : ''
    return `${this.timestamp(entry.timestamp)}${elapsed}`
  }

  private timestamp(date: Date): string {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  private formatPill(value: string): string {
    return `${value} `
  }

  private completeInput(): void {
    if (!this.completer) return

    const line = this.inputRef.value
    const [matches] = this.completer(line)
    if (matches.length === 0) {
      this.clearCompletionSuggestions()
      return
    }

    if (matches.length === 1) {
      this.inputRef.value = this.ensureCompletionSpacing(matches[0] ?? line)
      this.clearCompletionSuggestions()
      return
    }

    const commonPrefix = this.longestCommonPrefix(matches)
    if (commonPrefix.length > line.length) {
      this.inputRef.value = commonPrefix
    }
    this.setCompletionSuggestions(matches)
    this._onCompletionSuggestions?.(matches)
  }

  private ensureCompletionSpacing(value: string): string {
    return value.includes(' ') ? value : `${value} `
  }

  private setCompletionSuggestions(suggestions: string[]): void {
    this.completionSuggestions = suggestions
    this.updateHelpBar()
  }

  private formatCompletionSuggestion(suggestion: string): string {
    const trimmed = suggestion.trim()
    if (!trimmed.startsWith('/')) return trimmed

    const input = this.inputRef.value.trimStart()
    const [inputCommand, inputSubcommand] = input.split(/\s+/)
    const [suggestionCommand, suggestionSubcommand, ...suggestionRest] = trimmed.split(/\s+/)

    if (inputCommand && suggestionCommand === inputCommand) {
      if (inputSubcommand && suggestionSubcommand === inputSubcommand) {
        return suggestionRest.join(' ') || suggestionSubcommand || trimmed.slice(1)
      }
      return [suggestionSubcommand, ...suggestionRest].filter(Boolean).join(' ') || suggestionCommand.slice(1)
    }

    return trimmed.slice(1)
  }

  private clearCompletionSuggestions(): void {
    if (this.completionSuggestions.length === 0) return
    this.completionSuggestions = []
    this.updateHelpBar()
  }

  private buildCompletionHelpText(): StyledText {
    return new StyledText([
      {
        __isChunk: true,
        text: '⌁',
        fg: RGBA.fromHex(C.accentWarm),
        bg: RGBA.fromHex(C.inputBg)
      },
      {
        __isChunk: true,
        text: `  ${this.completionSuggestions
          .slice(0, 6)
          .map((suggestion) => this.formatCompletionSuggestion(suggestion))
          .join('  ')}`,
        fg: RGBA.fromHex(C.text),
        bg: RGBA.fromHex(C.inputBg)
      }
    ])
  }

  private updateHelpBar(): void {
    if (this.helpBarRef) {
      const hasSuggestions = this.completionSuggestions.length > 0
      this.helpBarRef.content = hasSuggestions ? this.buildCompletionHelpText() : this.buildHelpText(this.generating)
      this.helpBarRef.fg = RGBA.fromHex(hasSuggestions ? C.text : C.dim)
    }
  }

  private longestCommonPrefix(values: string[]): string {
    const [first, ...rest] = values
    if (!first) return ''

    let prefix = first
    for (const value of rest) {
      while (!value.startsWith(prefix) && prefix.length > 0) {
        prefix = prefix.slice(0, -1)
      }
    }
    return prefix
  }
}
