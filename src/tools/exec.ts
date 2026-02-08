import { tool } from "ai";
import pc from "picocolors";
import { z } from "zod";
import { requestApproval } from "./approval.ts";

export const runCommandTool = tool({
  description:
    "Run a shell command in the workspace. Use for running scripts, tests, builds. Requires user approval before execution.",
  inputSchema: z.object({
    command: z.string().describe("The shell command to execute (e.g. 'npm test', 'ls -la')"),
    cwd: z.string().optional().describe("Working directory relative to workspace"),
  }),
  execute: async ({ command, cwd }) => {
    const approved = await requestApproval("run_command", `Run: ${command}`);
    if (!approved) {
      return { status: "denied", message: "User declined to run the command" };
    }

    process.stderr.write(pc.dim(`  ⚙ run_command ${command}\n`));
    const t0 = performance.now();
    try {
      const result = await Bun.$`${{ raw: command }}`.cwd(cwd ?? process.cwd()).quiet().nothrow();
      const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
      process.stderr.write(pc.dim(`  ✓ exit ${result.exitCode} (${elapsed}s)\n`));
      return {
        stdout: result.stdout.toString().trim(),
        stderr: result.stderr.toString().trim(),
        exitCode: result.exitCode,
      };
    } catch (err) {
      return {
        stdout: "",
        stderr: err instanceof Error ? err.message : String(err),
        exitCode: 1,
      };
    }
  },
});
