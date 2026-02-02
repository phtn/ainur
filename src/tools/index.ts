import type { ToolSet } from "ai";
import { readFileTool, writeFileTool, listDirTool, searchFilesTool } from "./filesystem.ts";
import { runCommandTool } from "./exec.ts";
import { fetchUrlTool } from "./web.ts";

export const tools: ToolSet = {
  read_file: readFileTool,
  write_file: writeFileTool,
  list_dir: listDirTool,
  search_files: searchFilesTool,
  run_command: runCommandTool,
  fetch_url: fetchUrlTool,
};

export { readFileTool, writeFileTool, listDirTool, searchFilesTool } from "./filesystem.ts";
export { runCommandTool } from "./exec.ts";
export { setApprovalCallback, type ToolApprovalCallback } from "./approval.ts";
export { fetchUrlTool } from "./web.ts";
