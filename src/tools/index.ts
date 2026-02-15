import type { ToolSet } from "ai";
import { readFileTool, writeFileTool, listDirTool, searchFilesTool } from "./filesystem.ts";
import { runCommandTool } from "./exec.ts";
import { fetchUrlTool } from "./web.ts";
import { speakTool } from "./tts.ts";
import {
  memoryReadTool,
  memoryAppendTool,
  memorySearchTool,
  memoryCompactTool,
} from "./memory.ts";
import { moltbookTool } from "./moltbook.ts";
import { toolSmithTool } from "./toolsmith.ts";

export const tools: ToolSet = {
  read_file: readFileTool,
  write_file: writeFileTool,
  list_dir: listDirTool,
  search_files: searchFilesTool,
  run_command: runCommandTool,
  fetch_url: fetchUrlTool,
  speak: speakTool,
  memory_read: memoryReadTool,
  memory_append: memoryAppendTool,
  memory_search: memorySearchTool,
  memory_compact: memoryCompactTool,
  moltbook: moltbookTool,
  tool_smith: toolSmithTool,
};

export { readFileTool, writeFileTool, listDirTool, searchFilesTool } from "./filesystem.ts";
export { runCommandTool } from "./exec.ts";
export { setApprovalCallback, type ToolApprovalCallback } from "./approval.ts";
export { fetchUrlTool } from "./web.ts";
export { speakTool, speakText } from "./tts.ts";
export {
  memoryReadTool,
  memoryAppendTool,
  memorySearchTool,
  memoryCompactTool,
} from "./memory.ts";
export { moltbookTool, loadMoltbookCredentials } from "./moltbook.ts";
export { toolSmithTool } from "./toolsmith.ts";
