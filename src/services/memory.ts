import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import type { ModelMessage } from "ai";
import { getWorkspaceRoot, resolveWorkspacePath } from "../config/workspace.ts";

export const CORE_MEMORY_FILES = {
  AGENTS: "AGENTS.md",
  ARCHITECTURE: "ARCHITECTURE.md",
  HEARTBEAT: "HEARTBEAT.md",
  MAP: "MAP.md",
  MEMORY: "MEMORY.md",
  PRODUCTIVITY: "PRODUCTIVITY.md",
  RECONSTRUCTION: "RECONSTRUCTION.md",
  SOUL: "SOUL.md",
  TODO: "TODO.md",
  TOOLS: "TOOLS.md",
  USER: "USER.md",
} as const;

export type CoreMemoryAlias = keyof typeof CORE_MEMORY_FILES;

const DISTILLATION_BATCH_SIZE = 50;
const CORE_FILE_SET = new Set<string>(Object.values(CORE_MEMORY_FILES));

export interface SearchMatch {
  path: string;
  line: number;
  column: number;
  excerpt: string;
}

export interface SearchMemoryOptions {
  includeCore?: boolean;
  includeDailyNotes?: boolean;
  limit?: number;
}

function normalizeRelative(pathValue: string): string {
  return pathValue.split("\\").join("/");
}

function memoryDir(): string {
  return resolveWorkspacePath("memory");
}

function ensureMemoryDir(): string {
  const dir = memoryDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function isAllowedMemoryRelativePath(relativePath: string): boolean {
  if (CORE_FILE_SET.has(relativePath)) return true;
  if (relativePath === "memory/heartbeat-state.json") return true;
  if (relativePath.startsWith("memory/") && relativePath.endsWith(".md")) return true;
  return false;
}

export function resolveCoreMemoryPath(alias: CoreMemoryAlias): string {
  return resolveWorkspacePath(CORE_MEMORY_FILES[alias]);
}

export function resolveAllowedMemoryPath(pathValue: string): {
  absolute: string;
  relative: string;
} {
  const absolute = resolveWorkspacePath(pathValue);
  const relativePath = normalizeRelative(relative(getWorkspaceRoot(), absolute));
  if (!isAllowedMemoryRelativePath(relativePath)) {
    throw new Error(
      `Path ${pathValue} is not an allowed memory path. Use core markdown files or memory/*.md`
    );
  }
  return { absolute, relative: relativePath };
}

export async function readMemoryPath(pathValue: string): Promise<{
  absolute: string;
  relative: string;
  content: string;
}> {
  const resolved = resolveAllowedMemoryPath(pathValue);
  const file = Bun.file(resolved.absolute);
  if (!(await file.exists())) {
    throw new Error(`File not found: ${resolved.relative}`);
  }
  return {
    ...resolved,
    content: await file.text(),
  };
}

export async function readCoreMemory(alias: CoreMemoryAlias): Promise<{
  absolute: string;
  relative: string;
  content: string;
}> {
  return readMemoryPath(CORE_MEMORY_FILES[alias]);
}

export async function appendMemoryPath(
  pathValue: string,
  markdown: string
): Promise<{ absolute: string; relative: string; bytesWritten: number }> {
  const resolved = resolveAllowedMemoryPath(pathValue);
  const file = Bun.file(resolved.absolute);
  const existing = (await file.exists()) ? await file.text() : "";
  const trimmed = markdown.trim();
  const separator = existing.trim().length > 0 ? "\n\n" : "";
  const content = `${existing}${separator}${trimmed}\n`;
  await Bun.write(resolved.absolute, content);
  return {
    ...resolved,
    bytesWritten: Buffer.byteLength(trimmed, "utf-8"),
  };
}

export function getDailyMemoryPath(date = new Date()): string {
  const day = date.toISOString().slice(0, 10);
  ensureMemoryDir();
  return join(memoryDir(), `${day}.md`);
}

export async function appendDailyMemory(markdown: string, date = new Date()): Promise<string> {
  const dailyPath = getDailyMemoryPath(date);
  const file = Bun.file(dailyPath);
  const existing = (await file.exists()) ? await file.text() : "";
  const trimmed = markdown.trim();
  const separator = existing.trim().length > 0 ? "\n\n" : "";
  await Bun.write(dailyPath, `${existing}${separator}${trimmed}\n`);
  return dailyPath;
}

function stripMarkdownNoise(line: string): string {
  return line
    .replace(/^[-*]\s+/, "")
    .replace(/^#+\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(input: string, maxChars: number): string {
  if (input.length <= maxChars) return input;
  return `${input.slice(0, maxChars)}…`;
}

function extractMessageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  const parts: string[] = [];
  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    const record = part as Record<string, unknown>;
    if (typeof record.text === "string") {
      parts.push(record.text);
      continue;
    }
    if (typeof record.content === "string") {
      parts.push(record.content);
      continue;
    }
    if (
      record.type === "tool-call" &&
      typeof record.toolName === "string"
    ) {
      parts.push(`[tool:${record.toolName}]`);
    }
  }
  return parts.join(" ").trim();
}

function collectRecentRoleLines(
  messages: ModelMessage[],
  role: "user" | "assistant",
  maxItems: number
): string[] {
  const lines: string[] = [];
  for (let i = messages.length - 1; i >= 0 && lines.length < maxItems; i -= 1) {
    const message = messages[i];
    if (!message || message.role !== role) continue;
    const text = stripMarkdownNoise(extractMessageText(message.content));
    if (!text) continue;
    lines.push(truncate(text, 180));
  }
  return lines.reverse();
}

export async function appendConversationDistillation(
  messages: ModelMessage[],
  checkpoint: number
): Promise<{ appended: boolean; marker: string }> {
  const marker = `<!-- distillation-checkpoint:${checkpoint} -->`;
  const memoryPath = resolveCoreMemoryPath("MEMORY");
  const file = Bun.file(memoryPath);
  const existing = (await file.exists()) ? await file.text() : "";
  if (existing.includes(marker)) {
    return { appended: false, marker };
  }

  const userLines = collectRecentRoleLines(messages, "user", 8);
  const assistantLines = collectRecentRoleLines(messages, "assistant", 5);
  const now = new Date().toISOString();
  const block = [
    marker,
    `## Conversation Distillation ${now}`,
    `- Checkpoint: ${checkpoint} (${messages.length} total messages)`,
    `- Recent user intent: ${
      userLines.length > 0 ? userLines.map((line) => `\n  - ${line}`).join("") : "none captured"
    }`,
    `- Recent assistant output: ${
      assistantLines.length > 0
        ? assistantLines.map((line) => `\n  - ${line}`).join("")
        : "none captured"
    }`,
  ].join("\n");

  await appendMemoryPath("MEMORY.md", block);
  return { appended: true, marker };
}

export async function distillEveryNMessages(
  previousCount: number,
  messages: ModelMessage[]
): Promise<{ triggered: boolean; checkpoints: number[] }> {
  if (messages.length < DISTILLATION_BATCH_SIZE) {
    return { triggered: false, checkpoints: [] };
  }
  const prevBucket = Math.floor(previousCount / DISTILLATION_BATCH_SIZE);
  const nextBucket = Math.floor(messages.length / DISTILLATION_BATCH_SIZE);
  if (nextBucket <= prevBucket) {
    return { triggered: false, checkpoints: [] };
  }

  const checkpoints: number[] = [];
  for (let checkpoint = prevBucket + 1; checkpoint <= nextBucket; checkpoint += 1) {
    const result = await appendConversationDistillation(messages, checkpoint);
    if (result.appended) checkpoints.push(checkpoint);
  }
  return { triggered: checkpoints.length > 0, checkpoints };
}

export async function distillRecentDailyNotes(hours = 48): Promise<{
  appended: boolean;
  sourceFiles: string[];
}> {
  ensureMemoryDir();
  const dir = memoryDir();
  const entries = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^\d{4}-\d{2}-\d{2}\.md$/.test(entry.name))
    .map((entry) => entry.name)
    .sort()
    .reverse();

  const now = Date.now();
  const cutoff = now - hours * 60 * 60 * 1000;
  const sources: { name: string; content: string }[] = [];

  for (const name of entries) {
    const dayStart = Date.parse(`${name.slice(0, 10)}T00:00:00Z`);
    const dayEnd = dayStart + 24 * 60 * 60 * 1000;
    if (dayEnd < cutoff) continue;
    const absolute = join(dir, name);
    const file = Bun.file(absolute);
    if (!(await file.exists())) continue;
    const content = (await file.text()).trim();
    if (!content) continue;
    sources.push({ name, content });
  }

  if (sources.length === 0) {
    return { appended: false, sourceFiles: [] };
  }

  const marker = `<!-- memory-compaction:${new Date().toISOString().slice(0, 10)} -->`;
  const memoryPath = resolveCoreMemoryPath("MEMORY");
  const memoryFile = Bun.file(memoryPath);
  const memoryText = (await memoryFile.exists()) ? await memoryFile.text() : "";
  if (memoryText.includes(marker)) {
    return { appended: false, sourceFiles: sources.map((s) => s.name) };
  }

  const seen = new Set<string>();
  const notes: string[] = [];
  for (const source of sources) {
    for (const rawLine of source.content.split(/\r?\n/)) {
      const line = stripMarkdownNoise(rawLine);
      if (!line || line.length < 8) continue;
      if (seen.has(line.toLowerCase())) continue;
      seen.add(line.toLowerCase());
      notes.push(line);
      if (notes.length >= 16) break;
    }
    if (notes.length >= 16) break;
  }

  const compacted = [
    marker,
    `## Memory Compaction ${new Date().toISOString()}`,
    `- Source notes: ${sources.map((s) => s.name).join(", ")}`,
    "- Distilled points:",
    ...(notes.length > 0 ? notes.map((line) => `  - ${truncate(line, 180)}`) : ["  - No high-signal lines found."]),
  ].join("\n");

  await appendMemoryPath("MEMORY.md", compacted);
  return { appended: true, sourceFiles: sources.map((s) => s.name) };
}

export async function searchMemory(
  query: string,
  options: SearchMemoryOptions = {}
): Promise<SearchMatch[]> {
  const includeCore = options.includeCore ?? true;
  const includeDailyNotes = options.includeDailyNotes ?? true;
  const limit = Math.max(1, Math.min(options.limit ?? 20, 100));
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const candidates: string[] = [];
  if (includeCore) {
    for (const relativePath of CORE_FILE_SET) {
      candidates.push(resolveWorkspacePath(relativePath));
    }
  }

  if (includeDailyNotes) {
    const dir = memoryDir();
    if (existsSync(dir)) {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isFile()) continue;
        if (!entry.name.endsWith(".md")) continue;
        candidates.push(join(dir, entry.name));
      }
    }
  }

  const results: SearchMatch[] = [];
  for (const absolute of candidates) {
    if (results.length >= limit) break;
    const file = Bun.file(absolute);
    if (!(await file.exists())) continue;
    const text = await file.text();
    const lines = text.split(/\r?\n/);
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const line = lines[lineIndex] ?? "";
      const col = line.toLowerCase().indexOf(q);
      if (col < 0) continue;
      results.push({
        path: absolute,
        line: lineIndex + 1,
        column: col + 1,
        excerpt: truncate(line.trim(), 220),
      });
      if (results.length >= limit) break;
    }
  }

  return results;
}
