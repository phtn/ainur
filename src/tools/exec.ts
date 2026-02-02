import { spawn } from "node:child_process";
import { tool } from "ai";
import { z } from "zod";
import { requestApproval } from "./approval.ts";

export const runCommandTool = tool({
  description:
    "Run a shell command in the workspace. Use for running scripts, tests, builds. Requires user approval before execution.",
  inputSchema: z.object({
    command: z.string().describe("The shell command to execute (e.g. 'npm test', 'ls -la')"),
    cwd: z.string().optional().describe("Working directory relative to workspace"),
  }),
  execute: async ({ command, cwd }, { abortSignal }) => {
    const approved = await requestApproval("run_command", `Run: ${command}`);
    if (!approved) {
      return { status: "denied", message: "User declined to run the command" };
    }

    return new Promise<{ stdout: string; stderr: string; exitCode: number }>((resolve, reject) => {
      const isWin = process.platform === "win32";
      const shell = isWin ? "cmd.exe" : "/bin/sh";
      const shellArg = isWin ? "/c" : "-c";
      const proc = spawn(shell, [shellArg, command], {
        cwd: cwd ?? process.cwd(),
        stdio: ["ignore", "pipe", "pipe"],
        signal: abortSignal,
      });

      let stdout = "";
      let stderr = "";

      proc.stdout?.on("data", (chunk) => {
        stdout += String(chunk);
      });
      proc.stderr?.on("data", (chunk) => {
        stderr += String(chunk);
      });

      proc.on("close", (code, signal) => {
        resolve({
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          exitCode: signal ? -1 : code ?? 0,
        });
      });

      proc.on("error", (err) => {
        reject(err);
      });
    });
  },
});
