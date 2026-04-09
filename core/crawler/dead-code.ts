import { parse } from '@babel/parser'
import traverse from '@babel/traverse'
import fs from 'fs'
import path from 'path'

const EXCLUDED_DIRS = ['node_modules', 'dist', 'build', '.next', 'out', 'coverage', '.git', '.turbo']
const SOURCE_EXTS = /\.(js|jsx|ts|tsx)$/

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DeadExport {
  file: string
  name: string // exported name ("default" for default exports)
}

export interface DeadImport {
  file: string
  name: string // local binding name
  from: string // source specifier
}

export interface ParseError {
  file: string
  reason: string
}

export interface DeadCodeResult {
  dir: string
  scannedFiles: number
  deadExports: DeadExport[]
  deadImports: DeadImport[]
  errors: ParseError[]
}

// ---------------------------------------------------------------------------
// File discovery
// ---------------------------------------------------------------------------

function collectFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUDED_DIRS.includes(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      collectFiles(full, out)
    } else if (SOURCE_EXTS.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Per-file analysis
// ---------------------------------------------------------------------------

interface ExportEntry {
  name: string // "default" | named identifier
  file: string
}

interface ImportEntry {
  localName: string  // local binding in this file
  imported: string   // the name from the source ("default" | named)
  source: string     // raw specifier e.g. "./utils"
  resolvedFile: string | null // absolute path if resolvable within project
}

interface FileAnalysis {
  file: string
  exports: ExportEntry[]
  imports: ImportEntry[]
  referencedNames: Set<string> // all identifiers referenced in the file body
  error?: string
}

function resolveImport(fromFile: string, source: string, projectRoot: string): string | null {
  // Only track relative/project imports, skip bare specifiers (node_modules)
  if (!source.startsWith('.') && !source.startsWith('/')) return null
  const base = path.dirname(fromFile)
  const resolved = path.resolve(base, source)
  // Try exact, then with extensions
  for (const ext of ['', '.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx', '/index.js']) {
    const candidate = resolved + ext
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate
    }
  }
  return null
}

function analyzeFile(filePath: string, projectRoot: string): FileAnalysis {
  let code: string
  try {
    code = fs.readFileSync(filePath, 'utf8')
  } catch (e) {
    return { file: filePath, exports: [], imports: [], referencedNames: new Set(), error: String(e) }
  }

  let ast: ReturnType<typeof parse>
  try {
    ast = parse(code, {
      sourceType: 'module',
      plugins: ['jsx', 'typescript', 'decorators-legacy'],
      errorRecovery: true,
    })
  } catch (e) {
    return {
      file: filePath,
      exports: [],
      imports: [],
      referencedNames: new Set(),
      error: e instanceof Error ? e.message : String(e),
    }
  }

  const exports: ExportEntry[] = []
  const imports: ImportEntry[] = []
  // unused imports discovered via scope bindings — populated in Program:exit
  const unusedImportBindings: Set<string> = new Set()

  try {
    traverse(ast, {
      // ---- Exports ----
      ExportDefaultDeclaration() {
        exports.push({ name: 'default', file: filePath })
      },

      ExportNamedDeclaration(nodePath: any) {
        const node = nodePath.node

        // export const foo = ..., export function bar() {}
        if (node.declaration) {
          const decl = node.declaration
          if (decl.type === 'VariableDeclaration') {
            for (const d of decl.declarations) {
              extractPatternNames(d.id).forEach((name) =>
                exports.push({ name, file: filePath })
              )
            }
          } else if (decl.id?.name) {
            exports.push({ name: decl.id.name, file: filePath })
          }
        }

        // export { foo, bar as baz }
        for (const spec of node.specifiers ?? []) {
          const exportedName =
            spec.exported.type === 'Identifier' ? spec.exported.name : spec.exported.value
          exports.push({ name: exportedName, file: filePath })
        }
      },

      ExportAllDeclaration() {
        // export * from './other' — skip
      },

      // ---- Imports ----
      ImportDeclaration(nodePath: any) {
        const source: string = nodePath.node.source.value
        const resolved = resolveImport(filePath, source, projectRoot)
        for (const spec of nodePath.node.specifiers) {
          let importedName: string
          if (spec.type === 'ImportDefaultSpecifier') {
            importedName = 'default'
          } else if (spec.type === 'ImportNamespaceSpecifier') {
            importedName = '*'
          } else {
            importedName =
              spec.imported.type === 'Identifier' ? spec.imported.name : spec.imported.value
          }
          const localName: string = spec.local?.name ?? importedName
          imports.push({ localName, imported: importedName, source, resolvedFile: resolved })
        }
      },

      // ---- Scope-based unused import detection ----
      // Cast to any to use the { exit } object form which @babel/traverse types don't expose
      ...({
        Program: {
          exit(nodePath: any) {
            const scope = nodePath.scope
            if (!scope?.bindings) return
            for (const [name, binding] of Object.entries(scope.bindings as Record<string, any>)) {
              if (binding.kind !== 'module') continue // only import bindings
              if (binding.referencePaths.length === 0 && !binding.referenced) {
                unusedImportBindings.add(name)
              }
            }
          },
        },
      } as any),
    })
  } catch (e) {
    return {
      file: filePath,
      exports,
      imports,
      referencedNames: unusedImportBindings,
      error: e instanceof Error ? e.message : String(e),
    }
  }

  return { file: filePath, exports, imports, referencedNames: unusedImportBindings }
}

function extractPatternNames(node: any): string[] {
  if (!node) return []
  if (node.type === 'Identifier') return [node.name]
  if (node.type === 'ObjectPattern') {
    return node.properties.flatMap((p: any) =>
      p.type === 'RestElement' ? extractPatternNames(p.argument) : extractPatternNames(p.value)
    )
  }
  if (node.type === 'ArrayPattern') {
    return node.elements.flatMap((e: any) => (e ? extractPatternNames(e) : []))
  }
  if (node.type === 'AssignmentPattern') return extractPatternNames(node.left)
  if (node.type === 'RestElement') return extractPatternNames(node.argument)
  return []
}

// ---------------------------------------------------------------------------
// Dead code analysis
// ---------------------------------------------------------------------------

export function analyzeDeadCode(dir: string): DeadCodeResult {
  const root = path.resolve(dir)
  const files = collectFiles(root)

  const analyses = new Map<string, FileAnalysis>()
  const errors: ParseError[] = []

  for (const f of files) {
    const analysis = analyzeFile(f, root)
    analyses.set(f, analysis)
    if (analysis.error) {
      errors.push({ file: path.relative(root, f), reason: analysis.error })
    }
  }

  // Build: for each file, which exports are imported by others
  // importedExports[absFile][exportName] = true if someone imports it
  const importedExports = new Map<string, Set<string>>()
  for (const [, analysis] of analyses) {
    for (const imp of analysis.imports) {
      if (!imp.resolvedFile) continue
      if (!importedExports.has(imp.resolvedFile)) {
        importedExports.set(imp.resolvedFile, new Set())
      }
      importedExports.get(imp.resolvedFile)!.add(imp.imported)
    }
  }

  // Dead exports: exported names never imported by any file in the project
  const deadExports: DeadExport[] = []
  for (const [absFile, analysis] of analyses) {
    const imported = importedExports.get(absFile) ?? new Set()
    const relFile = path.relative(root, absFile)

    // If file has a wildcard import somewhere, skip export-dead check for it
    // (we can't know which exports are consumed)
    const hasWildcardImporter = [...(importedExports.get(absFile) ?? [])].includes('*')
    if (hasWildcardImporter) continue

    for (const exp of analysis.exports) {
      if (!imported.has(exp.name)) {
        deadExports.push({ file: relFile, name: exp.name })
      }
    }
  }

  // Dead imports: scope bindings that are 'module' kind with zero references
  // referencedNames is now the set of unused local binding names (from scope analysis)
  const deadImports: DeadImport[] = []
  for (const [absFile, analysis] of analyses) {
    const unusedBindings = analysis.referencedNames // Set<localName> of unused imports
    for (const imp of analysis.imports) {
      if (imp.imported === '*') continue // namespace imports — skip, too broad
      if (unusedBindings.has(imp.localName)) {
        deadImports.push({
          file: path.relative(root, absFile),
          name: imp.localName,
          from: imp.source,
        })
      }
    }
  }

  return {
    dir: root,
    scannedFiles: files.length,
    deadExports,
    deadImports,
    errors,
  }
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export function formatDeadCodeReport(result: DeadCodeResult): string {
  const lines: string[] = []
  lines.push(`Dead Code Report — ${result.dir}`)
  lines.push(`Scanned: ${result.scannedFiles} files`)
  lines.push('')

  if (result.deadExports.length === 0 && result.deadImports.length === 0) {
    lines.push('No dead code found.')
  }

  if (result.deadExports.length > 0) {
    lines.push(`Unused Exports (${result.deadExports.length})`)
    lines.push('─'.repeat(40))
    // Group by file
    const byFile = new Map<string, string[]>()
    for (const e of result.deadExports) {
      if (!byFile.has(e.file)) byFile.set(e.file, [])
      byFile.get(e.file)!.push(e.name)
    }
    for (const [file, names] of byFile) {
      lines.push(`  ${file}`)
      for (const name of names) {
        lines.push(`    export: ${name}`)
      }
    }
    lines.push('')
  }

  if (result.deadImports.length > 0) {
    lines.push(`Unused Imports (${result.deadImports.length})`)
    lines.push('─'.repeat(40))
    const byFile = new Map<string, Array<{ name: string; from: string }>>()
    for (const i of result.deadImports) {
      if (!byFile.has(i.file)) byFile.set(i.file, [])
      byFile.get(i.file)!.push({ name: i.name, from: i.from })
    }
    for (const [file, items] of byFile) {
      lines.push(`  ${file}`)
      for (const { name, from } of items) {
        lines.push(`    import ${name} from "${from}"`)
      }
    }
    lines.push('')
  }

  if (result.errors.length > 0) {
    lines.push(`Parse Errors (${result.errors.length})`)
    lines.push('─'.repeat(40))
    for (const e of result.errors.slice(0, 10)) {
      lines.push(`  ${e.file}: ${e.reason.slice(0, 120)}`)
    }
    if (result.errors.length > 10) lines.push(`  ...and ${result.errors.length - 10} more`)
  }

  return lines.join('\n')
}
