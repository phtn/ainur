export type ToolApprovalCallback = (op: { tool: string; summary: string }) => Promise<boolean>;

let callback: ToolApprovalCallback | null = null;

export function setApprovalCallback(cb: ToolApprovalCallback | null): void {
  callback = cb;
}

export async function requestApproval(tool: string, summary: string): Promise<boolean> {
  if (!callback) return false;
  return callback({ tool, summary });
}
