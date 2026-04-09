import { text } from "./theme";
import { getVisualWidth, stripAnsiCodes, padToVisualWidth } from "./table";

/**
 * Layout manager for the two-column terminal UI with brutalist design
 */

// Define the column structure
export interface Column {
  width: number;
  content: Array<string>;
}

// Define the layout configuration
export interface LayoutConfig {
  leftColumn: Column;
  rightColumn: Column;
  separatorChar?: string;
}

/**
 * Calculate column widths based on terminal size
 * @param totalWidth Total terminal width
 * @param leftRatio Ratio for left column (0-1)
 * @returns Object with left and right column widths
 */
export function calculateColumnWidths(
  totalWidth: number,
  leftRatio: number = 0.6,
) {
  const leftWidth = Math.floor(totalWidth * leftRatio);
  const rightWidth = totalWidth - leftWidth - 1; // -1 for separator
  return { leftWidth, rightWidth };
}

/**
 * Create a separator line between columns
 * @param width Total width of the separator
 * @param char Character to use for the separator
 * @returns Formatted separator string
 */
export function createSeparator(width: number, char: string = "│"): string {
  return text.dim(char.repeat(width));
}

/**
 * Wrap text to fit within a specified width
 * @param text Text to wrap
 * @param width Maximum width
 * @returns Array of wrapped lines
 */
export function wrapText(input: string, width: number): Array<string> {
  const out: Array<string> = [];
  if (width <= 1) return [input];
  const words = input.split(/\s+/);
  let line = "";
  for (const w of words) {
    if (!w) continue;
    const candidate = line ? line + " " + w : w;
    if (getVisualWidth(candidate) <= width) {
      line = candidate;
      continue;
    }
    if (line) out.push(line);
    // If a single word is longer than width, hard-split it
    let remaining = w;
    while (getVisualWidth(remaining) > width) {
      out.push(remaining.slice(0, width));
      remaining = remaining.slice(width);
    }
    line = remaining;
  }
  if (line) out.push(line);
  return out;
}

/**
 * Render the two-column layout
 * @param config Layout configuration
 * @param terminalWidth Width of the terminal
 * @returns Formatted layout string
 */
export function renderLayout(
  config: LayoutConfig,
  terminalWidth: number,
): string {
  const { leftWidth, rightWidth } = calculateColumnWidths(terminalWidth);

  const leftLines = prepareColumnContent(config.leftColumn.content, leftWidth);
  const rightLines = prepareColumnContent(config.rightColumn.content, rightWidth);

  const rows = Math.max(leftLines.length, rightLines.length);
  const sep = text.dim("|");
  const out: Array<string> = [];
  for (let i = 0; i < rows; i++) {
    const l = padToVisualWidth(leftLines[i] ?? "", leftWidth);
    const r = padToVisualWidth(rightLines[i] ?? "", rightWidth);
    out.push(`${l}${sep}${r}`);
  }

  // Bottom border
  out.push(
    text.dim("-".repeat(leftWidth)) + text.normal("-") + text.dim("-".repeat(rightWidth)),
  );

  return out.join("\n");
}

/**
 * Prepare column content by wrapping text and handling empty lines
 * @param content Array of content lines
 * @param width Maximum width for the column
 * @returns Formatted content lines
 */
function prepareColumnContent(
  content: Array<string>,
  width: number,
): Array<string> {
  const result: Array<string> = [];

  for (const line of content) {
    if (line === "") {
      result.push("");
    } else {
      const wrapped = wrapText(line, width);
      result.push(...wrapped);
    }
  }

  return result;
}

/**
 * Clear the terminal screen
 */
export function clearScreen(): void {
  process.stdout.write("\x1Bc");
}

/**
 * Move cursor to specific position
 * @param x X position (column)
 * @param y Y position (row)
 */
export function moveCursor(x: number, y: number): void {
  process.stdout.write(`\x1B[${y + 1};${x + 1}H`);
}

/**
 * Hide the cursor
 */
export function hideCursor(): void {
  process.stdout.write("\x1B[?25l");
}

/**
 * Show the cursor
 */
export function showCursor(): void {
  process.stdout.write("\x1B[?25h");
}
