import { describe, expect, it } from "bun:test";
import { convertOpenAiChatMessagesToModelMessages } from "./openai-chat-messages.ts";

describe("convertOpenAiChatMessagesToModelMessages", () => {
  it("preserves assistant tool calls and matching tool results", () => {
    const messages = convertOpenAiChatMessagesToModelMessages([
      { role: "system", content: "Be concise." },
      { role: "user", content: "Check the weather." },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: {
              name: "weather",
              arguments: JSON.stringify({ location: "Manila" }),
            },
          },
        ],
      },
      {
        role: "tool",
        tool_call_id: "call_1",
        content: "Sunny",
      },
      {
        role: "assistant",
        content: "It is sunny.",
      },
    ]);

    expect(messages).toEqual([
      { role: "system", content: "Be concise." },
      { role: "user", content: "Check the weather." },
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "call_1",
            toolName: "weather",
            input: { location: "Manila" },
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call_1",
            toolName: "weather",
            output: {
              type: "text",
              value: "Sunny",
            },
          },
        ],
      },
      {
        role: "assistant",
        content: "It is sunny.",
      },
    ]);
  });

  it("drops empty assistant text messages without tool calls", () => {
    const messages = convertOpenAiChatMessagesToModelMessages([
      { role: "user", content: "Hello" },
      { role: "assistant", content: "" },
    ]);

    expect(messages).toEqual([{ role: "user", content: "Hello" }]);
  });
});
