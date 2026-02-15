import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { tool } from "ai";
import pc from "picocolors";
import { z } from "zod";
import { requestApproval } from "./approval.ts";
import { getWorkspaceRoot, resolveWorkspacePath } from "../config/workspace.ts";

function sanitizeToolName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function toCamelCase(name: string): string {
  return name
    .replace(/[-_](\w)/g, (_, c: string) => c.toUpperCase())
    .replace(/^(\w)/, (_, c: string) => c.toLowerCase());
}

function toToolKey(name: string): string {
  return name.replace(/-/g, "_");
}

function escapeTemplateString(value: string): string {
  return value.replace(/`/g, "\\`");
}

function buildTemplate(name: string, exportName: string, description: string): string {
  const toolKey = toToolKey(name);
  return `import { tool } from "ai";
import { z } from "zod";

export const ${exportName} = tool({
  description: "${escapeTemplateString(description)}",
  inputSchema: z.object({
    input: z.string().describe("Input text"),
  }),
  execute: async ({ input }) => {
    return { tool: "${toolKey}", output: input };
  },
});
`;
}

function insertAfterLastImport(source: string, line: string): string {
  if (source.includes(line)) return source;
  const matches = [...source.matchAll(/^import .*;$/gm)];
  if (matches.length === 0) return `${line}\n${source}`;
  const last = matches[matches.length - 1]!;
  const insertPos = (last.index ?? 0) + last[0].length;
  return `${source.slice(0, insertPos)}\n${line}${source.slice(insertPos)}`;
}

function addToolToRegistry(source: string, toolKey: string, exportName: string): string {
  const anchor = "export const tools: ToolSet = {";
  const start = source.indexOf(anchor);
  if (start < 0) {
    throw new Error("Could not locate tools registry in src/tools/index.ts");
  }
  const end = source.indexOf("\n};", start);
  if (end < 0) {
    throw new Error("Could not locate end of tools registry in src/tools/index.ts");
  }

  const entry = `  ${toolKey}: ${exportName},`;
  const body = source.slice(start, end);
  if (body.includes(entry)) return source;

  const updatedBody = `${body}\n${entry}`;
  return `${source.slice(0, start)}${updatedBody}${source.slice(end)}`;
}

function appendExportLine(source: string, line: string): string {
  if (source.includes(line)) return source;
  const trimmed = source.endsWith("\n") ? source : `${source}\n`;
  return `${trimmed}${line}\n`;
}

function registerToolInIndex(options: {
  fileBasename: string;
  exportName: string;
  toolKey: string;
}): void {
  const indexPath = resolveWorkspacePath("src/tools/index.ts");
  const source = readFileSync(indexPath, "utf-8");
  const importLine = `import { ${options.exportName} } from "./${options.fileBasename}.ts";`;
  const exportLine = `export { ${options.exportName} } from "./${options.fileBasename}.ts";`;

  let updated = source;
  updated = insertAfterLastImport(updated, importLine);
  updated = addToolToRegistry(updated, options.toolKey, options.exportName);
  updated = appendExportLine(updated, exportLine);

  if (updated !== source) {
    writeFileSync(indexPath, updated, "utf-8");
  }
}

export const toolSmithTool = tool({
  description:
    "Create new TypeScript tools under src/tools and optionally auto-register them in src/tools/index.ts.",
  inputSchema: z.object({
    name: z.string().describe("Tool file name without extension, e.g. my-tool"),
    description: z.string().optional().default("A generated tool."),
    code: z.string().optional().describe("Optional full TypeScript module body"),
    exportName: z
      .string()
      .optional()
      .describe("Export const name (defaults to camelCase(name)+'Tool')"),
    toolKey: z
      .string()
      .optional()
      .describe("Registry key in tools object (defaults to name with hyphens replaced by underscores)"),
    overwrite: z.boolean().optional().default(false),
    autoRegister: z.boolean().optional().default(true),
  }),
  execute: async ({
    name,
    description,
    code,
    exportName,
    toolKey,
    overwrite,
    autoRegister,
  }) => {
    const normalizedName = sanitizeToolName(name);
    if (!normalizedName) {
      throw new Error("Tool name must include alphanumeric characters.");
    }

    const resolvedExport = exportName?.trim() || `${toCamelCase(normalizedName)}Tool`;
    const resolvedToolKey = toolKey?.trim() || toToolKey(normalizedName);
    const relativePath = `src/tools/${normalizedName}.ts`;
    const absolutePath = resolveWorkspacePath(relativePath);

    const approved = await requestApproval(
      "tool_smith",
      `Create tool ${resolvedToolKey} at ${relativePath}${autoRegister ? " and register it" : ""}`
    );
    if (!approved) {
      return { created: false, message: "User declined" };
    }

    if (existsSync(absolutePath) && !overwrite) {
      return {
        created: false,
        message: `File already exists: ${relativePath}. Set overwrite=true to replace.`,
      };
    }

    const moduleCode = code?.trim() || buildTemplate(normalizedName, resolvedExport, description);

    process.stderr.write(pc.dim(`  ⚙ tool_smith ${relativePath}\n`));
    writeFileSync(absolutePath, `${moduleCode.trim()}\n`, "utf-8");

    let hotReloaded = false;
    if (autoRegister) {
      registerToolInIndex({
        fileBasename: basename(normalizedName),
        exportName: resolvedExport,
        toolKey: resolvedToolKey,
      });

      // Try runtime hot-reload so newly created tools can be used in the same session.
      try {
        const generated = (await import(`./${normalizedName}.ts?ts=${Date.now()}`)) as Record<
          string,
          unknown
        >;
        const registry = (await import("./index.ts")) as {
          tools: Record<string, unknown>;
        };
        const candidate = generated[resolvedExport];
        if (candidate) {
          registry.tools[resolvedToolKey] = candidate;
          hotReloaded = true;
        }
      } catch {
        hotReloaded = false;
      }
    }

    return {
      created: true,
      path: join(getWorkspaceRoot(), relativePath),
      exportName: resolvedExport,
      toolKey: resolvedToolKey,
      registered: autoRegister,
      hotReloaded,
    };
  },
});
