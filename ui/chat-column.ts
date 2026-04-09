import { text } from './theme'
import { wrapText } from './layout'

/**
 * Chat column component for the left panel of the UI
 */

// Define message types
export type MessageType = 'user' | 'ai' | 'system'

// Define message structure
export interface Message {
  type: MessageType
  content: string
  timestamp: Date
}

// Chat column state
export interface ChatColumnState {
  messages: Array<Message>
  inputPrompt: string
  maxHeight: number
}

/**
 * Create a new chat column state
 * @param maxHeight Maximum height for the chat display
 * @returns Initial chat column state
 */
export function createChatColumnState(maxHeight: number = 20): ChatColumnState {
  return {
    messages: [],
    inputPrompt: 'You',
    maxHeight
  }
}

/**
 * Add a message to the chat column
 * @param state Chat column state
 * @param message Message to add
 * @returns Updated state
 */
export function addMessage(state: ChatColumnState, message: Message): ChatColumnState {
  return {
    ...state,
    messages: [...state.messages, message]
  }
}

/**
 * Format a message for display
 * @param message Message to format
 * @param width Maximum width for the message
 * @returns Formatted message lines
 */
export function formatMessage(message: Message, width: number): Array<string> {
  const header = formatMessageHeader(message)
  const contentWidth = Math.max(1, width - 2)
  const wrappedContent = wrapText(message.content, contentWidth)
  const body = wrappedContent.length > 0 ? wrappedContent : ['']

  return [header, ...body.map((line) => `${' '.repeat(2)}${line}`)]
}

/**
 * Get the label for a message based on its type
 * @param type Message type
 * @returns Styled label string
 */
function getMessagePrefix(type: MessageType): string {
  switch (type) {
    case 'user':
      return text.success('You')
    case 'ai':
      return text.normal('AI')
    case 'system':
      return text.dim('System')
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

function formatMessageHeader(message: Message): string {
  const prefix = getMessagePrefix(message.type)
  const time = text.dim(formatTimestamp(message.timestamp))
  return `${prefix} ${time}`
}

/**
 * Render the chat column content
 * @param state Chat column state
 * @param width Width of the column
 * @returns Formatted chat column content
 */
export function renderChatColumn(state: ChatColumnState, width: number): Array<string> {
  const lines: Array<string> = []

  if (state.messages.length === 0) {
    return [text.dim('No messages yet.'), text.dim('Type below to start the conversation.')]
  }

  // Add messages
  for (const message of state.messages) {
    const messageLines = formatMessage(message, width)
    lines.push(...messageLines)
    lines.push('')
  }

  // Trim to max height if needed
  if (lines.length > state.maxHeight) {
    return lines.slice(-state.maxHeight)
  }

  return lines
}

/**
 * Render the input prompt
 * @param state Chat column state
 * @returns Formatted input prompt
 */
export function renderInputPrompt(state: ChatColumnState): string {
  const label = state.inputPrompt.trim() || 'You'
  return `${text.success(label)} ${text.dim('› ')}`
}

/**
 * Clear the chat history
 * @param state Chat column state
 * @returns Updated state with cleared messages
 */
export function clearChat(state: ChatColumnState): ChatColumnState {
  return {
    ...state,
    messages: []
  }
}

/**
 * Get the last message from the chat
 * @param state Chat column state
 * @returns Last message or undefined if no messages
 */
export function getLastMessage(state: ChatColumnState): Message | undefined {
  return state.messages.length > 0 ? state.messages[state.messages.length - 1] : undefined
}
