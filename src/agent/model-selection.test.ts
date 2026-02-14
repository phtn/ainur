import { describe, expect, it } from "bun:test";
import { resolveProviderAndModel } from "./model-selection.ts";

describe("resolveProviderAndModel", () => {
  it("keeps fallback provider for plain model IDs", () => {
    expect(resolveProviderAndModel("gpt-4o", "openai")).toEqual({
      provider: "openai",
      model: "gpt-4o",
    });
  });

  it("switches provider for prefixed model IDs", () => {
    expect(resolveProviderAndModel("ollama/codestral:22b", "openai")).toEqual({
      provider: "ollama",
      model: "codestral:22b",
    });
  });

  it("ignores unknown prefixes", () => {
    expect(resolveProviderAndModel("custom/foo", "anthropic")).toEqual({
      provider: "anthropic",
      model: "custom/foo",
    });
  });
});
