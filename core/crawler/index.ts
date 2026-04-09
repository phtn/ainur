import { parse } from '@babel/parser'
import traverse from '@babel/traverse'
import fs from 'fs'
import { execFileSync } from 'node:child_process'
import os from 'os'
import path from 'path'

export interface CrawlInput {
  target: string
  root?: string
  gitUrl?: string
  gitRef?: string
}

export interface CrawlMatch {
  file: string
  absolutePath: string
}

export interface CrawlSkip {
  file: string
  reason: string
}

export interface CrawlResult {
  root: string
  target: string
  matches: Array<CrawlMatch>
  scannedFiles: number
  skippedFiles: Array<CrawlSkip>
  gitUrl?: string
  gitRef?: string
}

const DEFAULT_TARGET = 'Button'
const EXCLUDED_DIRS = ['node_modules', 'dist', 'build', '.next', 'out', 'coverage', '.git']

function normalizeTarget(targetName: string): string {
  const trimmed = targetName.trim()
  if (!trimmed) {
    throw new Error('Crawler target cannot be empty.')
  }
  return trimmed
}

function getAllFiles(dir: string, files: Array<string> = []): Array<string> {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (EXCLUDED_DIRS.includes(entry.name)) {
      continue
    }
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      getAllFiles(fullPath, files)
    } else if (/\.(js|jsx|ts|tsx)$/.test(entry.name)) {
      files.push(fullPath)
    }
  }
  return files
}

function isMatchingIdentifier(name: string | undefined, targetName: string): boolean {
  return typeof name === 'string' && name === targetName
}

function checkFile(filePath: string, targetName: string): { found: boolean; reason?: string } {
  try {
    const code = fs.readFileSync(filePath, 'utf8')
    const ast = parse(code, {
      sourceType: 'module',
      plugins: ['jsx', 'typescript']
    })

    let found = false

    traverse(ast, {
      ImportDeclaration(path: any) {
        const { specifiers } = path.node
        for (const specifier of specifiers) {
          if (specifier.type === 'ImportDefaultSpecifier' && isMatchingIdentifier(specifier.local?.name, targetName)) {
            found = true
          }

          if (specifier.type === 'ImportSpecifier') {
            const importedName =
              specifier.imported.type === 'Identifier' ? specifier.imported.name : specifier.imported.value
            if (
              isMatchingIdentifier(importedName, targetName) ||
              isMatchingIdentifier(specifier.local?.name, targetName)
            ) {
              found = true
            }
          }

          if (
            specifier.type === 'ImportNamespaceSpecifier' &&
            isMatchingIdentifier(specifier.local?.name, targetName)
          ) {
            found = true
          }
        }
      },
      Identifier(path: any) {
        if (
          path.node.name === targetName &&
          (typeof path.isReferencedIdentifier !== 'function' || path.isReferencedIdentifier())
        ) {
          found = true
        }
      },
      JSXIdentifier(path: any) {
        if (path.node.name === targetName && path.parent?.type === 'JSXOpeningElement') {
          found = true
        }
      }
    })

    return { found }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return { found: false, reason }
  }
}

function cloneRepository(gitUrl: string, gitRef?: string): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cale-crawler-'))

  try {
    execFileSync('git', ['clone', gitUrl, tempDir], { stdio: 'pipe' })
    if (gitRef) {
      execFileSync('git', ['-C', tempDir, 'checkout', gitRef], { stdio: 'pipe' })
    }
    return tempDir
  } catch (error) {
    fs.rmSync(tempDir, { recursive: true, force: true })
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(`Failed to clone repository ${gitUrl}: ${reason}`)
  }
}

export function crawlProject(root: string, targetName: string): CrawlResult {
  const resolvedRoot = path.resolve(root)
  const normalizedTarget = normalizeTarget(targetName)
  const files = getAllFiles(resolvedRoot)
  const matches: Array<CrawlMatch> = []
  const skippedFiles: Array<CrawlSkip> = []

  for (const file of files) {
    const result = checkFile(file, normalizedTarget)
    const relativePath = path.relative(resolvedRoot, file) || path.basename(file)

    if (result.reason) {
      skippedFiles.push({
        file: relativePath,
        reason: result.reason
      })
    }

    if (result.found) {
      matches.push({
        file: relativePath,
        absolutePath: file
      })
    }
  }

  return {
    root: resolvedRoot,
    target: normalizedTarget,
    matches,
    scannedFiles: files.length,
    skippedFiles
  }
}

export function crawlCodebase(input: CrawlInput): CrawlResult {
  const normalizedTarget = normalizeTarget(input.target || DEFAULT_TARGET)

  if (input.gitUrl) {
    const clonedRoot = cloneRepository(input.gitUrl, input.gitRef)
    try {
      const result = crawlProject(clonedRoot, normalizedTarget)
      return {
        ...result,
        gitUrl: input.gitUrl,
        gitRef: input.gitRef
      }
    } finally {
      fs.rmSync(clonedRoot, { recursive: true, force: true })
    }
  }

  return crawlProject(input.root ?? process.cwd(), normalizedTarget)
}

function formatReport(result: CrawlResult): string {
  const lines: Array<string> = []
  const sourceLabel = result.gitUrl ? `${result.gitUrl}${result.gitRef ? `#${result.gitRef}` : ''}` : result.root

  lines.push(`📌 "${result.target}" scanned in ${result.scannedFiles} files`)
  lines.push(`Source: ${sourceLabel}`)
  lines.push(`Matches: ${result.matches.length}`)

  if (result.matches.length === 0) {
    lines.push('')
    lines.push('No matches found.')
  } else {
    lines.push('')
    for (const match of result.matches) {
      lines.push(`- ${match.file}`)
    }
  }

  if (result.skippedFiles.length > 0) {
    lines.push('')
    lines.push(`Skipped ${result.skippedFiles.length} file(s) with parse errors`)
    for (const skipped of result.skippedFiles.slice(0, 5)) {
      lines.push(`- ${skipped.file}: ${skipped.reason}`)
    }
    if (result.skippedFiles.length > 5) {
      lines.push(`- ...and ${result.skippedFiles.length - 5} more`)
    }
  }

  return lines.join('\n')
}

export function formatCrawlReport(result: CrawlResult): string {
  return formatReport(result)
}

export function parseCrawlArgs(argv: Array<string>): CrawlInput & { json: boolean } {
  let target = DEFAULT_TARGET
  let root: string | undefined
  let gitUrl: string | undefined
  let gitRef: string | undefined
  let json = false
  const positional: Array<string> = []

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!
    if (arg === '--json') {
      json = true
      continue
    }

    if (arg === '--target' || arg.startsWith('--target=')) {
      target = arg.includes('=') ? arg.slice('--target='.length) : (argv[++i] ?? target)
      continue
    }

    if (arg === '--root' || arg.startsWith('--root=')) {
      root = arg.includes('=') ? arg.slice('--root='.length) : argv[++i]
      continue
    }

    if (arg === '--git-url' || arg.startsWith('--git-url=')) {
      gitUrl = arg.includes('=') ? arg.slice('--git-url='.length) : argv[++i]
      continue
    }

    if (arg === '--git-ref' || arg.startsWith('--git-ref=')) {
      gitRef = arg.includes('=') ? arg.slice('--git-ref='.length) : argv[++i]
      continue
    }

    if (arg === '--ref' || arg.startsWith('--ref=')) {
      gitRef = arg.includes('=') ? arg.slice('--ref='.length) : argv[++i]
      continue
    }

    if (!arg.startsWith('-')) {
      positional.push(arg)
    }
  }

  if (positional.length > 0 && target === DEFAULT_TARGET) {
    target = positional[0]!
  }

  return {
    target,
    root,
    gitUrl,
    gitRef,
    json
  }
}

function isMain(): boolean {
  return Boolean((import.meta as ImportMeta & { main?: boolean }).main)
}

if (isMain()) {
  const args = parseCrawlArgs(process.argv.slice(2))
  const result = crawlCodebase(args)

  if (args.json) {
    console.log(JSON.stringify(result, null, 2))
  } else {
    console.log(`\n${formatCrawlReport(result)}\n`)
  }
}
