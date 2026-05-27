import type { ModelMessage } from "ai";
import { resolveModel } from "../agent/config.ts";
import { runAgent } from "../agent/loop.ts";
import { resolveProviderAndModel } from "../agent/model-selection.ts";
import { getCurrentSessionName, loadSession, saveSession, setCurrentSessionName } from "../config/sessions.ts";
import { getSettingsWithEnv, loadSettings, saveSettings, type Provider } from "../config/settings.ts";
import { setApprovalCallback } from "../tools/index.ts";
import { OpenTUIApp, type ChatEntry } from "../../ui/opentui-app.ts";

export async function startTuiRepl(): Promise<void> {
  let currentSession: string = getCurrentSessionName() ?? "default";
  let messages: ModelMessage[] = loadSession(currentSession);
  let modelOverride: { provider?: Provider; model?: string } | undefined;
  let abortController: AbortController | null = null;
  let isGenerating = false;

  const settings = getSettingsWithEnv();
  const contextLabel = `${settings.provider}/${settings.model}`;

  const app = new OpenTUIApp({ contextLabel });
  await app.init();

  // Load existing session messages into the UI
  for (const msg of messages) {
    if (msg.role === "user" || msg.role === "assistant") {
      const content = typeof msg.content === "string" ? msg.content : "";
      if (content) {
        app.addEntry({
          role: msg.role as "user" | "assistant",
          content,
          timestamp: new Date(),
        });
      }
    }
  }

  // Welcome message if session is empty
  if (messages.length === 0) {
    app.addEntry({
      role: "system",
      content: `Welcome to **Cale** v0.1.0\n\nModel: ${settings.provider}/${settings.model}\nSession: ${currentSession}\n\nType /help for commands, or just start chatting.`,
      timestamp: new Date(),
    });
  }

  app.focusInput();

  // ── Command handling ────────────────────────────────────────

  function handleCommand(input: string): boolean {
    const trimmed = input.trim();
    if (!trimmed.startsWith("/")) return false;

    const [cmd, ...args] = trimmed.slice(1).split(/\s+/);

    switch (cmd) {
      case "help":
        app.addEntry({
          role: "system",
          content: [
            "**Commands:**",
            "/help — Show this help",
            "/clear — Clear conversation",
            "/model <id> — Switch model",
            "/session list — List sessions",
            "/session use <name> — Switch session",
            "/session new <name> — Create session",
            "/exit — Exit Cale",
          ].join("\n"),
          timestamp: new Date(),
        });
        break;

      case "clear":
        messages = [];
        saveSession(currentSession, messages);
        app.addEntry({
          role: "system",
          content: "Conversation cleared.",
          timestamp: new Date(),
        });
        break;

      case "model":
        if (args[0]) {
          const s = getSettingsWithEnv();
          const fallbackProvider = modelOverride?.provider ?? s.provider;
          const selection = resolveProviderAndModel(args[0], fallbackProvider);
          modelOverride = { ...modelOverride, provider: selection.provider, model: selection.model };
          app.addEntry({
            role: "system",
            content: `Model set to **${selection.provider}/${selection.model}**`,
            timestamp: new Date(),
          });
          app.setContextLabel(`${selection.provider}/${selection.model}`);
        } else {
          app.addEntry({
            role: "system",
            content: "Usage: /model <model-id>",
            timestamp: new Date(),
          });
        }
        break;

      case "session": {
        const sub = args[0];
        if (sub === "list" || !sub) {
          // Inline session list display
          app.addEntry({
            role: "system",
            content: "Use `cale session list` from the terminal to see sessions.",
            timestamp: new Date(),
          });
        } else if (sub === "use") {
          const name = args[1];
          if (!name) {
            app.addEntry({ role: "system", content: "Usage: /session use <name>", timestamp: new Date() });
            break;
          }
          saveSession(currentSession, messages);
          setCurrentSessionName(name);
          currentSession = name;
          messages = loadSession(name);
          app.addEntry({ role: "system", content: `Switched to session **${name}**`, timestamp: new Date() });
        } else if (sub === "new") {
          const name = args[1];
          if (!name) {
            app.addEntry({ role: "system", content: "Usage: /session new <name>", timestamp: new Date() });
            break;
          }
          saveSession(currentSession, messages);
          setCurrentSessionName(name);
          currentSession = name;
          messages = [];
          app.addEntry({ role: "system", content: `Created session **${name}**`, timestamp: new Date() });
        } else {
          app.addEntry({ role: "system", content: `Unknown: /session ${sub}. Use: list, use, new`, timestamp: new Date() });
        }
        break;
      }

      case "exit":
      case "quit":
        saveSession(currentSession, messages);
        app.destroy();
        process.exit(0);

      default:
        app.addEntry({
          role: "system",
          content: `Unknown command: /${cmd}. Type /help for available commands.`,
          timestamp: new Date(),
        });
    }

    return true;
  }

  // ── Submit handler ──────────────────────────────────────────

  app.onSubmit(async (value) => {
    if (isGenerating) return;

    // Handle slash commands
    if (handleCommand(value)) {
      app.focusInput();
      return;
    }

    messages.push({ role: "user", content: value });
    app.addEntry({ role: "user", content: value, timestamp: new Date() });

    try {
      const model = resolveModel(modelOverride);
      abortController = new AbortController();
      isGenerating = true;
      app.setGenerating(true);
      app.blurInput();

      const t0 = performance.now();
      let firstChunk = true;
      let streamedText = "";

      // Add placeholder assistant entry for streaming
      app.addEntry({ role: "assistant", content: "…", timestamp: new Date() });

      const { text: responseText, messages: newMessages } = await runAgent({
        model,
        messages,
        abortSignal: abortController.signal,
        onChunk: (chunk) => {
          streamedText += chunk;
          app.updateLastAssistant(streamedText);
          if (firstChunk) {
            firstChunk = false;
          }
        },
      });

      isGenerating = false;
      abortController = null;
      app.setGenerating(false);

      // Finalize the entry with the complete text
      const finalText = streamedText || responseText;
      app.updateLastAssistant(finalText);

      // Append elapsed time
      const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
      app.updateLastAssistant(`${finalText}\n\n*${elapsed}s*`);

      messages = newMessages;
      saveSession(currentSession, messages);
    } catch (err) {
      isGenerating = false;
      abortController = null;
      app.setGenerating(false);

      if (err instanceof Error && err.name === "AbortError") {
        app.addEntry({ role: "system", content: "*(aborted)*", timestamp: new Date() });
      } else {
        app.addEntry({
          role: "system",
          content: `**Error:** ${err instanceof Error ? err.message : String(err)}`,
          timestamp: new Date(),
        });
      }
    }

    app.focusInput();
  });

  // ── Abort handler ──────────────────────────────────────────

  app.onAbort(() => {
    if (isGenerating && abortController) {
      abortController.abort();
      app.addEntry({ role: "system", content: "*(aborted)*", timestamp: new Date() });
      isGenerating = false;
      abortController = null;
      app.setGenerating(false);
      app.focusInput();
    }
  });

  // ── Exit handler ────────────────────────────────────────────

  app.onExit(() => {
    saveSession(currentSession, messages);
    app.destroy();
    process.exit(0);
  });

  // ── Approval callback ──────────────────────────────────────

  setApprovalCallback(async ({ tool, summary }) => {
    if (tool === "speak") return true;
    // For now, auto-approve in TUI mode
    // TODO: Add approval UI within the TUI
    return true;
  });
}
