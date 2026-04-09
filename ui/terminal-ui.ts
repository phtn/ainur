import readline from "readline";
import type { Message as ChatMessage } from "./chat-column";
import { clearScreen } from "./layout";
import { renderMarkdown } from "./markdown";
import type { OutputEntry } from "./terminal-column";
import {
    addChatMessage,
    addTerminalOutput,
    createUIState,
    renderUI,
    setTerminalRunningState,
    toggleViewMode,
    type UIState,
    type ViewMode,
} from "./toggle";

export type UIEvent =
  | { _tag: "messageAdded"; message: ChatMessage }
  | { _tag: "outputAdded"; output: OutputEntry }
  | { _tag: "terminalRunning"; isRunning: boolean; command?: string }
  | { _tag: "viewToggled"; mode: ViewMode }
  | { _tag: "uiRefresh" };

type KeypressEvent = {
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  name?: string;
};

let uiState: UIState | null = null;

function resizeUIState(state: UIState, terminalWidth: number, terminalHeight: number): UIState {
  const maxHeight = Math.max(3, Math.floor(terminalHeight * 0.6));
  return {
    ...state,
    terminalWidth,
    terminalHeight,
    chatState: {
      ...state.chatState,
      maxHeight,
    },
    terminalState: {
      ...state.terminalState,
      maxHeight,
    },
  };
}

function renderCurrentUI(): void {
  if (!uiState) {
    return;
  }

  clearScreen();
  renderUI(uiState);
}

/**
 * Initialize the terminal UI.
 * Returns a cleanup function that restores stdin state.
 */
export function initUI(): () => void {
  const terminalWidth = process.stdout.columns || 80;
  const terminalHeight = Math.max(1, (process.stdout.rows || 24) - 2);
  uiState = createUIState(terminalWidth, terminalHeight);

  renderCurrentUI();

  const handleResize = (): void => {
    if (!uiState) {
      return;
    }

    const newWidth = process.stdout.columns || 80;
    const newHeight = Math.max(1, (process.stdout.rows || 24) - 2);
    uiState = resizeUIState(uiState, newWidth, newHeight);
    renderCurrentUI();
  };

  const onKeypress = (_str: string, key?: KeypressEvent): void => {
    if (!key) {
      return;
    }

    if (key.ctrl && key.name === "c") {
      process.exit(0);
    }

    if (key.name === "tab" && uiState) {
      const nextMode =
        uiState.viewMode === "split"
          ? "chat"
          : uiState.viewMode === "chat"
            ? "terminal"
            : "split";
      uiState = toggleViewMode(uiState, nextMode);
      renderCurrentUI();
    }
  };

  process.stdout.on("resize", handleResize);

  if (process.stdin.isTTY) {
    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.setEncoding("utf8");
    process.stdin.on("keypress", onKeypress);
  }

  return () => {
    process.stdout.removeListener("resize", handleResize);
    if (process.stdin.isTTY) {
      process.stdin.removeListener("keypress", onKeypress);
      process.stdin.setRawMode(false);
    }
  };
}

/**
 * Add a chat message to the UI.
 */
export function addMessageToUI(message: ChatMessage): ChatMessage {
  if (!uiState) {
    return message;
  }

  uiState = addChatMessage(uiState, message);
  renderCurrentUI();
  return message;
}

/**
 * Add terminal output to the UI.
 */
export function addOutputToUI(output: OutputEntry): OutputEntry {
  if (!uiState) {
    return output;
  }

  uiState = addTerminalOutput(uiState, output);
  renderCurrentUI();
  return output;
}

/**
 * Set terminal running state in the UI.
 */
export function setTerminalRunningStateInUI(
  isRunning: boolean,
  command?: string,
): void {
  if (!uiState) {
    return;
  }

  uiState = setTerminalRunningState(uiState, isRunning, command);
  renderCurrentUI();
}

/**
 * Render markdown content in the UI.
 */
export function renderMarkdownInUI(
  content: string,
  width: number,
): Array<string> {
  return renderMarkdown(content, width);
}

/**
 * Handle UI events from the chat system.
 */
export function handleUIEvent(event: UIEvent): void {
  switch (event._tag) {
    case "messageAdded":
      addMessageToUI(event.message);
      break;
    case "outputAdded":
      addOutputToUI(event.output);
      break;
    case "terminalRunning":
      setTerminalRunningStateInUI(event.isRunning, event.command);
      break;
    case "viewToggled":
      if (uiState) {
        uiState = toggleViewMode(uiState, event.mode);
        renderCurrentUI();
      }
      break;
    case "uiRefresh":
      renderCurrentUI();
      break;
  }
}
