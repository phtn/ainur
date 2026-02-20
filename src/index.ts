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
import { resolveProviderAndModel } from "./agent/model-selection.ts";
import {
  getHeartbeatStatus,
  runHeartbeatOnce,
  runHeartbeatService,
  startHeartbeatDaemon,
  stopHeartbeatDaemon,
} from "./services/heartbeat.ts";
import {
  getLaunchdStatus,
  installHeartbeatLaunchd,
  readHeartbeatLaunchdPlist,
  uninstallHeartbeatLaunchd,
} from "./services/launchd.ts";
import { importMemoryFromSqlite } from "./services/sqlite-memory.ts";
import { runSttCli } from "./cli/stt.ts";
import {
  probeGatewayStatus,
  startGatewayServer,
} from "./services/gateway.ts";
import {
  fetchTtsVoiceOptions,
  getConfiguredTtsEndpoint,
  getTtsVoiceIdFromEndpoint,
  withTtsVoice,
} from "./cli/tts-voice.ts";

function question(rl: ReturnType<typeof createReadline>, q: string): Promise<string> {
  return new Promise((resolve) => rl.question(q, resolve));
}

function readOption(args: string[], key: string): string | undefined {
  const kvPrefix = `${key}=`;
  const kv = args.find((arg) => arg.startsWith(kvPrefix));
  if (kv) return kv.slice(kvPrefix.length);
  const idx = args.indexOf(key);
  if (idx >= 0) return args[idx + 1];
  return undefined;
}

function ensureGatewayAutoStart(): void {
  const result = startGatewayServer({ auto: true });
  if (!result.started) {
    if (
      result.message.includes("auto-start is disabled") ||
      result.message.includes("Gateway is disabled") ||
      result.message.toLowerCase().includes("in use")
    ) {
      return;
    }
    process.stderr.write(pc.dim(`gateway: ${result.message}\n`));
    return;
  }
  if (!result.alreadyRunning) {
    process.stderr.write(pc.dim(`gateway: ${result.message}\n`));
  }
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
                : key === "ttsEndpoint"
                    ? s.ttsEndpoint
                    : key === "ttsProvider"
                      ? s.ttsProvider
                    : key === "sttEndpoint"
                      ? s.sttEndpoint
                    : key === "sttProvider"
                      ? s.sttProvider
                  : key === "soulAlignment"
                    ? s.soulAlignment
                    : key === "soulTemperature"
                      ? s.soulTemperature
                      : key === "gatewayEnabled"
                        ? s.gatewayEnabled
                        : key === "gatewayAutoStart"
                          ? s.gatewayAutoStart
                          : key === "gatewayPort"
                            ? s.gatewayPort
                            : key === "gatewayBind"
                              ? s.gatewayBind
                              : key === "gatewayToken"
                                ? s.gatewayToken
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
        const valid: Provider[] = ["openai", "anthropic", "openrouter", "cohere", "ollama"];
        if (!valid.includes(val as Provider)) {
          console.error(`Invalid provider. Use: ${valid.join(", ")}`);
          process.exit(1);
        }
        s.provider = val as Provider;
      } else if (key === "model") {
        const selection = resolveProviderAndModel(val, s.provider);
        s.provider = selection.provider;
        s.model = selection.model;
      } else if (key === "apiKey") {
        s.apiKey = val;
      } else if (key === "ttsModel") {
        s.ttsModel = val;
      } else if (key === "ttsEndpoint") {
        s.ttsEndpoint = val;
      } else if (key === "ttsProvider") {
        const normalized = val.trim().toLowerCase();
        if (normalized !== "endpoint" && normalized !== "piper") {
          console.error("ttsProvider must be one of: endpoint, piper");
          process.exit(1);
        }
        s.ttsProvider = normalized;
      } else if (key === "sttEndpoint") {
        s.sttEndpoint = val;
      } else if (key === "sttProvider") {
        const normalized = val.trim().toLowerCase();
        if (normalized !== "openai" && normalized !== "endpoint") {
          console.error("sttProvider must be one of: openai, endpoint");
          process.exit(1);
        }
        s.sttProvider = normalized;
      } else if (key === "soulAlignment") {
        const parsed = val.toLowerCase();
        if (!["true", "false", "1", "0", "yes", "no"].includes(parsed)) {
          console.error("soulAlignment must be true/false");
          process.exit(1);
        }
        s.soulAlignment = ["true", "1", "yes"].includes(parsed);
      } else if (key === "soulTemperature") {
        const parsed = Number.parseFloat(val);
        if (!Number.isFinite(parsed) || parsed < 0 || parsed > 2) {
          console.error("soulTemperature must be a number between 0 and 2");
          process.exit(1);
        }
        s.soulTemperature = parsed;
      } else if (key === "gatewayEnabled") {
        const normalized = val.trim().toLowerCase();
        if (!["true", "false", "1", "0", "yes", "no"].includes(normalized)) {
          console.error("gatewayEnabled must be true/false");
          process.exit(1);
        }
        s.gatewayEnabled = ["true", "1", "yes"].includes(normalized);
      } else if (key === "gatewayAutoStart") {
        const normalized = val.trim().toLowerCase();
        if (!["true", "false", "1", "0", "yes", "no"].includes(normalized)) {
          console.error("gatewayAutoStart must be true/false");
          process.exit(1);
        }
        s.gatewayAutoStart = ["true", "1", "yes"].includes(normalized);
      } else if (key === "gatewayPort") {
        const parsed = Number.parseInt(val, 10);
        if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 65535) {
          console.error("gatewayPort must be an integer between 1 and 65535");
          process.exit(1);
        }
        s.gatewayPort = parsed;
      } else if (key === "gatewayBind") {
        const trimmed = val.trim();
        if (!trimmed) {
          console.error("gatewayBind cannot be empty");
          process.exit(1);
        }
        s.gatewayBind = trimmed === "loopback" ? "127.0.0.1" : trimmed === "lan" ? "0.0.0.0" : trimmed;
      } else if (key === "gatewayToken") {
        s.gatewayToken = val.trim() || undefined;
      } else {
        console.error(`Unknown config key: ${key}`);
        process.exit(1);
      }
      saveSettings(s);
      if (key === "model") {
        console.log(`Set provider = ${s.provider}`);
        console.log(`Set model = ${s.model}`);
      } else {
        console.log(`Set ${key} = ${key === "apiKey" ? "***" : val}`);
      }
      return;
    }
    if (sub === "list" || !sub) {
      console.log(JSON.stringify(loadSettings(), null, 2));
      return;
    }
    console.error("Usage: cale config [get|set|list] [key] [value]");
    process.exit(1);
  }

  if (args.includes("memory")) {
    const memoryArgs = args.slice(args.indexOf("memory") + 1);
    const sub = memoryArgs[0] ?? "help";

    if (sub === "import-sqlite" || sub === "load-sqlite") {
      try {
        const dbPath = readOption(memoryArgs, "--db");
        const entryPath = readOption(memoryArgs, "--entry") ?? readOption(memoryArgs, "--path");
        const outputPath = readOption(memoryArgs, "--out");
        const result = importMemoryFromSqlite({
          dbPath,
          entryPath,
          outputPath,
        });
        console.log(`Imported ${result.entryPath} from ${result.dbPath}`);
        console.log(`Wrote ${result.chars} chars to ${result.outputPath}`);
        if (typeof result.updatedAt === "number") {
          console.log(`Chunk updated_at: ${result.updatedAt}`);
        }
      } catch (error) {
        console.error("cale:", error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
      return;
    }

    console.error("Usage: cale memory import-sqlite [--db <path>] [--entry MEMORY.md] [--out MEMORY.md]");
    process.exit(1);
  }

  if (args.includes("heartbeat")) {
    const heartbeatArgs = args.slice(args.indexOf("heartbeat") + 1);
    const sub = heartbeatArgs[0] ?? "status";

    if (sub === "launchd") {
      const launchdSub = heartbeatArgs[1] ?? "status";
      if (launchdSub === "status") {
        const status = getLaunchdStatus();
        console.log(`supported: ${status.supported ? "yes" : "no"}`);
        console.log(`installed: ${status.installed ? "yes" : "no"}`);
        console.log(`loaded: ${status.loaded ? "yes" : "no"}`);
        console.log(`label: ${status.label}`);
        console.log(`plist: ${status.plistPath}`);
        if (status.details) console.log(`details: ${status.details}`);
        return;
      }

      if (launchdSub === "install") {
        const pollArg = heartbeatArgs.find((arg) => arg.startsWith("--poll="));
        const poll = pollArg ? Number.parseInt(pollArg.split("=")[1] ?? "", 10) : undefined;
        const result = installHeartbeatLaunchd({
          heartbeatPollSeconds: Number.isFinite(poll) ? poll : undefined,
        });
        if (!result.ok) {
          console.error(result.message);
          process.exit(1);
        }
        console.log(result.message);
        console.log(`plist: ${result.plistPath}`);
        return;
      }

      if (launchdSub === "uninstall") {
        const result = uninstallHeartbeatLaunchd();
        if (!result.ok) {
          console.error(result.message);
          process.exit(1);
        }
        console.log(result.message);
        console.log(`plist: ${result.plistPath}`);
        return;
      }

      if (launchdSub === "print") {
        const plist = readHeartbeatLaunchdPlist();
        if (!plist) {
          console.error("Heartbeat launchd plist is not installed.");
          process.exit(1);
        }
        console.log(plist);
        return;
      }

      console.error("Usage: cale heartbeat launchd [status|install|uninstall|print] [--poll=60]");
      process.exit(1);
    }

    if (sub === "start") {
      const result = startHeartbeatDaemon();
      if (result.pid) {
        console.log(`${result.message ?? "Heartbeat daemon started."} pid=${result.pid}`);
      } else {
        console.error(result.message ?? "Heartbeat daemon failed to start.");
        process.exit(1);
      }
      console.log(`log: ${result.logPath}`);
      return;
    }

    if (sub === "run") {
      console.log("Heartbeat service running. Press Ctrl+C to stop.");
      await runHeartbeatService();
      return;
    }

    if (sub === "once") {
      const result = await runHeartbeatOnce({ speakUrgent: true });
      if (result.dueCount === 0) {
        console.log("HEARTBEAT_OK");
        return;
      }
      result.runs.forEach((run) => {
        console.log(`${run.ok ? "✓" : "✗"} ${run.title}: ${run.summary}`);
      });
      if (!result.ok) process.exit(1);
      return;
    }

    if (sub === "status") {
      const status = getHeartbeatStatus();
      console.log(`running: ${status.running ? "yes" : "no"}`);
      if (status.runtime) {
        console.log(`pid: ${status.runtime.pid}`);
        console.log(`startedAt: ${status.runtime.startedAt}`);
        console.log(`workspace: ${status.runtime.workspace}`);
      }
      console.log(`state: ${status.statePath}`);
      console.log(`log: ${status.logPath}`);
      return;
    }

    if (sub === "stop") {
      const result = stopHeartbeatDaemon();
      if (result.stopped) {
        console.log(result.message);
      } else {
        console.error(result.message);
        process.exit(1);
      }
      return;
    }

    console.error("Usage: cale heartbeat [start|run|once|status|stop|launchd]");
    process.exit(1);
  }

  if (args.includes("gateway")) {
    const gatewayArgs = args.slice(args.indexOf("gateway") + 1);
    const sub = gatewayArgs[0] ?? "status";

    if (sub === "start") {
      const result = startGatewayServer();
      if (!result.started) {
        console.error(result.message);
        process.exit(1);
      }
      console.log(result.message);
      return;
    }

    if (sub === "status") {
      const status = await probeGatewayStatus();
      console.log(`running: ${status.running ? "yes" : "no"}`);
      if (status.host) console.log(`host: ${status.host}`);
      if (status.port) console.log(`port: ${status.port}`);
      if (status.url) console.log(`url: ${status.url}`);
      if (status.running && status.startedAt) console.log(`startedAt: ${status.startedAt}`);
      return;
    }

    console.error("Usage: cale gateway [start|status]");
    process.exit(1);
  }

  if (promptArg !== undefined) {
    ensureGatewayAutoStart();
    if (!isConfigured()) {
      console.error("No API key configured. Run: cale onboard");
      process.exit(1);
    }
    const isInteractive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
    const rl = isInteractive ? createReadline() : null;
    let pipedAnswers: string[] = [];
    if (!isInteractive) {
      const pipedInput = await Bun.stdin.text();
      pipedAnswers = pipedInput
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
    }
    setApprovalCallback(async ({ summary }) => {
      out.spinner.stop();
      if (!isInteractive) {
        const answer = pipedAnswers.shift();
        if (!answer) return false;
        process.stdout.write(`\n${summary} [${answer}]\n`);
        return answer.toLowerCase().startsWith("y");
      }
      const a = await question(rl!, `\n${summary} [y/n]: `);
      return a.toLowerCase().startsWith("y");
    });
    const model = resolveModel();
    const t0 = performance.now();
    let firstChunk = true;
    let streamedText = "";
    out.spinner.start("thinking");
    const { text } = await runAgent({
      model,
      messages: [{ role: "user", content: promptArg }],
      onChunk: (chunk) => {
        if (firstChunk) {
          out.spinner.stop();
          firstChunk = false;
        }
        streamedText += chunk;
        process.stdout.write(chunk);
      },
    });
    if (firstChunk) out.spinner.stop();
    if (!streamedText && text) process.stdout.write(text);
    if (!text.endsWith("\n")) process.stdout.write("\n");
    out.elapsed(performance.now() - t0);
    rl?.close();
    return;
  }

  if (args.includes("onboard")) {
    await runOnboard();
    return;
  }

  if (args.includes("stt")) {
    const sttArgs = args.slice(args.indexOf("stt") + 1);
    try {
      await runSttCli(sttArgs);
    } catch (error) {
      console.error("cale:", error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
    return;
  }

  if (args.includes("tts")) {
    const ttsArgs = args.slice(args.indexOf("tts") + 1);
    const sub = ttsArgs[0];

    if (sub === "install") {
      const { runTtsInstall } = await import("./cli/tts-install.ts");
      await runTtsInstall();
      return;
    }

    if (sub === "endpoint") {
      const endpoint = ttsArgs[1];
      if (!endpoint) {
        console.log(getConfiguredTtsEndpoint());
        return;
      }
      const s = loadSettings();
      s.ttsEndpoint = endpoint;
      saveSettings(s);
      console.log(`Set ttsEndpoint = ${endpoint}`);
      return;
    }

    if (sub === "voice") {
      const voiceIdArg = ttsArgs[1];
      const shouldList = !voiceIdArg || voiceIdArg === "list" || voiceIdArg === "ls";

      if (shouldList) {
        const endpoint = getConfiguredTtsEndpoint();
        const currentVoice = getTtsVoiceIdFromEndpoint(endpoint);
        const result = await fetchTtsVoiceOptions(endpoint);
        if (!result.options.length) {
          console.error(`No voice options found. ${result.error ?? ""}`.trim());
          process.exit(1);
        }
        console.log(`endpoint: ${endpoint}`);
        if (result.sourceUrl && result.method) {
          console.log(`source: ${result.method} ${result.sourceUrl}`);
        }
        if (currentVoice) console.log(`currentVoice: ${currentVoice}`);
        result.options.forEach((option) => {
          const marker = option.id === currentVoice ? "*" : " ";
          const label = option.label && option.label !== option.id ? ` (${option.label})` : "";
          console.log(` ${marker} ${option.id}${label}`);
        });
        return;
      }

      const endpoint = getConfiguredTtsEndpoint();
      const nextEndpoint = withTtsVoice(endpoint, voiceIdArg);
      const s = loadSettings();
      s.ttsEndpoint = nextEndpoint;
      saveSettings(s);
      console.log(`Set voice = ${voiceIdArg}`);
      console.log(`Set ttsEndpoint = ${nextEndpoint}`);
      if (process.env.CALE_TTS_ENDPOINT) {
        console.log("Note: CALE_TTS_ENDPOINT is set and will override saved config in this session.");
      }
      return;
    }

    console.error("Usage: cale tts install | endpoint <url> | voice [voice-id|list]");
    process.exit(1);
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
  ${c("cale memory import-sqlite")} ${d("--db ...")} ${d("Load memory from SQLite into markdown")}
  ${c("cale prompt")} ${d("list|use|...")} ${d("Manage system prompts")}
  ${c("cale session")} ${d("list|use|..")} ${d("Manage conversations")}
  ${c("cale heartbeat")} ${d("start|run|...")} ${d("Heartbeat service control")}
  ${c("cale gateway")} ${d("start|status")} ${d("API gateway control")}
  ${c("cale heartbeat launchd")} ${d("status|install|...")} ${d("Install heartbeat as launchd agent")}
  ${c("cale tts install")}        ${d("Install Piper TTS")}
  ${c("cale tts endpoint")} ${d("<url>")} ${d("Use HTTP TTS endpoint")}
  ${c("cale tts voice")} ${d("[voice-id|list]")} ${d("List/set endpoint voice from API options")}
  ${c("cale stt")} ${d("[audio-file]")}    ${d("Speech-to-text via OpenAI or configured endpoint")}
  ${c("REPL hotkey: \\")}          ${d("Record voice for 5s at empty prompt, then auto-send")}
  ${c("cale --dir")} ${d("<path>")}       ${d("Set workspace directory")}

  ${pc.bold("Environment")}
  ${d("OPENAI_API_KEY, ANTHROPIC_API_KEY, OPENROUTER_API_KEY,")}
  ${d("COHERE_API_KEY (or CO_API_KEY), CALE_WORKSPACE, CALE_EXTRA_WORKSPACES,")}
  ${d("CALE_TTS_MODEL, CALE_TTS_ENDPOINT, CALE_TTS_PROVIDER, CALE_STT_ENDPOINT, CALE_STT_PROVIDER,")}
  ${d("CALE_SOUL_ALIGNMENT, CALE_SOUL_TEMPERATURE,")}
  ${d("CALE_GATEWAY_ENABLED, CALE_GATEWAY_AUTO_START, CALE_GATEWAY_PORT, CALE_GATEWAY_BIND, CALE_GATEWAY_TOKEN")}

`);
    return;
  }

  if (!isConfigured()) {
    console.log("No API key configured. Running onboarding...\n");
    const rl = createReadline();
    await runOnboard(rl);
    ensureGatewayAutoStart();
    await startRepl(rl);
    return;
  }

  ensureGatewayAutoStart();
  await startRepl();
}

if (import.meta.main) {
  main().catch((err) => {
    console.error("cale:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
