import { startRepl } from "./cli/repl.ts";
import { runOnboard, isConfigured } from "./cli/onboard.ts";
import { runAgent } from "./agent/loop.ts";
import { resolveModel } from "./agent/config.ts";
import { setApprovalCallback } from "./tools/index.ts";
import {
  loadSettings,
  saveSettings,
  type Provider,
  type CaleSettings,
} from "./config/settings.ts";
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
    const { text } = await runAgent({
      model,
      messages: [{ role: "user", content: promptArg }],
      onChunk: (chunk) => process.stdout.write(chunk),
    });
    process.stdout.write(text);
    if (!text.endsWith("\n")) process.stdout.write("\n");
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

  if (args.includes("--help") || args.includes("-h")) {
    console.log(`
cale - Minimal AI agent CLI

Usage:
  cale                    Start interactive REPL
  cale onboard            Run setup wizard (provider, model, API key)
  cale -p "prompt"        One-shot prompt
  cale config get [key]   Get config
  cale config set k v     Set config (provider, model, apiKey)
  cale config list        List config
  cale tts install        Install Piper TTS and default voice
  cale --dir <path>       Set workspace directory

Env: OPENAI_API_KEY, ANTHROPIC_API_KEY, OPENROUTER_API_KEY, COHERE_API_KEY (or CO_API_KEY), CALE_WORKSPACE, CALE_TTS_MODEL (Piper .onnx path for speak)
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
