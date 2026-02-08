import { streamText, stepCountIs } from "ai";
import type { ModelMessage } from "ai";
import { tools, setApprovalCallback } from "../tools/index.ts";
import type { ToolApprovalCallback } from "../tools/index.ts";
import { getActiveSystemPrompt } from "../config/prompts.ts";

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
    system: getActiveSystemPrompt(),
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
