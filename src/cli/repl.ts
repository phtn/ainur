import { createReadline } from "./readline.ts";
import { resolveModel } from "../agent/config.ts";
import { runAgent } from "../agent/loop.ts";
import { setApprovalCallback } from "../tools/index.ts";
import { loadSettings } from "../config/settings.ts";
import type { Provider } from "../config/settings.ts";
import { handleHelp, handleConfig } from "./commands.ts";
import { runOnboard } from "./onboard.ts";
import { out } from "./output.ts";
import type { ModelMessage } from "ai";

const PROMPT = "> ";

function question(rl: ReturnType<typeof createReadline>, query: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(query, resolve);
  });
}

export async function startRepl(rl?: ReturnType<typeof createReadline>): Promise<void> {
  const replRl = rl ?? createReadline();
  let messages: ModelMessage[] = [];
  let modelOverride: { provider?: Provider; model?: string } | undefined;

  setApprovalCallback(async ({ tool, summary }) => {
    out.write("\n");
    out.cyan(`${summary} [y/n]: `);
    const answer = await question(replRl, "");
    return answer.toLowerCase().startsWith("y");
  });

  const loop = async (): Promise<void> => {
    const input = await question(replRl, PROMPT);
    const trimmed = input.trim();
    if (!trimmed) {
      loop();
      return;
    }

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
            modelOverride = { ...modelOverride, model: args[0] };
            out.println(`Model set to ${args[0]}`);
          } else {
            out.error("Usage: /model <model-id>");
          }
          break;
        case "clear":
          messages = [];
          out.println("Conversation cleared.");
          break;
        case "exit":
          replRl.close();
          process.exit(0);
        default:
          out.error(`Unknown command: /${cmd}`);
      }
      loop();
      return;
    }

    messages.push({ role: "user", content: trimmed });

    try {
      const model = resolveModel(modelOverride);
      out.write("\n");
      const { messages: newMessages } = await runAgent({
        model,
        messages,
        onChunk: (chunk) => out.write(chunk),
      });
      messages = newMessages;
      out.write("\n\n");
    } catch (err) {
      out.error(err instanceof Error ? err.message : String(err));
    }

    loop();
  };

  loop();
}
