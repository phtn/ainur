import pc from "picocolors";
// Note: Keep this file dependency-light. We avoid external color libs
// and stick to picocolors which already exists in this repo. We also
// provide small, local helpers to avoid creating circular deps on ./table.

// Minimal ANSI helpers (duplicated to avoid a theme <-> table cycle)
const ESC = String.fromCharCode(27);
const ANSI_REGEX = new RegExp(ESC + "\[[0-9;]*[a-zA-Z]", "g");
function stripAnsiCodes(text: string): string {
  return text.replace(ANSI_REGEX, "");
}
function getVisualWidth(text: string): number {
  return stripAnsiCodes(text).length;
}
function padTo(text: string, width: number): string {
  const visual = getVisualWidth(text);
  if (visual >= width) return text;
  return text + " ".repeat(width - visual);
}
function createSeparator(widths: Array<number>): string {
  const parts = widths.map((w) => "⎺".repeat(Math.max(1, w)));
  return pc.dim(parts.join(" "));
}

// Picocolors-only theme palette. We intentionally downgrade from
// hex/truecolor to the basic ANSI set for portability.
export const colors: Record<string, string> = {
  primary: "white",
  secondary: "gray",
  accent: "black",
  danger: "red",
  success: "green",
  info: "cyan",
  warning: "yellow",
};

// Simple style helpers using picocolors
const bold = (s: string) => pc.bold(s);
const dim = (s: string) => pc.dim(s);
const green = (s: string) => pc.green(s);
const red = (s: string) => pc.red(s);
const yellow = (s: string) => pc.yellow(s);
const cyan = (s: string) => pc.cyan(s);
const white = (s: string) => pc.white(s);
const black = (s: string) => pc.black(s);

// Gradients were previously provided by gradient-string; we keep the API but
// render them as plain styled text to avoid extra deps.
export type GradientFn = (text: string) => string;
export const gradients: Record<string, GradientFn> = {
  header: (s: string) => bold(white(s)),
  section: (s: string) => dim(s),
};

// Text styles
export const text = {
  header: (s: string) => bold(white(s)),
  subheader: (s: string) => bold(dim(s)),
  normal: (s: string) => cyan(s),
  dim: (s: string) => dim(s),
  accent: (s: string) => black(s),
  error: (s: string) => bold(red(s)),
  success: (s: string) => bold(green(s)),
  warning: (s: string) => bold(yellow(s)),
};

// Layout elements
export const layout = {
  divider: (): string => text.dim("-".repeat(process.stdout.columns || 80)),
  sectionDivider: (): string => text.dim("-".repeat(process.stdout.columns || 80)),
  bullet: (): string => text.dim("•"),
  arrow: (): string => text.dim("→"),
  indent: (level: number = 1): string => " ".repeat(level * 2),
};

// Status indicators
export const status = {
  high: text.error("HIGH"),
  medium: text.warning("MEDIUM"),
  low: text.warning("LOW"),
  good: text.success("GOOD"),
  poor: text.error("POOR"),
  unknown: text.dim("UNKNOWN"),
};

export const indicator = {
  high: text.error("*"),
  medium: text.warning("*"),
  low: text.normal("*"),
  good: text.success("*"),
  normal: text.normal("*"),
  unknown: text.dim("*"),
};

// Table formatting helpers (kept for API stability, implemented locally)
export const table = {
  header: (_text: string, width: number) => padTo(text.dim(_text), width),
  cell: (_t: string, width: number) => padTo(pc.white(_t), width),
  row: (cells: Array<string>) => cells.join(" "),
  separator: (widths: Array<number>) => createSeparator(widths),
};
