import pc from "picocolors";
import { startRepl } from "./cli/repl.ts";
import { runOnboard, isConfigured } from "./cli/onboard.ts";
import { runAgent } from "./agent/loop.ts";
import { resolveModel } from "./agent/config.ts";
import { setApprovalCallback } from "./tools/index.ts";
import { out } from "./cli/output.ts";
import {
  loadSettings,
  saveSettings,
  type Provider,
  type CaleSettings,
} from "./config/settings.ts";
import {
  listPresets,
  setActivePreset,
  removePreset,
  DEFAULT_SYSTEM_PROMPT,
} from "./config/prompts.ts";
import {
  listSessions,
  getCurrentSessionName,
  setCurrentSessionName,
  deleteSession,
  ensureSession,
} from "./config/sessions.ts";
import { createReadline } from "./cli/readline.ts";

function question(rl: ReturnType<typeof createReadline>, q: string): Promise<string> {
  return new Promise((resolve) => rl.question(q, resolve));
}

export async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const promptIdx = args.indexOf("-p");
  const promptArg = promptIdx >= 0 ? args[promptIdx + 1] : undefined;
  const dirIdx = args.indexOf("--dir");
  const workspace = dirIdx >= 0 ? args[dirIdx + 1] : undefined;

  if (workspace) {
    process.env.CALE_WORKSPACE = workspace;
  }

  if (args.includes("config")) {
    const configArgs = args.slice(args.indexOf("config") + 1);
    const sub = configArgs[0];
    if (sub === "get") {
      const key = configArgs[1];
      const s = loadSettings();
      if (key) {
        const v =
          key === "provider"
            ? s.provider
            : key === "model"
              ? s.model
              : key === "apiKey"
                ? s.apiKey
                : key === "ttsModel"
                  ? s.ttsModel
                  : undefined;
        console.log(v ?? "");
      } else {
        console.log(JSON.stringify(s, null, 2));
      }
      return;
    }
    if (sub === "set") {
      const key = configArgs[1] as keyof CaleSettings | undefined;
      const val = configArgs[2];
      if (!key || val === undefined) {
        console.error("Usage: cale config set <key> <value>");
        process.exit(1);
      }
      const s = loadSettings();
      if (key === "provider") {
        const valid: Provider[] = ["openai", "anthropic", "openrouter", "cohere"];
        if (!valid.includes(val as Provider)) {
          console.error(`Invalid provider. Use: ${valid.join(", ")}`);
          process.exit(1);
        }
        s.provider = val as Provider;
      } else if (key === "model") {
        s.model = val;
      } else if (key === "apiKey") {
        s.apiKey = val;
      } else {
        console.error(`Unknown config key: ${key}`);
        process.exit(1);
      }
      saveSettings(s);
      console.log(`Set ${key} = ${key === "apiKey" ? "***" : val}`);
      return;
    }
    if (sub === "list" || !sub) {
      console.log(JSON.stringify(loadSettings(), null, 2));
      return;
    }
    console.error("Usage: cale config [get|set|list] [key] [value]");
    process.exit(1);
  }

  if (promptArg !== undefined) {
    if (!isConfigured()) {
      console.error("No API key configured. Run: cale onboard");
      process.exit(1);
    }
    const rl = createReadline();
    setApprovalCallback(async ({ summary }) => {
      process.stdout.write(`\n${summary} [y/n]: `);
      const a = await question(rl, "");
      return a.toLowerCase().startsWith("y");
    });
    const model = resolveModel();
    const t0 = performance.now();
    let firstChunk = true;
    out.spinner.start("thinking");
    const { text } = await runAgent({
      model,
      messages: [{ role: "user", content: promptArg }],
      onChunk: (chunk) => {
        if (firstChunk) {
          out.spinner.stop();
          firstChunk = false;
        }
        process.stdout.write(chunk);
      },
    });
    if (firstChunk) out.spinner.stop();
    process.stdout.write(text);
    if (!text.endsWith("\n")) process.stdout.write("\n");
    out.elapsed(performance.now() - t0);
    rl.close();
    return;
  }

  if (args.includes("onboard")) {
    await runOnboard();
    return;
  }

  if (args.includes("tts") && args[args.indexOf("tts") + 1] === "install") {
    const { runTtsInstall } = await import("./cli/tts-install.ts");
    await runTtsInstall();
    return;
  }

  if (args.includes("prompt")) {
    const promptArgs = args.slice(args.indexOf("prompt") + 1);
    const sub = promptArgs[0];
    if (sub === "list" || !sub) {
      const { active, presets } = listPresets();
      const names = Object.keys(presets);
      if (names.length === 0) {
        console.log("No custom prompts. Using built-in default.");
        console.log("Add one in REPL: /prompt add <name>");
      } else {
        names.forEach((name) => {
          const marker = active === name ? " *" : "";
          console.log(`  ${name}${marker}`);
        });
        if (active) console.log(`\nActive: ${active}`);
      }
      return;
    }
    if (sub === "use") {
      const name = promptArgs[1];
      if (!name) {
        console.error("Usage: cale prompt use <name>");
        process.exit(1);
      }
      try {
        setActivePreset(name);
        console.log(`Using system prompt: ${name}`);
      } catch (e) {
        console.error("cale:", e instanceof Error ? e.message : String(e));
        process.exit(1);
      }
      return;
    }
    if (sub === "show") {
      const name = promptArgs[1];
      const { active, presets } = listPresets();
      const target = name ?? active;
      if (target && presets[target]) {
        console.log(`--- ${target} ---\n${presets[target]}`);
      } else if (!name && !active) {
        console.log("--- built-in default ---\n" + DEFAULT_SYSTEM_PROMPT);
      } else {
        console.error(name ? `Preset "${name}" not found.` : "No active preset.");
        process.exit(1);
      }
      return;
    }
    if (sub === "remove") {
      const name = promptArgs[1];
      if (!name) {
        console.error("Usage: cale prompt remove <name>");
        process.exit(1);
      }
      try {
        removePreset(name);
        console.log(`Removed preset: ${name}`);
      } catch (e) {
        console.error("cale:", e instanceof Error ? e.message : String(e));
        process.exit(1);
      }
      return;
    }
    console.error("Usage: cale prompt [list|use|show|remove] [name]");
    process.exit(1);
  }

  if (args.includes("session")) {
    const sessionArgs = args.slice(args.indexOf("session") + 1);
    const sub = sessionArgs[0];
    if (sub === "list" || !sub) {
      const sessions = listSessions();
      const current = getCurrentSessionName();
      if (sessions.length === 0) {
        console.log("No sessions yet. Start the REPL and chat to create 'default'.");
      } else {
        sessions.forEach((s) => {
          const marker = current === s.name ? " *" : "";
          const date = new Date(s.updatedAt).toLocaleString();
          console.log(`  ${s.name}${marker}  (${s.messageCount} messages, ${date})`);
        });
        if (current) console.log(`\nCurrent: ${current}`);
      }
      return;
    }
    if (sub === "use" || sub === "new") {
      const name = sessionArgs[1];
      if (!name) {
        console.error(`Usage: cale session ${sub} <name>`);
        process.exit(1);
      }
      ensureSession(name);
      setCurrentSessionName(name);
      console.log(`Using session: ${name}`);
      return;
    }
    if (sub === "remove") {
      const name = sessionArgs[1];
      if (!name) {
        console.error("Usage: cale session remove <name>");
        process.exit(1);
      }
      try {
        deleteSession(name);
        console.log(`Removed session: ${name}`);
      } catch (e) {
        console.error("cale:", e instanceof Error ? e.message : String(e));
        process.exit(1);
      }
      return;
    }
    console.error("Usage: cale session [list|use|new|remove] [name]");
    process.exit(1);
  }

  if (args.includes("--help") || args.includes("-h")) {
    const c = (s: string) => pc.cyan(s);
    const d = (s: string) => pc.dim(s);
    out.write(`
  ${pc.bold(pc.cyan("cale"))} ${d("- Minimal AI agent CLI")}

  ${pc.bold("Usage")}
  ${c("cale")}                    ${d("Start interactive REPL")}
  ${c("cale onboard")}            ${d("Run setup wizard")}
  ${c("cale -p")} ${d('"prompt"')}        ${d("One-shot prompt")}
  ${c("cale config")} ${d("get|set|list")} ${d("Manage config")}
  ${c("cale prompt")} ${d("list|use|...")} ${d("Manage system prompts")}
  ${c("cale session")} ${d("list|use|..")} ${d("Manage conversations")}
  ${c("cale tts install")}        ${d("Install Piper TTS")}
  ${c("cale --dir")} ${d("<path>")}       ${d("Set workspace directory")}

  ${pc.bold("Environment")}
  ${d("OPENAI_API_KEY, ANTHROPIC_API_KEY, OPENROUTER_API_KEY,")}
  ${d("COHERE_API_KEY (or CO_API_KEY), CALE_WORKSPACE, CALE_TTS_MODEL")}

`);
    return;
  }

  if (!isConfigured()) {
    console.log("No API key configured. Running onboarding...\n");
    const rl = createReadline();
    await runOnboard(rl);
    await startRepl(rl);
    return;
  }

  await startRepl();
}

if (import.meta.main) {
  main().catch((err) => {
    console.error("cale:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
