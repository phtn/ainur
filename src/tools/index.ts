import type { ToolSet } from 'ai'
import { crawlCodebaseTool } from './crawler.ts'
import { runCommandTool } from './exec.ts'
import { listDirTool, readFileTool, searchFilesTool, writeFileTool } from './filesystem.ts'
import { memoryAppendTool, memoryCompactTool, memoryReadTool, memorySearchTool } from './memory.ts'
import { moltbookTool } from './moltbook.ts'
import { toolSmithTool } from './toolsmith.ts'
import { speakTool } from './tts.ts'
import { fetchUrlTool } from './web.ts'

export const tools: ToolSet = {
  read_file: readFileTool,
  write_file: writeFileTool,
  list_dir: listDirTool,
  search_files: searchFilesTool,
  crawl_codebase: crawlCodebaseTool,
  run_command: runCommandTool,
  fetch_url: fetchUrlTool,
  speak: speakTool,
  memory_read: memoryReadTool,
  memory_append: memoryAppendTool,
  memory_search: memorySearchTool,
  memory_compact: memoryCompactTool,
  moltbook: moltbookTool,
  tool_smith: toolSmithTool
}

export { setApprovalCallback, type ToolApprovalCallback } from './approval.ts'
export { crawlCodebaseTool } from './crawler.ts'
export { runCommandTool } from './exec.ts'
export { listDirTool, readFileTool, searchFilesTool, writeFileTool } from './filesystem.ts'
export { memoryAppendTool, memoryCompactTool, memoryReadTool, memorySearchTool } from './memory.ts'
export { loadMoltbookCredentials, moltbookTool } from './moltbook.ts'
export { toolSmithTool } from './toolsmith.ts'
export { speakText, speakTool } from './tts.ts'
export { fetchUrlTool } from './web.ts'
