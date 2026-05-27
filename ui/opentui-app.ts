import {
  BoxRenderable,
  createCliRenderer,
  cyan,
  InputRenderable,
  InputRenderableEvents,
  MarkdownRenderable,
  RGBA,
  ScrollBoxRenderable,
  SyntaxStyle,
  t,
  TextRenderable,
  type CliRenderer
} from '@jitl/opentui-core'

// ── Colour palette ──────────────────────────────────────────────
const C = {
  bg: '#0a0a0a',
  surface: '#111111',
  border: '#2a2a2a',
  promptArrow: '#5B9BF5',
  text: '#e0e0e0',
  dim: '#666666',
  accent: '#ffb86a',
  inputBg: '#1a1a1a',
  inputFocusedBg: '#1e1e1e',
  helpBg: '#0f0f0f',
  helpText: '#999999'
}

// ── Syntax style for markdown ───────────────────────────────────
function buildSyntaxStyle(): SyntaxStyle {
  return SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromHex(C.text) },
    'heading.1': { fg: RGBA.fromHex('#FFFFFF'), bold: true },
    'heading.2': { fg: RGBA.fromHex('#E0E0E0'), bold: true },
    'heading.3': { fg: RGBA.fromHex('#CCCCCC') },
    emphasis: { italic: true, fg: RGBA.fromHex(C.accent) },
    strong: { bold: true, fg: RGBA.fromHex('#FFFFFF') },
    code: { fg: RGBA.fromHex('#FF79C6') },
    'code.block': { fg: RGBA.fromHex(C.text) },
    link: { fg: RGBA.fromHex(C.accent), underline: true },
    'hr.marker': { dim: true },
    'blockquote.marker': { fg: RGBA.fromHex(C.accent) },
    'list.marker': { fg: RGBA.fromHex(C.accent) }
  })
}

// ── Types ───────────────────────────────────────────────────────
export interface OpenTUIAppConfig {
  contextLabel?: string
}

export interface ChatEntry {
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: Date
}

// ── App ─────────────────────────────────────────────────────────
export class OpenTUIApp {
  private renderer!: CliRenderer
  private markdown!: MarkdownRenderable
  private inputRef!: InputRenderable
  private scrollBox!: ScrollBoxRenderable
  private contextLabelRef!: TextRenderable
  private helpBarRef!: TextRenderable
  private syntaxStyle: SyntaxStyle
  private entries: ChatEntry[] = []
  private _onSubmit: ((value: string) => void) | null = null
  private _onAbort: (() => void) | null = null
  private _onExit: (() => void) | null = null
  private _config: OpenTUIAppConfig
  private destroyed = false

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

    this.buildUI()
    this.wireEvents()
  }

  // ── UI construction ─────────────────────────────────────────

  private buildUI(): void {
    const ctx = this.renderer

    // ── Chat scroll area ───────────────────────────────────────
    this.markdown = new MarkdownRenderable(ctx, {
      id: 'chat-markdown',
      syntaxStyle: this.syntaxStyle,
      conceal: true,
      fg: RGBA.fromHex(C.text),
      content: this.entriesToMarkdown()
    })

    this.scrollBox = new ScrollBoxRenderable(ctx, {
      id: 'chat-scroll',
      flexGrow: 1,
      scrollY: true,
      stickyScroll: true,
      stickyStart: 'bottom'
    })
    this.scrollBox.add(this.markdown)

    // ── Prompt arrow (blue ">") ────────────────────────────────
    const arrow = new TextRenderable(ctx, {
      id: 'prompt-arrow',
      content: t`${cyan('->')}`,
      fg: RGBA.fromHex(C.promptArrow),
      bg: RGBA.fromHex(C.inputBg),
      width: 2,
      truncate: true
    })

    // ── Input field ────────────────────────────────────────────
    this.inputRef = new InputRenderable(ctx, {
      id: 'cmd-input',
      placeholder: ' Type a command...',
      flexGrow: 1,
      backgroundColor: C.inputBg,
      focusedBackgroundColor: C.inputFocusedBg,
      textColor: C.text,
      cursorColor: C.accent
    })

    // ── Context label on the right ─────────────────────────────
    this.contextLabelRef = new TextRenderable(ctx, {
      id: 'context-label',
      content: this._config.contextLabel ?? 'cale',
      fg: RGBA.fromHex(C.dim),
      bg: RGBA.fromHex(C.inputBg),
      truncate: true
    })

    // ── Input row (horizontal) ─────────────────────────────────
    const inputRow = new BoxRenderable(ctx, {
      id: 'input-row',
      flexDirection: 'row',
      backgroundColor: C.inputBg,
      width: '100%'
    })
    inputRow.add(arrow)
    inputRow.add(this.inputRef)
    inputRow.add(this.contextLabelRef)

    // ── Help bar ───────────────────────────────────────────────
    this.helpBarRef = new TextRenderable(ctx, {
      id: 'help-bar',
      // content: this.buildHelpText(),
      fg: RGBA.fromHex(C.helpText),
      bg: RGBA.fromHex(C.helpBg),
      width: '100%',
      truncate: true
    })

    // ── Root layout (vertical column) ──────────────────────────
    const root = new BoxRenderable(ctx, {
      id: 'root',
      width: '100%',
      height: '100%',
      flexDirection: 'column',
      backgroundColor: C.bg
    })
    root.add(this.scrollBox)
    root.add(inputRow)
    root.add(this.helpBarRef)

    ctx.root.add(root)
  }

  // ── Help bar text ───────────────────────────────────────────

  private buildHelpTexts(): string {
    return '-> '
  }

  // ── Events ──────────────────────────────────────────────────

  private wireEvents(): void {
    this.inputRef.on(InputRenderableEvents.ENTER, () => {
      const val = this.inputRef.value.trim()
      if (!val) return
      this.inputRef.value = ''
      this._onSubmit?.(val)
    })

    this.renderer.keyInput.on('keypress', (key: any) => {
      if (key.ctrl && key.name === 'c') {
        // If generating, abort; otherwise exit
        this._onAbort?.() || this._onExit?.()
        return
      }
      if (key.name === 'escape') {
        this.inputRef.value = ''
      }
    })
  }

  // ── Public API ──────────────────────────────────────────────

  onSubmit(fn: (value: string) => void): void {
    this._onSubmit = fn
  }

  onAbort(fn: () => void): void {
    this._onAbort = fn
  }

  onExit(fn: () => void): void {
    this._onExit = fn
  }

  addEntry(entry: ChatEntry): void {
    this.entries.push(entry)
    this.refreshMarkdown()
  }

  updateLastAssistant(content: string): void {
    const last = this.entries[this.entries.length - 1]
    if (last && last.role === 'assistant') {
      last.content = content
      this.refreshMarkdown()
    }
  }

  setContextLabel(label: string): void {
    this._config.contextLabel = label
    if (this.contextLabelRef) {
      this.contextLabelRef.content = label
    }
  }

  setGenerating(generating: boolean): void {
    if (this.helpBarRef) {
      this.helpBarRef.content = generating ? 'Ctrl+C: abort' : ''
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

  // ── Markdown rendering ──────────────────────────────────────

  private entriesToMarkdown(): string {
    if (this.entries.length === 0) {
      return ''
    }
    return this.entries
      .map((e) => {
        const prefix = e.role === 'user' ? '**You**' : e.role === 'assistant' ? '**Cale**' : '*System*'
        return `${prefix}\n${e.content}`
      })
      .join('\n---\n\n')
  }

  private refreshMarkdown(): void {
    if (this.markdown) {
      this.markdown.content = this.entriesToMarkdown()
    }
  }
}
