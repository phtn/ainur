import { tool } from "ai";
import { z } from "zod";

export const fetchUrlTool = tool({
  description:
    "Fetch content from a URL via HTTP GET. Returns the response body as text. Use for reading web pages or API responses.",
  inputSchema: z.object({
    url: z.string().url().describe("The URL to fetch"),
  }),
  execute: async ({ url }) => {
    const res = await fetch(url, {
      headers: { "User-Agent": "cale/0.1.0" },
    });
    const text = await res.text();
    return {
      url,
      status: res.status,
      contentType: res.headers.get("content-type") ?? undefined,
      body: text.slice(0, 100_000),
    };
  },
});
