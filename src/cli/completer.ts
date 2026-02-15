import { listPresets } from "../config/prompts.ts";
import { listSessions } from "../config/sessions.ts";

const COMMANDS = [
  "/help",
  "/config",
  "/model",
  "/prompt",
  "/session",
  "/heartbeat",
  "/speak",
  "/tts",
  "/onboard",
  "/clear",
  "/exit",
];

const PROMPT_SUBCOMMANDS = ["list", "use", "add", "set", "show", "remove"];
const SESSION_SUBCOMMANDS = ["list", "use", "new", "remove", "current"];
const HEARTBEAT_SUBCOMMANDS = ["status", "start", "stop", "once", "launchd"];
const HEARTBEAT_LAUNCHD_SUBCOMMANDS = ["status", "install", "uninstall", "print"];

/**
 * Tab completion for REPL commands.
 * Returns [completions, originalLine]
 */
export function completer(line: string): [string[], string] {
  const trimmed = line.trimStart();

  // Not a command - no completion
  if (!trimmed.startsWith("/")) {
    return [[], line];
  }

  const parts = trimmed.split(/\s+/);
  const cmd = parts[0] ?? "";

  // Completing the command itself
  if (parts.length === 1) {
    const matches = COMMANDS.filter((c) => c.startsWith(cmd));
    return [matches, line];
  }

  // Completing subcommands or arguments
  const sub = parts[1] ?? "";

  if (cmd === "/prompt") {
    if (parts.length === 2) {
      // Complete subcommand
      const matches = PROMPT_SUBCOMMANDS.filter((s) => s.startsWith(sub)).map(
        (s) => `${cmd} ${s}`
      );
      return [matches, line];
    }
    if (parts.length === 3) {
      // Complete preset name for use/show/remove
      const subCmd = parts[1];
      if (subCmd !== undefined && ["use", "show", "remove", "set"].includes(subCmd)) {
        const partial = parts[2] ?? "";
        const { presets } = listPresets();
        const names = Object.keys(presets).filter((n) => n.startsWith(partial));
        const matches = names.map((n) => `${cmd} ${subCmd} ${n}`);
        return [matches, line];
      }
    }
  }

  if (cmd === "/session") {
    if (parts.length === 2) {
      // Complete subcommand
      const matches = SESSION_SUBCOMMANDS.filter((s) => s.startsWith(sub)).map(
        (s) => `${cmd} ${s}`
      );
      return [matches, line];
    }
    if (parts.length === 3) {
      // Complete session name for use/remove
      const subCmd = parts[1];
      if (subCmd !== undefined && ["use", "remove"].includes(subCmd)) {
        const partial = parts[2] ?? "";
        const sessions = listSessions();
        const names = sessions
          .map((s) => s.name)
          .filter((n) => n.startsWith(partial));
        const matches = names.map((n) => `${cmd} ${subCmd} ${n}`);
        return [matches, line];
      }
    }
  }

  if (cmd === "/heartbeat") {
    if (parts.length === 2) {
      const matches = HEARTBEAT_SUBCOMMANDS.filter((s) => s.startsWith(sub)).map(
        (s) => `${cmd} ${s}`
      );
      return [matches, line];
    }
    if (parts.length === 3 && parts[1] === "launchd") {
      const partial = parts[2] ?? "";
      const matches = HEARTBEAT_LAUNCHD_SUBCOMMANDS
        .filter((s) => s.startsWith(partial))
        .map((s) => `${cmd} launchd ${s}`);
      return [matches, line];
    }
  }

  return [[], line];
}
