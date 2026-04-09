import { text } from "./theme";
/**
 * Table utilities for handling ANSI escape codes and proper text alignment
 */

/**
 * Configuration for a table column
 */
export interface TableColumn {
  header: string;
  width: number;
  align?: "left" | "right" | "center";
}

/**
 * Represents a row of data in a table
 */
export interface TableRow {
  [key: string]: string;
}

/**
 * Regular expression to match ANSI escape sequences
 * Matches: ESC[ followed by any number of digits, semicolons, and ends with a letter
 */
const ESC = String.fromCharCode(27);
const ANSI_REGEX = new RegExp(ESC + '\\[[0-9;]*[a-zA-Z]', 'g');

/**
 * Strip ANSI escape codes from a string to get visual content only
 * @param text - The text that may contain ANSI escape codes
 * @returns The text with all ANSI escape codes removed
 */
export function stripAnsiCodes(text: string): string {
  return text.replace(ANSI_REGEX, "");
}

/**
 * Get the visual width of text (excluding ANSI codes)
 * @param text - The text to measure
 * @returns The visual width of the text
 */
export function getVisualWidth(text: string): number {
  return stripAnsiCodes(text).length;
}

/**
 * Pad text to a specific visual width, accounting for ANSI codes
 * @param text - The text to pad (may contain ANSI codes)
 * @param width - The target visual width
 * @param align - Alignment option: 'left', 'right', or 'center'
 * @returns The padded text maintaining ANSI codes
 */
export function padToVisualWidth(
  text: string,
  width: number,
  align: "left" | "right" | "center" = "left",
): string {
  const visualWidth = getVisualWidth(text);

  // If text is already wider than target width, return as-is
  if (visualWidth >= width) {
    return text;
  }

  const paddingNeeded = width - visualWidth;

  switch (align) {
    case "right":
      return " ".repeat(paddingNeeded) + text;

    case "center": {
      const leftPadding = Math.floor(paddingNeeded / 2);
      const rightPadding = paddingNeeded - leftPadding;
      return " ".repeat(leftPadding) + text + " ".repeat(rightPadding);
    }

    case "left":
    default:
      return text + " ".repeat(paddingNeeded);
  }
}

/**
 * Create a table separator line based on column configurations
 * @param columns - Array of column configurations
 * @returns A separator line string with appropriate dashes and spacing
 */
export function createTableSeparator(columns: Array<TableColumn>): string {
  // Error handling: return empty string if no columns provided
  if (!columns || columns.length === 0) {
    return "";
  }

  const separatorParts = columns.map((column) => {
    // Error handling: ensure width is at least 1
    const width = Math.max(1, column.width || 1);
    return "⎺".repeat(width);
  });

  return text.dim(separatorParts.join(" "));
}

/**
 * Format a complete table with proper alignment and ANSI code handling
 * @param columns - Array of column configurations
 * @param rows - Array of data rows
 * @returns Formatted table as a string with proper alignment
 */
export function formatTable(columns: Array<TableColumn>, rows: Array<TableRow>): string {
  // Error handling: return empty string if no columns provided
  if (!columns || columns.length === 0) {
    return "";
  }

  // Error handling: handle empty rows array
  if (!rows || rows.length === 0) {
    // Still show headers if columns are defined
    const headerRow = columns
      .map((column) => {
        const width = Math.max(1, column.width || 1);
        const align = column.align || "left";
        const headerText = column.header || "";
        return padToVisualWidth(headerText, width, align);
      })
      .join(" ");

    const separator = createTableSeparator(columns);
    return [headerRow, separator].filter((line) => line.length > 0).join("\n");
  }

  const result: Array<string> = [];

  // Create header row
  const headerRow = columns
    .map((column) => {
      const width = Math.max(1, column.width || 1);
      const align = column.align || "left";
      const headerText = column.header || "";
      return padToVisualWidth(headerText, width, align);
    })
    .join(" ");

  result.push(headerRow);

  // Create separator
  const separator = createTableSeparator(columns);
  if (separator) {
    result.push(separator);
  }

  // Create data rows
  rows.forEach((row) => {
    const formattedRow = columns
      .map((column) => {
        const width = Math.max(1, column.width || 1);
        const align = column.align || "left";
        // Error handling: handle missing row data
        const cellData = row[column.header] || "";
        return padToVisualWidth(cellData, width, align);
      })
      .join(" ");

    result.push(formattedRow);
  });

  return result.join("\n");
}
