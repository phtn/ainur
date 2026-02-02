import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { tool } from "ai";
import { z } from "zod";
import { requestApproval } from "./approval.ts";

export function getWorkspaceRoot(): string {
  return process.env.CALE_WORKSPACE ?? process.cwd();
}

function resolvePath(path: string): string {
  const root = getWorkspaceRoot();
  const resolved = resolve(root, path);
  if (!resolved.startsWith(resolve(root))) {
    throw new Error(`Path ${path} is outside workspace`);
  }
  return resolved;
}

export const readFileTool = tool({
  description: "Read the contents of a file. Use for inspecting code, configs, or any text file.",
  inputSchema: z.object({
    path: z.string().describe("Relative or absolute path to the file within the workspace"),
    encoding: z.enum(["utf-8", "base64"]).optional().default("utf-8"),
  }),
  execute: async ({ path, encoding }) => {
    const abs = resolvePath(path);
    const content = readFileSync(abs, encoding as BufferEncoding);
    return { content: String(content), path: abs };
  },
});

export const writeFileTool = tool({
  description: "Write or overwrite a file. Creates parent directories if needed. Requires user approval for safety.",
  inputSchema: z.object({
    path: z.string().describe("Relative or absolute path to the file within the workspace"),
    content: z.string().describe("The content to write"),
  }),
  execute: async ({ path, content }) => {
    const approved = await requestApproval("write_file", `Write to ${path} (${content.length} chars)`);
    if (!approved) {
      return { path: "", written: false, message: "User declined" };
    }
    const abs = resolvePath(path);
    writeFileSync(abs, content, "utf-8");
    return { path: abs, written: true };
  },
});

export const listDirTool = tool({
  description: "List files and directories in a path. Returns names and types.",
  inputSchema: z.object({
    path: z.string().optional().default(".").describe("Directory path relative to workspace"),
  }),
  execute: async ({ path }) => {
    const abs = resolvePath(path);
    const entries = readdirSync(abs, { withFileTypes: true });
    return {
      path: abs,
      entries: entries.map((e) => ({
        name: e.name,
        type: e.isDirectory() ? "directory" : e.isFile() ? "file" : "other",
      })),
    };
  },
});

export const searchFilesTool = tool({
  description: "Search for files matching a glob pattern. Returns matching file paths.",
  inputSchema: z.object({
    pattern: z.string().describe("Glob pattern (e.g. '*.ts', 'src/**/*.ts')"),
    basePath: z.string().optional().default(".").describe("Base directory to search from"),
  }),
  execute: async ({ pattern, basePath }) => {
    const abs = resolvePath(basePath);
    const glob = new Bun.Glob(pattern);
    const matches: string[] = [];
    for await (const file of glob.scan({ cwd: abs, absolute: true, onlyFiles: true })) {
      matches.push(file);
    }
    return { pattern, matches };
  },
});
