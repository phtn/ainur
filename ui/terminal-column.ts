import { wrapText } from './layout'
import { text } from './theme'

/**
 * Terminal column component for the right panel of the UI
 */

// Define output types
export type OutputType = 'stdout' | 'stderr' | 'command' | 'info' | 'error'

// Define output entry structure
export interface OutputEntry {
  type: OutputType
  content: string
  timestamp: Date
}

// Terminal column state
export interface TerminalColumnState {
  output: Array<OutputEntry>
  maxHeight: number
  isRunning: boolean
  currentCommand?: string
}

/**
 * Create a new terminal column state
 * @param maxHeight Maximum height for the terminal display
 * @returns Initial terminal column state
 */
export function createTerminalColumnState(maxHeight: number = 20): TerminalColumnState {
  return {
    output: [],
    maxHeight,
    isRunning: false
  }
}

/**
 * Add output to the terminal column
 * @param state Terminal column state
 * @param entry Output entry to add
 * @returns Updated state
 */
export function addOutput(state: TerminalColumnState, entry: OutputEntry): TerminalColumnState {
  return {
    ...state,
    output: [...state.output, entry]
  }
}

/**
 * Set the running state of the terminal
 * @param state Terminal column state
 * @param isRunning Whether a command is running
 * @param command Current command (optional)
 * @returns Updated state
 */
export function setRunningState(state: TerminalColumnState, isRunning: boolean, command?: string): TerminalColumnState {
  return {
    ...state,
    isRunning,
    currentCommand: isRunning ? command : undefined
  }
}

/**
 * Format an output entry for display
 * @param entry Output entry to format
 * @param width Maximum width for the output
 * @returns Formatted output lines
 */
export function formatOutputEntry(entry: OutputEntry, width: number): Array<string> {
  const prefix = getOutputPrefix(entry.type)
  const header = formatOutputHeader(prefix, entry.timestamp)
  const contentWidth = Math.max(1, width - 2)
  const wrappedContent = wrapMultilineText(entry.content, contentWidth)
  const body = wrappedContent.length > 0 ? wrappedContent : ['']

  return [header, ...body.map((line) => `${' '.repeat(2)}${line}`)]
}

/**
 * Get the prefix for an output entry based on its type
 * @param type Output type
 * @returns Prefix string
 */
function getOutputPrefix(type: OutputType): string {
  switch (type) {
    case 'stdout':
      return text.normal('>')
    case 'stderr':
      return text.error('!')
    case 'command':
      return text.success('$')
    case 'info':
      return text.dim('#')
    case 'error':
      return text.error('✗')
    default:
      return ''
  }
}

function formatTimestamp(timestamp: Date): string {
  if (!(timestamp instanceof Date) || Number.isNaN(timestamp.getTime())) {
    return '--:--'
  }

  const hours = String(timestamp.getHours()).padStart(2, '0')
  const minutes = String(timestamp.getMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}

function formatOutputHeader(prefix: string, timestamp: Date): string {
  return `${prefix} ${text.dim(formatTimestamp(timestamp))}`
}

function wrapMultilineText(content: string, width: number): Array<string> {
  const result: Array<string> = []
  const paragraphs = content.split(/\r?\n/)

  for (const paragraph of paragraphs) {
    if (paragraph.length === 0) {
      result.push('')
      continue
    }

    result.push(...wrapText(paragraph, width))
  }

  return result
}

/**
 * Render the terminal column content
 * @param state Terminal column state
 * @param width Width of the column
 * @returns Formatted terminal column content
 */
export function renderTerminalColumn(state: TerminalColumnState, width: number): Array<string> {
  const lines: Array<string> = []

  if (state.output.length === 0 && !state.isRunning) {
    return [text.dim('No terminal output yet.'), text.dim('Run a command to populate this pane.')]
  }

  // Add output entries
  for (const entry of state.output) {
    const entryLines = formatOutputEntry(entry, width)
    if (lines.length > 0) {
      lines.push('')
    }
    lines.push(...entryLines)
  }

  // Add running indicator if a command is running
  if (state.isRunning) {
    lines.push('')
    lines.push(text.dim('--- Command running ---'))
    if (state.currentCommand) {
      lines.push(text.normal(`$ ${state.currentCommand}`))
    } else {
      lines.push(text.dim('Waiting for command details.'))
    }
  }

  // Trim to max height if needed
  if (lines.length > state.maxHeight) {
    return lines.slice(-state.maxHeight)
  }

  return lines
}

/**
 * Clear the terminal output
 * @param state Terminal column state
 * @returns Updated state with cleared output
 */
export function clearTerminal(state: TerminalColumnState): TerminalColumnState {
  return {
    ...state,
    output: []
  }
}

/**
 * Get the last output entry from the terminal
 * @param state Terminal column state
 * @returns Last output entry or undefined if no output
 */
export function getLastOutput(state: TerminalColumnState): OutputEntry | undefined {
  return state.output.length > 0 ? state.output[state.output.length - 1] : undefined
}
