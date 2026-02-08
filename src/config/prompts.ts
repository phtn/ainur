import { join } from "node:path";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { getConfigDir } from "./settings.ts";

export const DEFAULT_SYSTEM_PROMPT = `You are cale, a minimal AI agent that helps users with coding and tasks in their terminal.
You have access to tools for reading/writing files, listing directories, searching files, running shell commands, fetching URLs, and text-to-speech.
- Use read_file to inspect code and configs.
- Use list_dir and search_files to explore the codebase.
- Use run_command for running tests, builds, or scripts (requires user approval).
- Use write_file to create or modify files (requires user approval).
- Use fetch_url to fetch web pages or API responses.
- Use speak to read text aloud via local TTS when the user asks to speak, read aloud, or use text-to-speech (requires user approval).
When running commands, writing files, or speaking, wait for user approval. Be concise and helpful.`;

export interface PromptsFile {
  active?: string;
  presets: Record<string, string>;
}

let _cache: PromptsFile | null = null;

function getPromptsPath(): string {
  return join(getConfigDir(), "prompts.json");
}

function loadPromptsRaw(): PromptsFile {
  if (_cache) return _cache;
  const path = getPromptsPath();
  if (!existsSync(path)) {
    _cache = { presets: {} };
    return _cache;
  }
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw) as Partial<PromptsFile>;
    const presets = parsed.presets && typeof parsed.presets === "object" ? parsed.presets : {};
    _cache = {
      active: typeof parsed.active === "string" ? parsed.active : undefined,
      presets,
    };
  } catch {
    _cache = { presets: {} };
  }
  return _cache;
}

function savePrompts(data: PromptsFile): void {
  const dir = getConfigDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(getPromptsPath(), JSON.stringify(data, null, 2), "utf-8");
  _cache = data;
}

/** Returns the current system prompt text (active preset or built-in default). */
export function getActiveSystemPrompt(): string {
  const data = loadPromptsRaw();
  if (data.active && data.presets[data.active]) {
    return data.presets[data.active]!;
  }
  return DEFAULT_SYSTEM_PROMPT;
}

export interface ListPresetsResult {
  active: string | null;
  presets: Record<string, string>;
}

export function listPresets(): ListPresetsResult {
  const data = loadPromptsRaw();
  const active =
    data.active && data.presets[data.active] ? data.active : null;
  return { active, presets: data.presets };
}

export function setActivePreset(name: string): void {
  const data = loadPromptsRaw();
  if (!data.presets[name]) {
    throw new Error(`Preset "${name}" does not exist. Use /prompt add first.`);
  }
  data.active = name;
  savePrompts(data);
}

export function addOrUpdatePreset(name: string, content: string): void {
  const data = loadPromptsRaw();
  data.presets[name] = content;
  if (!data.active || !data.presets[data.active]) {
    data.active = name;
  }
  savePrompts(data);
}

export function removePreset(name: string): void {
  const data = loadPromptsRaw();
  if (!data.presets[name]) {
    throw new Error(`Preset "${name}" does not exist.`);
  }
  delete data.presets[name];
  if (data.active === name) {
    data.active = Object.keys(data.presets)[0] ?? undefined;
  }
  savePrompts(data);
}

export function getPresetContent(name: string): string | undefined {
  return loadPromptsRaw().presets[name];
}
