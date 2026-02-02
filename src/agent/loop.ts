import { streamText, stepCountIs } from "ai";
import type { ModelMessage } from "ai";
import { tools, setApprovalCallback } from "../tools/index.ts";
import type { ToolApprovalCallback } from "../tools/index.ts";

const SYSTEM_PROMPT = `You are cale, a minimal AI agent that helps users with coding and tasks in their terminal.
You have access to tools for reading/writing files, listing directories, searching files, running shell commands, fetching URLs, and text-to-speech.
- Use read_file to inspect code and configs.
- Use list_dir and search_files to explore the codebase.
- Use run_command for running tests, builds, or scripts (requires user approval).
- Use write_file to create or modify files (requires user approval).
- Use fetch_url to fetch web pages or API responses.
- Use speak to read text aloud via local TTS when the user asks to speak, read aloud, or use text-to-speech (requires user approval).
When running commands, writing files, or speaking, wait for user approval. Be concise and helpful.`;

export interface RunAgentOptions {
  model: Parameters<typeof streamText>[0]["model"];
  messages: ModelMessage[];
  onApprove?: ToolApprovalCallback;
  onChunk?: (text: string) => void;
  abortSignal?: AbortSignal;
}

export interface RunAgentResult {
  text: string;
  messages: ModelMessage[];
}

export async function runAgent(options: RunAgentOptions): Promise<RunAgentResult> {
  const { model, messages, onApprove, onChunk, abortSignal } = options;

  if (onApprove !== undefined) {
    setApprovalCallback(onApprove);
  }

  const result = streamText({
    model,
    system: SYSTEM_PROMPT,
    messages,
    tools,
    stopWhen: stepCountIs(10),
    abortSignal,
  });

  let fullText = "";
  for await (const chunk of result.textStream) {
    fullText += chunk;
    onChunk?.(chunk);
  }

  const response = await result.response;
  const newMessages: ModelMessage[] = [...messages, ...response.messages];

  return { text: fullText, messages: newMessages };
}
