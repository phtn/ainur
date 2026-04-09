import type { ChatColumnState } from './chat-column'
import { renderChatColumn, renderInputPrompt } from './chat-column'
import { calculateColumnWidths, clearScreen, renderLayout } from './layout'
import type { TerminalColumnState } from './terminal-column'
import { renderTerminalColumn } from './terminal-column'
import { text } from './theme'

/**
 * Toggle functionality for switching between views
 */

// Define view modes
export type ViewMode = 'split' | 'chat' | 'terminal'

// Define UI state
export interface UIState {
  viewMode: ViewMode
  chatState: ChatColumnState
  terminalState: TerminalColumnState
  terminalWidth: number
  terminalHeight: number
}

/**
 * Create initial UI state
 * @param terminalWidth Width of the terminal
 * @param terminalHeight Height of the terminal
 * @returns Initial UI state
 */
export function createUIState(terminalWidth: number, terminalHeight: number): UIState {
  const maxHeight = Math.max(3, Math.floor(terminalHeight * 0.6))
  return {
    viewMode: 'split',
    chatState: {
      messages: [],
      inputPrompt: 'You',
      maxHeight
    },
    terminalState: {
      output: [],
      maxHeight,
      isRunning: false
    },
    terminalWidth,
    terminalHeight
  }
}

/**
 * Toggle between view modes
 * @param state Current UI state
 * @param mode View mode to switch to
 * @returns Updated UI state
 */
export function toggleViewMode(state: UIState, mode: ViewMode): UIState {
  return {
    ...state,
    viewMode: mode
  }
}

/**
 * Render the UI based on the current view mode
 * @param state UI state
 */
export function renderUI(state: UIState): void {
  clearScreen()

  switch (state.viewMode) {
    case 'split':
      renderSplitView(state)
      break
    case 'chat':
      renderChatView(state)
      break
    case 'terminal':
      renderTerminalView(state)
      break
  }
}

/**
 * Render the split view with two columns
 * @param state UI state
 */
function renderSplitView(state: UIState): void {
  const { terminalWidth } = state
  const { leftWidth, rightWidth } = calculateColumnWidths(terminalWidth)

  // Prepare chat column content
  const chatLines = renderChatColumn(state.chatState, leftWidth)
  const chatColumn = {
    width: leftWidth,
    content: chatLines
  }

  // Prepare terminal column content
  const terminalLines = renderTerminalColumn(state.terminalState, rightWidth)
  const terminalColumn = {
    width: rightWidth,
    content: terminalLines
  }

  // Render the layout
  const layoutConfig = {
    leftColumn: chatColumn,
    rightColumn: terminalColumn
  }

  process.stdout.write(renderLayout(layoutConfig, terminalWidth))
}

/**
 * Render the full chat view
 * @param state UI state
 */
function renderChatView(state: UIState): void {
  const { terminalWidth, terminalHeight } = state
  const headerLines = [text.header('Chat View'), text.dim('─'.repeat(terminalWidth))]
  const chatLines = renderChatColumn(state.chatState, terminalWidth)
  const promptLine = renderInputPrompt(state.chatState)
  const spacerLines = Math.max(0, terminalHeight - headerLines.length - chatLines.length - 2)

  const lines = [...headerLines, ...Array.from({ length: spacerLines }, () => ''), ...chatLines, '', promptLine]

  process.stdout.write(lines.join('\n'))
}

/**
 * Render the full terminal view
 * @param state UI state
 */
function renderTerminalView(state: UIState): void {
  const { terminalWidth, terminalHeight } = state
  const headerLines = [text.header('Terminal View'), text.dim('─'.repeat(terminalWidth))]
  const terminalLines = renderTerminalColumn(state.terminalState, terminalWidth)

  const lines = [...headerLines, ...terminalLines]

  while (lines.length < terminalHeight) {
    lines.push('')
  }

  process.stdout.write(lines.join('\n'))
}

/**
 * Handle keyboard input for toggling views
 * @param state Current UI state
 * @param callback Function to call with updated state
 */
export function handleKeyboardInput(_state: UIState, _callback: (newState: UIState) => void): void {
  // Keyboard input handling stub (implementation intentionally omitted)
  console.log('Keyboard input handling would be implemented here')
}

/**
 * Add a message to the chat column
 * @param state UI state
 * @param message Chat message
 * @returns Updated UI state
 */
export function addChatMessage(state: UIState, message: any): UIState {
  return {
    ...state,
    chatState: {
      ...state.chatState,
      messages: [...state.chatState.messages, message]
    }
  }
}

/**
 * Add output to the terminal column
 * @param state UI state
 * @param output Terminal output
 * @returns Updated UI state
 */
export function addTerminalOutput(state: UIState, output: any): UIState {
  return {
    ...state,
    terminalState: {
      ...state.terminalState,
      output: [...state.terminalState.output, output]
    }
  }
}

/**
 * Set the running state of the terminal
 * @param state UI state
 * @param isRunning Whether a command is running
 * @param command Current command (optional)
 * @returns Updated UI state
 */
export function setTerminalRunningState(state: UIState, isRunning: boolean, command?: string): UIState {
  return {
    ...state,
    terminalState: {
      ...state.terminalState,
      isRunning,
      currentCommand: command
    }
  }
}
