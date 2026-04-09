import { text } from "./theme";
import pc from "picocolors";
import { wrapText } from "./layout";

/**
 * Markdown parsing utilities for terminal display
 */

// Define code block structure
export interface CodeBlock {
  language: string;
  content: string;
}

/**
 * Parse markdown text and convert to terminal-friendly format
 * @param markdown Markdown text to parse
 * @param width Maximum width for text wrapping
 * @returns Formatted text lines
 */
export function renderMarkdown(markdown: string, width: number): Array<string> {
  const lines: Array<string> = [];
  const paragraphs = markdown.split("\n\n");

  for (const paragraph of paragraphs) {
    if (isCodeBlock(paragraph)) {
      const codeBlock = parseCodeBlock(paragraph);
      renderCodeBlock(codeBlock, width).forEach((l) => lines.push(l));
    } else if (isHeader(paragraph)) {
      renderHeader(paragraph, width).forEach((l) => lines.push(l));
    } else if (isListItem(paragraph)) {
      renderListItem(paragraph, width).forEach((l) => lines.push(l));
    } else {
      renderText(paragraph, width).forEach((l) => lines.push(l));
    }

    // Add spacing between paragraphs
    lines.push("");
  }

  // Remove the last empty line
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }

  return lines;
}

/**
 * Check if text is a code block
 * @param text Text to check
 * @returns True if text is a code block
 */
function isCodeBlock(text: string): boolean {
  return text.startsWith("```") && text.endsWith("```");
}

/**
 * Parse a code block
 * @param text Code block text
 * @returns Parsed code block
 */
function parseCodeBlock(text: string): CodeBlock {
  const lines = text.split("\n");
  const firstLine = lines[0] || "";
  const language = firstLine.substring(3).trim(); // Remove ```
  const content = lines.slice(1, -1).join("\n"); // Remove first and last lines

  return {
    language,
    content,
  };
}

/**
 * Render a code block
 * @param codeBlock Code block to render
 * @param width Maximum width for text wrapping
 * @returns Formatted code block lines
 */
function renderCodeBlock(codeBlock: CodeBlock, width: number): Array<string> {
  const lines: Array<string> = [];

  // Add header
  lines.push(text.dim("┌─ ") + text.normal(codeBlock.language || "code") + text.dim(" ─┐"));

  // Add content
  const contentLines = codeBlock.content.split("\n");
  for (const line of contentLines) {
    // Truncate line if it's too long
    const truncatedLine = line.length > width - 4 ? line.substring(0, width - 4) + "..." : line;
    lines.push(text.dim("│ ") + text.normal(truncatedLine) + text.dim(" │"));
  }

  // Add footer
  lines.push(text.dim("└" + "─".repeat(Math.max(10, codeBlock.language.length + 4)) + "┘"));

  return lines;
}

/**
 * Check if text is a header
 * @param text Text to check
 * @returns True if text is a header
 */
function isHeader(text: string): boolean {
  return text.startsWith("#");
}

/**
 * Render a header
 * @param header Header text
 * @param width Maximum width for text wrapping
 * @returns Formatted header lines
 */
function renderHeader(header: string, _width: number): Array<string> {
  const level = header.match(/^#+/)?.[0].length || 1;
  const content = header.replace(/^#+\s*/, "");

  let formattedContent = content;
  if (level === 1) {
    formattedContent = text.header(content);
  } else if (level === 2) {
    formattedContent = text.subheader(content);
  } else {
    formattedContent = text.normal(content);
  }

  return [formattedContent];
}

/**
 * Check if text is a list item
 * @param text Text to check
 * @returns True if text is a list item
 */
function isListItem(text: string): boolean {
  return text.startsWith("- ") || text.startsWith("* ") || /^\d+\.\s/.test(text);
}

/**
 * Render a list item
 * @param item List item text
 * @param width Maximum width for text wrapping
 * @returns Formatted list item lines
 */
function renderListItem(item: string, _width: number): Array<string> {
  const lines: Array<string> = [];
  const content = item.replace(/^(-|\*|\d+\.)\s*/, "");

  // First line with bullet point
  lines.push(text.dim("• ") + content);

  return lines;
}

/**
 * Render regular text
 * @param text Text to render
 * @param width Maximum width for text wrapping
 * @returns Formatted text lines
 */
function renderText(content: string, width: number): Array<string> {
  return wrapText(content, width);
}

/**
 * Parse and format code snippets inline
 * @param text Text that may contain inline code
 * @returns Formatted text with inline code highlighted
 */
export function parseInlineCode(text: string): string {
  // Simple regex to find inline code (enclosed in backticks)
  return text.replace(/`([^`]+)`/g, (_, code) => pc.cyan(code));
}
