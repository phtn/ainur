import { tool } from 'ai'
import pc from 'picocolors'
import { z } from 'zod'
import { crawlCodebase } from '../../core/crawler/index.ts'
import { resolveWorkspacePath } from '../config/workspace.ts'
import { requestApproval } from './approval.ts'

const MAX_MATCHES = 200
const MAX_SKIPPED = 20

function trimSourceUrl(gitUrl: string, gitRef?: string): string {
  return gitRef?.trim() ? `${gitUrl}#${gitRef.trim()}` : gitUrl
}

function summarizeMatches(matches: Array<{ file: string }>): string[] {
  return matches.slice(0, MAX_MATCHES).map((match) => match.file)
}

function summarizeSkips(skippedFiles: Array<{ file: string; reason: string }>): Array<{
  file: string
  reason: string
}> {
  return skippedFiles.slice(0, MAX_SKIPPED)
}

export const crawlCodebaseTool = tool({
  description:
    'Scan the current workspace or a git repository for a component/function identifier using an AST-aware crawler. Matches imports, referenced identifiers, and JSX usages.',
  inputSchema: z.object({
    target: z.string().min(1).describe('Identifier to search for, e.g. Button or runCommand'),
    root: z.string().optional().describe('Workspace-relative or absolute path to scan locally'),
    gitUrl: z.string().optional().describe('Git URL to clone and scan instead of the local workspace'),
    gitRef: z.string().optional().describe('Optional branch, tag, or commit to checkout after cloning')
  }),
  execute: async ({ target, root, gitUrl, gitRef }) => {
    const normalizedTarget = target.trim()
    const normalizedGitUrl = gitUrl?.trim() || undefined
    const normalizedRoot = root?.trim() || '.'
    const mode = normalizedGitUrl ? 'git' : 'local'
    const source = normalizedGitUrl ? trimSourceUrl(normalizedGitUrl, gitRef) : normalizedRoot
    let approved = mode === 'local'

    if (mode === 'git') {
      approved = await requestApproval('crawl_codebase', `Clone ${source} and scan for "${normalizedTarget}"`)
      if (!approved) {
        return {
          ok: false,
          approved: false,
          mode,
          source,
          target: normalizedTarget,
          message: 'User declined'
        }
      }
    }

    process.stderr.write(pc.dim(`  ⚙ crawl_codebase ${normalizedTarget}\n`))

    try {
      const result = normalizedGitUrl
        ? crawlCodebase({
            target: normalizedTarget,
            gitUrl: normalizedGitUrl,
            gitRef: gitRef?.trim() || undefined
          })
        : crawlCodebase({
            target: normalizedTarget,
            root: resolveWorkspacePath(normalizedRoot)
          })

      return {
        ok: true,
        approved,
        mode,
        source: normalizedGitUrl ? source : result.root,
        target: result.target,
        scannedFiles: result.scannedFiles,
        matchesCount: result.matches.length,
        matches: summarizeMatches(result.matches),
        skippedCount: result.skippedFiles.length,
        skippedFiles: summarizeSkips(result.skippedFiles),
        truncated: result.matches.length > MAX_MATCHES || result.skippedFiles.length > MAX_SKIPPED
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        ok: false,
        approved,
        mode,
        source,
        target: normalizedTarget,
        error: message
      }
    }
  }
})
