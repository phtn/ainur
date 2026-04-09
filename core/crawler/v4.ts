import { parse } from "@babel/parser";
import traverse from "@babel/traverse";
import fs from "fs";
import path from "path";
import { type TableColumn, type TableRow, formatTable } from "../../ui/table.ts";
import { text } from "../../ui/theme.ts";

// ⚙️ Config
const projectRoot = path.resolve("./src");
const targetFile: string | null = null; // e.g. "./src/components/Button.tsx" or null to scan all

// Directories to skip
const EXCLUDED_DIRS = [
  "node_modules",
  "dist",
  "build",
  ".next",
  "out",
  "coverage",
  ".git",
];

const MODULE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"] as const;

interface ImportRecord {
  imported: string;
  local: string;
  from: string;
}

interface FileAnalysis {
  file: string;
  imports: Array<ImportRecord>;
  exports: Array<string>;
  reexports: Array<string>;
}

function parseFile(filePath: string) {
  const code = fs.readFileSync(filePath, "utf8");
  return parse(code, {
    sourceType: "module",
    plugins: [
      "jsx",
      "typescript",
      "classProperties",
      "decorators-legacy",
      "dynamicImport",
      "importMeta",
      "topLevelAwait",
    ],
  });
}

function getIdentifierName(value: unknown): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  if ("name" in value && typeof value.name === "string") {
    return value.name;
  }

  if ("value" in value && typeof value.value === "string") {
    return value.value;
  }

  return undefined;
}

function analyzeFile(filePath: string): FileAnalysis {
  try {
    const ast = parseFile(filePath);
    const imports: Array<ImportRecord> = [];
    const exports: Array<string> = [];
    const reexports: Array<string> = [];

    traverse(ast, {
      ImportDeclaration(path: any) {
        const source = String(path.node.source.value);
        path.node.specifiers.forEach((spec: any) => {
          if (spec.type === "ImportSpecifier") {
            const importedName = getIdentifierName(spec.imported);
            const localName = getIdentifierName(spec.local);
            if (importedName) {
              imports.push({
                imported: importedName,
                local: localName ?? importedName,
                from: source,
              });
            }
          } else if (spec.type === "ImportDefaultSpecifier") {
            const localName = getIdentifierName(spec.local);
            if (localName) {
              imports.push({
                imported: "default",
                local: localName,
                from: source,
              });
            }
          } else if (spec.type === "ImportNamespaceSpecifier") {
            const localName = getIdentifierName(spec.local);
            if (localName) {
              imports.push({
                imported: "*",
                local: localName,
                from: source,
              });
            }
          }
        });
      },
      ExportNamedDeclaration(path: any) {
        if (path.node.source) {
          // re-export: export { foo } from "./x"
          const source = String(path.node.source.value);
          path.node.specifiers.forEach((spec: any) => {
            const exportedName = getIdentifierName(spec.exported);
            if (exportedName) {
              exports.push(exportedName);
            }
          });
          reexports.push(source);
          return;
        }

        if (path.node.declaration) {
          const declaration = path.node.declaration;
          if (Array.isArray(declaration.declarations)) {
            declaration.declarations.forEach((dec: any) => {
              const name = getIdentifierName(dec.id);
              if (name) {
                exports.push(name);
              }
            });
          } else {
            const name = getIdentifierName(declaration.id);
            if (name) {
              exports.push(name);
            }
          }
        }

        if (Array.isArray(path.node.specifiers)) {
          path.node.specifiers.forEach((spec: any) => {
            const exportedName = getIdentifierName(spec.exported);
            if (exportedName) {
              exports.push(exportedName);
            }
          });
        }
      },
      ExportDefaultDeclaration(path: any) {
        const declaration = path.node.declaration;
        const name = getIdentifierName(declaration?.id);
        exports.push(name ? `default (${name})` : "default (anonymous)");
      },
      ExportAllDeclaration(path: any) {
        reexports.push(String(path.node.source.value));
      },
    });

    return { file: filePath, imports, exports, reexports };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const reasonCode =
      typeof err === "object" &&
      err !== null &&
      "reasonCode" in err &&
      (err as { reasonCode?: unknown }).reasonCode !== undefined
        ? String((err as { reasonCode?: unknown }).reasonCode)
        : message;

    console.warn(`⚠️ Skipping ${filePath} (parse error: ${reasonCode})`);
    return { file: filePath, imports: [], exports: [], reexports: [] };
  }
}

function getAllFiles(dir: string, files: Array<string> = []): Array<string> {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (EXCLUDED_DIRS.includes(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      getAllFiles(fullPath, files);
    } else if (/\.(js|jsx|ts|tsx)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

function resolvePath(from: string, rel: string): string {
  if (!rel.startsWith(".")) return rel; // package import

  const base = path.resolve(path.dirname(from), rel);
  const candidates = [
    base,
    ...MODULE_EXTENSIONS.map((ext) => `${base}${ext}`),
    ...MODULE_EXTENSIONS.map((ext) => path.join(base, `index${ext}`)),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return base;
}

function resolveExports(
  file: string,
  fileMap: Map<string, FileAnalysis>,
  seen: Set<string> = new Set(),
): Array<string> {
  if (seen.has(file)) return [];
  seen.add(file);

  const data = fileMap.get(file);
  if (!data) return [];

  const all = new Set<string>(data.exports);
  data.reexports.forEach((rel) => {
    const target = resolvePath(file, rel);
    const subExports = resolveExports(target, fileMap, seen);
    subExports.forEach((name) => all.add(name));
  });

  return [...all];
}

function formatCount(value: number, style: (input: string) => string): string {
  return value === 0 ? text.dim("0") : style(String(value).padStart(2, " "));
}

function crawl(): void {
  const results: Array<FileAnalysis> = targetFile
    ? [analyzeFile(path.resolve(targetFile))]
    : getAllFiles(projectRoot).map((file) => analyzeFile(file));

  const fileMap = new Map<string, FileAnalysis>(
    results.map((result) => [result.file, result] as const),
  );

  const allImports = new Map<string, Array<string>>();
  const allExports = new Map<string, string>();

  results.forEach((result) => {
    result.imports.forEach((record) => {
      const existing = allImports.get(record.imported) ?? [];
      existing.push(result.file);
      allImports.set(record.imported, existing);
    });

    const resolved = resolveExports(result.file, fileMap);
    resolved.forEach((name) => {
      allExports.set(name, result.file);
    });
  });

  const columns: Array<TableColumn> = [
    { header: "File", width: 35 },
    { header: "Imports", width: 9, align: "center" },
    { header: "Exports", width: 9, align: "center" },
  ];

  const rows: Array<TableRow> = [];
  const appendRow = (file: string, imports: number, exports: number): void => {
    rows.push({
      File: file,
      Imports: formatCount(imports, text.warning),
      Exports: formatCount(exports, text.normal),
    });
  };

  results.forEach((result) => {
    appendRow(result.file, result.imports.length, result.exports.length);
    console.log(`\n${text.dim("⬒")} File: ${result.file}`);
    console.log(
      `  ${text.warning("ꜜ")} ${text.warning(String(result.imports.length))} Imports:`,
    );
    result.imports.forEach((record) =>
      console.log(`     - ${record.imported} as ${record.local} from "${record.from}"`),
    );
    console.log(`  ${text.normal("ꜛ")} ${text.normal(String(result.exports.length))} Exports:`);

    const resolved = resolveExports(result.file, fileMap);
    resolved.forEach((name) => console.log(`     - ${name}`));
  });

  const orphans: Array<{ name: string; file: string }> = [];
  for (const [exportName, file] of allExports.entries()) {
    if (!allImports.has(exportName)) {
      orphans.push({ name: exportName, file });
    }
  }

  console.log(
    `\n${text.error("⏶")} ${text.error(String(orphans.length))} Unused Exports (never imported anywhere):`,
  );
  if (orphans.length === 0) {
    console.log(`   ${text.success("⊿")} None found!`);
  } else {
    orphans.forEach((orphan) => console.log(`   - ${orphan.name} (from ${orphan.file})`));
    appendRow("Unused exports", 0, orphans.length);
  }

  console.log(text.header("\nSUMMARY\n"));
  const summary = formatTable(columns, rows);
  console.log(summary);
}

crawl();
