import type { ModelMessage } from "ai";

type OpenAiChatRole = "system" | "user" | "assistant" | "developer" | "tool";

interface OpenAiChatToolCall {
  id?: unknown;
  type?: unknown;
  function?: {
    name?: unknown;
    arguments?: unknown;
  };
}

export interface OpenAiChatMessage {
  role: OpenAiChatRole;
  content?: unknown;
  tool_calls?: unknown;
  tool_call_id?: unknown;
  name?: unknown;
}

type AssistantTextPart = { type: "text"; text: string };
type AssistantToolCallPart = {
  type: "tool-call";
  toolCallId: string;
  toolName: string;
  input: unknown;
};
type ToolResultPart = {
  type: "tool-result";
  toolCallId: string;
  toolName: string;
  output: { type: "text"; value: string };
};

function extractTextContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  const parts: string[] = [];
  for (const item of content) {
    if (!item || typeof item !== "object") continue;
    const part = item as { type?: unknown; text?: unknown; content?: unknown };
    if (
      (part.type === "text" || part.type === "input_text") &&
      typeof part.text === "string"
    ) {
      parts.push(part.text);
      continue;
    }
    if (typeof part.content === "string") {
      parts.push(part.content);
    }
  }
  return parts.join("\n").trim();
}

function parseToolCallInput(rawArguments: unknown): unknown {
  if (typeof rawArguments !== "string") return rawArguments;
  const trimmed = rawArguments.trim();
  if (trimmed === "" || trimmed === "null") return {};

  try {
    return JSON.parse(trimmed);
  } catch {
    return rawArguments;
  }
}

function parseToolCalls(
  rawToolCalls: unknown,
  toolNamesById: Map<string, string>
): AssistantToolCallPart[] {
  if (!Array.isArray(rawToolCalls)) return [];

  const toolCalls: AssistantToolCallPart[] = [];
  for (const rawToolCall of rawToolCalls) {
    if (!rawToolCall || typeof rawToolCall !== "object") {
      throw new Error("assistant tool_calls entries must be objects");
    }

    const toolCall = rawToolCall as OpenAiChatToolCall;
    const callId = typeof toolCall.id === "string" ? toolCall.id : "";
    if (!callId) {
      throw new Error("assistant tool_calls entries must include an id");
    }

    if (toolCall.type != null && toolCall.type !== "function") {
      throw new Error(`unsupported assistant tool call type: ${String(toolCall.type)}`);
    }

    const functionName =
      toolCall.function && typeof toolCall.function.name === "string"
        ? toolCall.function.name
        : "";
    if (!functionName) {
      throw new Error(`assistant tool call ${callId} is missing a function name`);
    }

    toolNamesById.set(callId, functionName);
    toolCalls.push({
      type: "tool-call",
      toolCallId: callId,
      toolName: functionName,
      input: parseToolCallInput(toolCall.function?.arguments),
    });
  }

  return toolCalls;
}

export function convertOpenAiChatMessagesToModelMessages(rawMessages: unknown): ModelMessage[] {
  if (!Array.isArray(rawMessages)) {
    throw new Error("messages must be an array");
  }

  const messages: ModelMessage[] = [];
  const toolNamesById = new Map<string, string>();

  for (const rawMessage of rawMessages) {
    if (!rawMessage || typeof rawMessage !== "object") {
      throw new Error("each message must be an object");
    }

    const message = rawMessage as OpenAiChatMessage;
    const role = message.role;
    if (
      role !== "system" &&
      role !== "user" &&
      role !== "assistant" &&
      role !== "developer" &&
      role !== "tool"
    ) {
      throw new Error(`unsupported message role: ${String(role)}`);
    }

    if (role === "tool") {
      const toolCallId = typeof message.tool_call_id === "string" ? message.tool_call_id : "";
      if (!toolCallId) {
        throw new Error("tool messages must include tool_call_id");
      }

      const toolName =
        toolNamesById.get(toolCallId) ??
        (typeof message.name === "string" ? message.name : "");
      if (!toolName) {
        throw new Error(`tool message ${toolCallId} is missing a matching tool name`);
      }

      messages.push({
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId,
            toolName,
            output: {
              type: "text",
              value: extractTextContent(message.content),
            },
          } satisfies ToolResultPart,
        ],
      });
      continue;
    }

    const normalizedRole = role === "developer" ? "system" : role;

    if (normalizedRole === "assistant") {
      const textContent = extractTextContent(message.content);
      const toolCalls = parseToolCalls(message.tool_calls, toolNamesById);
      const contentParts: Array<AssistantTextPart | AssistantToolCallPart> = [];

      if (textContent.trim().length > 0) {
        contentParts.push({
          type: "text",
          text: textContent,
        });
      }

      contentParts.push(...toolCalls);

      if (contentParts.length === 0) {
        continue;
      }

      const singleTextPart =
        contentParts.length === 1 &&
        contentParts[0] != null &&
        contentParts[0].type === "text"
          ? contentParts[0]
          : null;

      messages.push({
        role: "assistant",
        content: singleTextPart ? singleTextPart.text : contentParts,
      });
      continue;
    }

    const textContent = extractTextContent(message.content);
    if (normalizedRole === "user" && textContent.trim().length === 0) {
      continue;
    }

    messages.push({
      role: normalizedRole,
      content: textContent,
    });
  }

  return messages;
}
