import pc from "picocolors";
import type { ModelMessage } from "ai";
import { resolveModel } from "../agent/config.ts";
import { runAgent } from "../agent/loop.ts";
import {
  getCurrentSessionName,
  loadSession,
  saveSession,
  setCurrentSessionName,
} from "../config/sessions.ts";
import { getSettingsWithEnv, type Provider } from "../config/settings.ts";
import { setApprovalCallback, speakText } from "../tools/index.ts";
import {
  handleConfig,
  handleHelp,
  handlePromptAdd,
  handlePromptList,
  handlePromptRemove,
  handlePromptSet,
  handlePromptShow,
  handlePromptUse,
  handleSessionCurrent,
  handleSessionList,
  handleSessionNew,
  handleSessionRemove,
  handleSessionUse,
} from "./commands.ts";
import { completer } from "./completer.ts";
import { runOnboard } from "./onboard.ts";
import { out } from "./output.ts";
import { createReadline } from "./readline.ts";
import { resolveProviderAndModel } from "../agent/model-selection.ts";

function question(
  rl: ReturnType<typeof createReadline>,
  query: string
): Promise<string> {
  return new Promise((resolve) => {
    rl.question(query, resolve);
  });
}

function makePrompt(session: string): string {
  return `${pc.dim("cale")}${pc.dim(":")}${pc.cyan(session)} ${pc.green("➜")} `;
}

function printBanner(session: string): void {
  const settings = getSettingsWithEnv();
  out.write("\n");
  out.write(`  ${pc.bold(pc.cyan("cale"))} ${pc.dim("v0.1.0")}\n`);
  out.write(
    `  ${pc.dim("model")}  ${settings.provider}/${settings.model}\n`
  );
  out.write(`  ${pc.dim("session")} ${session}\n`);
  out.write(`  ${pc.dim("type")}   /help for commands\n`);
  out.write("\n");
}

export async function startRepl(
  rl?: ReturnType<typeof createReadline>
): Promise<void> {
  const replRl = rl ?? createReadline(completer);
  let currentSession: string = getCurrentSessionName() ?? "default";
  let messages: ModelMessage[] = loadSession(currentSession);
  let modelOverride: { provider?: Provider; model?: string } | undefined;
  let speechEnabled = false;
  let abortController: AbortController | null = null;
  let isGenerating = false;

  printBanner(currentSession);

  function switchToSession(name: string): void {
    saveSession(currentSession, messages);
    setCurrentSessionName(name);
    currentSession = name;
    messages = loadSession(name);
  }

  setApprovalCallback(async ({ tool, summary }) => {
    if (tool === "speak" && speechEnabled) return true;
    out.spinner.stop();
    out.write("\n");
    out.write(`  ${pc.yellow("?")} ${pc.cyan(summary)} ${pc.dim("[y/n]")}: `);
    const answer = await question(replRl, "");
    return answer.toLowerCase().startsWith("y");
  });

  replRl.on("SIGINT", () => {
    if (isGenerating && abortController) {
      abortController.abort();
      out.spinner.stop();
      out.write("\n");
      out.write(pc.dim("  (aborted)\n\n"));
      isGenerating = false;
      return;
    }
    out.write("\n");
    replRl.close();
    process.exit(0);
  });

  for (;;) {
    const input = await question(replRl, makePrompt(currentSession));
    const trimmed = input.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith("/")) {
      const [cmd, ...args] = trimmed.slice(1).split(/\s+/);
      switch (cmd) {
        case "help":
          handleHelp();
          break;
        case "config":
          handleConfig();
          break;
        case "onboard":
          await runOnboard(replRl);
          break;
        case "model":
          if (args[0]) {
            const settings = getSettingsWithEnv();
            const fallbackProvider = modelOverride?.provider ?? settings.provider;
            const selection = resolveProviderAndModel(args[0], fallbackProvider);
            modelOverride = { ...modelOverride, provider: selection.provider, model: selection.model };
            out.successLine(`Model set to ${selection.provider}/${selection.model}`);
          } else {
            out.error("Usage: /model <model-id>");
          }
          break;
        case "speak":
        case "tts":
          speechEnabled = !speechEnabled;
          out.write(
            `  ${speechEnabled ? pc.green("●") : pc.dim("○")} Speech ${speechEnabled ? "on" : "off"}\n`
          );
          break;
        case "clear":
          messages = [];
          saveSession(currentSession, messages);
          out.successLine("Conversation cleared");
          break;
        case "prompt": {
          const sub = args[0];
          if (sub === "list" || !sub) {
            handlePromptList();
          } else if (sub === "use") {
            handlePromptUse(args.slice(1));
          } else if (sub === "show") {
            handlePromptShow(args.slice(1));
          } else if (sub === "remove") {
            handlePromptRemove(args.slice(1));
          } else if (sub === "add") {
            await handlePromptAdd(args.slice(1), replRl);
          } else if (sub === "set") {
            await handlePromptSet(args.slice(1), replRl);
          } else {
            out.error(
              `Unknown: /prompt ${sub}. Use: list, use, add, set, show, remove`
            );
          }
          break;
        }
        case "session": {
          const sub = args[0];
          if (sub === "list" || !sub) {
            handleSessionList();
          } else if (sub === "use") {
            const name = handleSessionUse(args.slice(1));
            if (name) switchToSession(name);
          } else if (sub === "new") {
            const name = handleSessionNew(args.slice(1));
            if (name) switchToSession(name);
          } else if (sub === "remove") {
            const newCurrent = handleSessionRemove(args.slice(1));
            if (newCurrent !== null) switchToSession(newCurrent);
          } else if (sub === "current" || sub === "show") {
            handleSessionCurrent();
          } else {
            out.error(
              `Unknown: /session ${sub}. Use: list, use, new, remove, current`
            );
          }
          break;
        }
        case "exit":
          saveSession(currentSession, messages);
          replRl.close();
          process.exit(0);
        default:
          out.error(`Unknown command: /${cmd}`);
      }
      continue;
    }

    messages.push({ role: "user", content: trimmed });

    try {
      const model = resolveModel(modelOverride);
      abortController = new AbortController();
      isGenerating = true;
      const t0 = performance.now();
      let firstChunk = true;

      out.spinner.start("thinking");

      const { text: responseText, messages: newMessages } = await runAgent({
        model,
        messages,
        abortSignal: abortController.signal,
        onChunk: (chunk) => {
          if (firstChunk) {
            out.spinner.stop();
            out.write("\n");
            firstChunk = false;
          }
          out.write(chunk);
        },
      });

      isGenerating = false;
      abortController = null;

      if (firstChunk) out.spinner.stop();

      messages = newMessages;
      saveSession(currentSession, messages);
      out.write("\n");
      out.elapsed(performance.now() - t0);
      out.write("\n");

      if (speechEnabled && responseText.trim()) {
        speakText(responseText).catch(() => {});
      }
    } catch (err) {
      isGenerating = false;
      abortController = null;
      out.spinner.stop();
      if (err instanceof Error && err.name === "AbortError") continue;
      out.error(err instanceof Error ? err.message : String(err));
    }
  }
}
