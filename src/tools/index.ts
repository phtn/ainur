import type { ToolSet } from 'ai'
import { crawlCodebaseTool } from './crawler.ts'
import { runCommandTool } from './exec.ts'
import { listDirTool, readFileTool, searchFilesTool, writeFileTool } from './filesystem.ts'
import { memoryAppendTool, memoryCompactTool, memoryReadTool, memorySearchTool } from './memory.ts'
import { cryptoTool } from './crypto.ts'
import { qrCodeTool } from './qrcode.ts'
import { moltbookTool } from './moltbook.ts'
import { uuidV7Tool } from './uuid.ts'
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
  crypto: cryptoTool,
  qr_code: qrCodeTool,
  uuid_v7: uuidV7Tool,
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
export { cryptoTool } from './crypto.ts'
export { qrCodeTool } from './qrcode.ts'
export { loadMoltbookCredentials, moltbookTool } from './moltbook.ts'
export { uuidV7Tool } from './uuid.ts'
export { toolSmithTool } from './toolsmith.ts'
export { speakText, speakTool } from './tts.ts'
export { fetchUrlTool } from './web.ts'
