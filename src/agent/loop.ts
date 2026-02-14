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

function isToolsUnsupportedError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return message.includes("does not support tools");
}

async function executeStream(options: {
  model: Parameters<typeof streamText>[0]["model"];
  messages: ModelMessage[];
  onChunk?: (text: string) => void;
  abortSignal?: AbortSignal;
  includeTools: boolean;
}): Promise<RunAgentResult> {
  const result = streamText({
    model: options.model,
    system: getActiveSystemPrompt(),
    messages: options.messages,
    tools: options.includeTools ? tools : undefined,
    stopWhen: stepCountIs(10),
    abortSignal: options.abortSignal,
  });

  let fullText = "";
  for await (const chunk of result.textStream) {
    fullText += chunk;
    options.onChunk?.(chunk);
  }

  const response = await result.response;
  const newMessages: ModelMessage[] = [...options.messages, ...response.messages];
  return { text: fullText, messages: newMessages };
}

export async function runAgent(options: RunAgentOptions): Promise<RunAgentResult> {
  const { model, messages, onApprove, onChunk, abortSignal } = options;

  if (onApprove !== undefined) {
    setApprovalCallback(onApprove);
  }

  try {
    return await executeStream({
      model,
      messages,
      onChunk,
      abortSignal,
      includeTools: true,
    });
  } catch (error) {
    if (!isToolsUnsupportedError(error)) {
      throw error;
    }
    return executeStream({
      model,
      messages,
      onChunk,
      abortSignal,
      includeTools: false,
    });
  }
}
