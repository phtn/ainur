import { tool } from "ai";
import pc from "picocolors";
import { z } from "zod";
import { requestApproval } from "./approval.ts";
import {
  distillRecentDailyNotes,
  readCoreMemory,
  readMemoryPath,
  searchMemory,
  appendMemoryPath,
  type CoreMemoryAlias,
} from "../services/memory.ts";

const coreAliasSchema = z.enum([
  "AGENTS",
  "ARCHITECTURE",
  "HEARTBEAT",
  "MAP",
  "MEMORY",
  "RECONSTRUCTION",
  "SOUL",
  "TODO",
  "TOOLS",
  "USER",
]);

function resolveTarget(target?: CoreMemoryAlias, path?: string): string {
  if (path?.trim()) return path.trim();
  const alias = target ?? "MEMORY";
  return `${alias}.md`;
}

export const memoryReadTool = tool({
  description:
    "Read core memory markdown (MEMORY.md, SOUL.md, USER.md, etc.) or memory/*.md notes.",
  inputSchema: z.object({
    target: coreAliasSchema.optional().describe("Core memory alias, e.g. MEMORY or SOUL"),
    path: z.string().optional().describe("Explicit path (allowed: core markdown files or memory/*.md)"),
    maxChars: z.number().int().positive().max(500_000).optional().default(120_000),
  }),
  execute: async ({ target, path, maxChars }) => {
    const resolved = resolveTarget(target as CoreMemoryAlias | undefined, path);
    process.stderr.write(pc.dim(`  ⚙ memory_read ${resolved}\n`));
    const data = target
      ? await readCoreMemory(target as CoreMemoryAlias)
      : await readMemoryPath(resolved);
    const truncated = data.content.length > maxChars;
    return {
      path: data.absolute,
      relativePath: data.relative,
      content: truncated ? `${data.content.slice(0, maxChars)}…` : data.content,
      truncated,
    };
  },
});

export const memoryAppendTool = tool({
  description:
    "Append markdown into MEMORY.md or memory/*.md notes. Use for durable long-term memory updates.",
  inputSchema: z.object({
    target: coreAliasSchema.optional().describe("Core memory alias (defaults to MEMORY)"),
    path: z.string().optional().describe("Explicit allowed path"),
    heading: z.string().optional().describe("Optional section heading"),
    content: z.string().describe("Markdown content to append"),
  }),
  execute: async ({ target, path, heading, content }) => {
    const resolved = resolveTarget(target as CoreMemoryAlias | undefined, path);
    const approved = await requestApproval(
      "memory_append",
      `Append ${content.length} chars to ${resolved}`
    );
    if (!approved) {
      return { written: false, message: "User declined" };
    }

    process.stderr.write(pc.dim(`  ⚙ memory_append ${resolved}\n`));
    const markdown = heading?.trim()
      ? `## ${heading.trim()}\n${content.trim()}`
      : content.trim();
    const result = await appendMemoryPath(resolved, markdown);
    return {
      written: true,
      path: result.absolute,
      relativePath: result.relative,
      bytesWritten: result.bytesWritten,
    };
  },
});

export const memorySearchTool = tool({
  description:
    "Search through core memory markdown and memory/*.md notes. Returns matching lines with file/line references.",
  inputSchema: z.object({
    query: z.string().describe("Case-insensitive text query"),
    includeCore: z.boolean().optional().default(true),
    includeDailyNotes: z.boolean().optional().default(true),
    limit: z.number().int().min(1).max(100).optional().default(20),
  }),
  execute: async ({ query, includeCore, includeDailyNotes, limit }) => {
    process.stderr.write(pc.dim(`  ⚙ memory_search "${query}"\n`));
    const matches = await searchMemory(query, {
      includeCore,
      includeDailyNotes,
      limit,
    });
    return { query, count: matches.length, matches };
  },
});

export const memoryCompactTool = tool({
  description:
    "Distill recent daily memory notes into MEMORY.md. Useful for periodic memory compaction.",
  inputSchema: z.object({
    hours: z.number().int().min(12).max(168).optional().default(48),
  }),
  execute: async ({ hours }) => {
    const approved = await requestApproval(
      "memory_compact",
      `Distill recent memory notes (${hours}h) into MEMORY.md`
    );
    if (!approved) {
      return { compacted: false, message: "User declined" };
    }
    process.stderr.write(pc.dim(`  ⚙ memory_compact ${hours}h\n`));
    const result = await distillRecentDailyNotes(hours);
    return {
      compacted: result.appended,
      sourceFiles: result.sourceFiles,
    };
  },
});
