import { loadSettings } from "../config/settings.ts";
import {
  listPresets,
  setActivePreset,
  addOrUpdatePreset,
  removePreset,
  getPresetContent,
  DEFAULT_SYSTEM_PROMPT,
} from "../config/prompts.ts";
import {
  listSessions,
  getCurrentSessionName,
  setCurrentSessionName,
  loadSession,
  saveSession,
  deleteSession,
  ensureSession,
} from "../config/sessions.ts";
import pc from "picocolors";
import { tools } from "../tools/index.ts";
import { out } from "./output.ts";
import type { createReadline } from "./readline.ts";

export function handleHelp(): void {
  const c = (s: string) => pc.cyan(s);
  const d = (s: string) => pc.dim(s);
  out.write(`
  ${pc.bold("Commands")}
  ${c("/help")}     ${d("Show this help")}
  ${c("/config")}   ${d("Show provider and model")}
  ${c("/model")}    ${d("Switch model")} ${d("(/model gpt-4o)")}
  ${c("/prompt")}   ${d("Manage system prompts")} ${d("(list, use, add, set, show, remove)")}
  ${c("/session")}  ${d("Manage conversations")} ${d("(list, use, new, remove, current)")}
  ${c("/speak")}    ${d("Toggle text-to-speech")}
  ${c("/onboard")}  ${d("Re-run setup wizard")}
  ${c("/clear")}    ${d("Clear conversation")}
  ${c("/exit")}     ${d("Quit")}

  ${pc.bold("Tools")} ${d(Object.keys(tools).join(", "))}
`);
}

export function handleConfig(): void {
  const s = loadSettings();
  out.println(`provider: ${s.provider}`);
  out.println(`model: ${s.model}`);
}

export function handlePromptList(): void {
  const { active, presets } = listPresets();
  const names = Object.keys(presets);
  if (names.length === 0) {
    out.println("No custom prompts. Using built-in default.");
    out.println("Add one with: /prompt add <name>");
    return;
  }
  out.println("System prompt presets:");
  for (const name of names) {
    const marker = active === name ? " *" : "";
    out.println(`  ${name}${marker}`);
  }
  if (active) {
    out.println(`\nActive: ${active}`);
  }
}

export function handlePromptUse(args: string[]): void {
  const name = args[0];
  if (!name) {
    out.error("Usage: /prompt use <name>");
    return;
  }
  try {
    setActivePreset(name);
    out.println(`Using system prompt: ${name}`);
  } catch (e) {
    out.error(e instanceof Error ? e.message : String(e));
  }
}

export function handlePromptShow(args: string[]): void {
  const name = args[0];
  const { active, presets } = listPresets();
  const target = name ?? active;
  if (target) {
    const content = presets[target];
    if (content) {
      out.println(`--- ${target} ---`);
      out.println(content);
      return;
    }
  }
  if (!name && !active) {
    out.println("--- built-in default ---");
    out.println(DEFAULT_SYSTEM_PROMPT);
    return;
  }
  out.error(name ? `Preset "${name}" not found.` : "No active preset.");
}

export function handlePromptRemove(args: string[]): void {
  const name = args[0];
  if (!name) {
    out.error("Usage: /prompt remove <name>");
    return;
  }
  try {
    removePreset(name);
    out.println(`Removed preset: ${name}`);
  } catch (e) {
    out.error(e instanceof Error ? e.message : String(e));
  }
}

/** Read lines until a line that is exactly the sentinel (e.g. "."). */
function readLinesUntil(
  rl: ReturnType<typeof createReadline>,
  prompt: string,
  sentinel: string
): Promise<string> {
  return new Promise((resolve) => {
    const lines: string[] = [];
    const ask = (): void => {
      rl.question(lines.length === 0 ? prompt : "", (line) => {
        if (line.trim() === sentinel) {
          resolve(lines.join("\n").trim());
          return;
        }
        lines.push(line);
        ask();
      });
    };
    ask();
  });
}

export async function handlePromptAdd(
  args: string[],
  rl: ReturnType<typeof createReadline>
): Promise<void> {
  const name = args[0];
  if (!name) {
    out.error("Usage: /prompt add <name>");
    return;
  }
  out.println("Enter prompt text. End with a line containing only '.'");
  const content = await readLinesUntil(
    rl,
    "Prompt text: ",
    "."
  );
  if (!content) {
    out.error("Prompt content cannot be empty.");
    return;
  }
  addOrUpdatePreset(name, content);
  out.println(`Added/updated preset: ${name}`);
}

export async function handlePromptSet(
  args: string[],
  rl: ReturnType<typeof createReadline>
): Promise<void> {
  const name = args[0];
  if (!name) {
    out.error("Usage: /prompt set <name>");
    return;
  }
  const existing = getPresetContent(name);
  if (existing) {
    out.println("Current content (end with a line containing only '.'):");
    out.println(existing);
  }
  out.println("Enter new prompt text. End with a line containing only '.'");
  const content = await readLinesUntil(
    rl,
    "Prompt text: ",
    "."
  );
  if (!content) {
    out.error("Prompt content cannot be empty.");
    return;
  }
  addOrUpdatePreset(name, content);
  out.println(`Updated preset: ${name}`);
}

// --- Session commands (REPL calls save/load when switching) ---

export function handleSessionList(): void {
  const sessions = listSessions();
  const current = getCurrentSessionName();
  if (sessions.length === 0) {
    out.println("No sessions yet. Use /session new <name> or just start chatting (saved as 'default').");
    return;
  }
  out.println("Sessions:");
  for (const s of sessions) {
    const marker = current === s.name ? " *" : "";
    const date = new Date(s.updatedAt).toLocaleString();
    out.println(`  ${s.name}${marker}  (${s.messageCount} messages, ${date})`);
  }
  if (current) out.println(`\nCurrent: ${current}`);
}

export function handleSessionCurrent(): void {
  const current = getCurrentSessionName();
  if (current) {
    const messages = loadSession(current);
    out.println(`Session: ${current} (${messages.length} messages)`);
  } else {
    out.println("No current session. Use /session new <name> or /session use <name>.");
  }
}

/** Returns session name to switch to, or null. Caller must save current and load this one. */
export function handleSessionUse(args: string[]): string | null {
  const name = args[0];
  if (!name) {
    out.error("Usage: /session use <name>");
    return null;
  }
  ensureSession(name);
  setCurrentSessionName(name);
  out.println(`Using session: ${name}`);
  return name;
}

/** Returns session name to switch to (new session). Caller must save current and load this one. */
export function handleSessionNew(args: string[]): string | null {
  const name = args[0];
  if (!name) {
    out.error("Usage: /session new <name>");
    return null;
  }
  const created = ensureSession(name);
  setCurrentSessionName(name);
  out.println(created ? `New session: ${name}` : `Using session: ${name}`);
  return name;
}

/** Returns new current session name if we deleted the current one; otherwise null. Caller may need to load. */
export function handleSessionRemove(args: string[]): string | null {
  const name = args[0];
  if (!name) {
    out.error("Usage: /session remove <name>");
    return null;
  }
  const current = getCurrentSessionName();
  try {
    deleteSession(name);
    out.println(`Removed session: ${name}`);
    if (current === name) {
      const next = getCurrentSessionName();
      return next;
    }
  } catch (e) {
    out.error(e instanceof Error ? e.message : String(e));
  }
  return null;
}

