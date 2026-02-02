import { loadSettings } from "../config/settings.ts";
import { tools } from "../tools/index.ts";
import { out } from "./output.ts";

export function handleHelp(): void {
  out.println(`
Commands:
  /help     Show this help
  /config   Show provider and model
  /model    Switch model (usage: /model gpt-4o)
  /speak    Toggle text-to-speech (auto-approve speak tool)
  /onboard  Re-run setup wizard
  /clear    Clear conversation
  /exit     Quit

Tools: ${Object.keys(tools).join(", ")}
`);
}

export function handleConfig(): void {
  const s = loadSettings();
  out.println(`provider: ${s.provider}`);
  out.println(`model: ${s.model}`);
}
