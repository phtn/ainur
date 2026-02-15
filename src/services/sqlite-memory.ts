import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { resolveWorkspacePath } from "../config/workspace.ts";

const DEFAULT_OPENCLAW_SQLITE = join(homedir(), ".openclaw", "memory", "main.sqlite");

export interface ImportMemoryFromSqliteOptions {
  dbPath?: string;
  entryPath?: string;
  outputPath?: string;
}

export interface ImportMemoryFromSqliteResult {
  dbPath: string;
  entryPath: string;
  outputPath: string;
  chars: number;
  updatedAt: number | null;
}

function normalizeOutput(content: string): string {
  return content.endsWith("\n") ? content : `${content}\n`;
}

export function importMemoryFromSqlite(
  options: ImportMemoryFromSqliteOptions = {}
): ImportMemoryFromSqliteResult {
  const dbPath = options.dbPath?.trim() || DEFAULT_OPENCLAW_SQLITE;
  if (!existsSync(dbPath)) {
    throw new Error(`SQLite memory DB not found: ${dbPath}`);
  }
  const entryPath = options.entryPath?.trim() || "MEMORY.md";
  const outputPath = resolveWorkspacePath(options.outputPath?.trim() || "MEMORY.md");

  const db = new Database(dbPath, { readonly: true });
  try {
    const row = db
      .query(
        "SELECT text, updated_at FROM chunks WHERE path = ? ORDER BY updated_at DESC LIMIT 1"
      )
      .get(entryPath) as
      | {
          text: string;
          updated_at: number | null;
        }
      | undefined;

    if (!row || typeof row.text !== "string") {
      throw new Error(`No memory chunk found for path "${entryPath}" in ${dbPath}`);
    }

    Bun.write(outputPath, normalizeOutput(row.text));
    return {
      dbPath,
      entryPath,
      outputPath,
      chars: row.text.length,
      updatedAt: typeof row.updated_at === "number" ? row.updated_at : null,
    };
  } finally {
    db.close();
  }
}
