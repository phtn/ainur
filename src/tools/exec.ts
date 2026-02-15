import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { tool } from "ai";
import pc from "picocolors";
import { z } from "zod";
import { requestApproval } from "./approval.ts";
import { getConfigDir } from "../config/settings.ts";
import {
  getWorkspaceRoot,
  resolveWorkspacePath,
} from "../config/workspace.ts";

type JobStatus = "running" | "completed" | "failed" | "stopped" | "unknown";

interface BackgroundJob {
  id: string;
  command: string;
  cwd: string;
  pid: number;
  startedAt: string;
  endedAt?: string;
  exitCode?: number;
  status: JobStatus;
  logPath: string;
  statusPath: string;
}

interface JobsState {
  jobs: Record<string, BackgroundJob>;
}

const ACTIONS = [
  "run",
  "start_background",
  "list_background",
  "status_background",
  "stop_background",
] as const;
type RunCommandAction = (typeof ACTIONS)[number];

function runtimeDir(): string {
  const dir = join(getConfigDir(), "runtime");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function jobsDir(): string {
  const dir = join(runtimeDir(), "jobs");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function jobsStatePath(): string {
  return join(runtimeDir(), "jobs.json");
}

function loadJobsState(): JobsState {
  const path = jobsStatePath();
  if (!existsSync(path)) return { jobs: {} };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as Partial<JobsState>;
    if (!parsed.jobs || typeof parsed.jobs !== "object") return { jobs: {} };
    return { jobs: parsed.jobs as Record<string, BackgroundJob> };
  } catch {
    return { jobs: {} };
  }
}

function saveJobsState(state: JobsState): void {
  writeFileSync(jobsStatePath(), JSON.stringify(state, null, 2), "utf-8");
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function appendLimited(
  current: string,
  chunk: string,
  maxChars: number
): { value: string; truncated: boolean } {
  if (current.length >= maxChars) return { value: current, truncated: true };
  const room = maxChars - current.length;
  if (chunk.length <= room) {
    return { value: current + chunk, truncated: false };
  }
  return { value: current + chunk.slice(0, room), truncated: true };
}

function parseStatusFile(path: string): { exitCode?: number; endedAt?: string } {
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as {
      exitCode?: number;
      endedAt?: string;
    };
    return {
      exitCode: typeof parsed.exitCode === "number" ? parsed.exitCode : undefined,
      endedAt: typeof parsed.endedAt === "string" ? parsed.endedAt : undefined,
    };
  } catch {
    return {};
  }
}

function reconcileJob(job: BackgroundJob): BackgroundJob {
  if (job.status !== "running") return job;
  if (isAlive(job.pid)) return job;

  const status = parseStatusFile(job.statusPath);
  if (typeof status.exitCode === "number") {
    return {
      ...job,
      exitCode: status.exitCode,
      endedAt: status.endedAt ?? new Date().toISOString(),
      status: status.exitCode === 0 ? "completed" : "failed",
    };
  }
  return {
    ...job,
    endedAt: job.endedAt ?? new Date().toISOString(),
    status: "unknown",
  };
}

function reconcileAllJobs(state: JobsState): JobsState {
  const jobs: Record<string, BackgroundJob> = {};
  for (const [id, job] of Object.entries(state.jobs)) {
    jobs[id] = reconcileJob(job);
  }
  return { jobs };
}

function newJobId(): string {
  return `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function readTail(path: string, tailChars: number): Promise<string> {
  if (!existsSync(path)) return "";
  const text = await Bun.file(path).text();
  if (text.length <= tailChars) return text;
  return text.slice(text.length - tailChars);
}

async function runForegroundCommand(input: {
  command: string;
  cwd?: string;
  timeoutMs: number;
  maxOutputChars: number;
}): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
  truncated: boolean;
  durationMs: number;
}> {
  const absCwd = input.cwd ? resolveWorkspacePath(input.cwd) : getWorkspaceRoot();

  return new Promise((resolve) => {
    const startedAt = performance.now();
    const child = spawn("zsh", ["-lc", input.command], {
      cwd: absCwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    let stdout = "";
    let stderr = "";
    let truncated = false;
    let timedOut = false;

    child.stdout?.on("data", (chunk) => {
      const next = appendLimited(stdout, String(chunk), input.maxOutputChars);
      stdout = next.value;
      truncated = truncated || next.truncated;
    });
    child.stderr?.on("data", (chunk) => {
      const next = appendLimited(stderr, String(chunk), input.maxOutputChars);
      stderr = next.value;
      truncated = truncated || next.truncated;
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!child.killed) child.kill("SIGKILL");
      }, 1500).unref();
    }, input.timeoutMs);

    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({
        stdout,
        stderr: `${stderr}\n${error.message}`.trim(),
        exitCode: 1,
        timedOut: false,
        truncated,
        durationMs: Math.round(performance.now() - startedAt),
      });
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: timedOut ? 124 : code ?? 1,
        timedOut,
        truncated,
        durationMs: Math.round(performance.now() - startedAt),
      });
    });
  });
}

function startBackgroundCommand(input: {
  command: string;
  cwd?: string;
}): BackgroundJob {
  const id = newJobId();
  const absCwd = input.cwd ? resolveWorkspacePath(input.cwd) : getWorkspaceRoot();
  const logsPath = join(jobsDir(), `${id}.log`);
  const statusPath = join(jobsDir(), `${id}.status.json`);

  const wrapped = `${input.command}; __code=$?; printf '{"exitCode":%s,"endedAt":"%s"}' "$__code" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > ${shQuote(
    statusPath
  )}; exit $__code`;

  const fd = openSync(logsPath, "a");
  const child = spawn("zsh", ["-lc", wrapped], {
    cwd: absCwd,
    stdio: ["ignore", fd, fd],
    detached: true,
    env: process.env,
  });
  closeSync(fd);
  child.unref();

  const job: BackgroundJob = {
    id,
    command: input.command,
    cwd: absCwd,
    pid: child.pid ?? -1,
    startedAt: new Date().toISOString(),
    status: "running",
    logPath: logsPath,
    statusPath,
  };
  return job;
}

function stopBackgroundJob(job: BackgroundJob): BackgroundJob {
  if (job.status !== "running") return job;
  try {
    process.kill(job.pid, "SIGTERM");
  } catch {
    return reconcileJob(job);
  }

  return {
    ...job,
    status: "stopped",
    endedAt: new Date().toISOString(),
  };
}

export const runCommandTool = tool({
  description:
    "Run shell commands in the workspace. Supports foreground commands with timeout and managed background jobs.",
  inputSchema: z.object({
    action: z.enum(ACTIONS).optional().default("run"),
    command: z
      .string()
      .optional()
      .describe("Shell command to execute for run/start_background"),
    cwd: z.string().optional().describe("Working directory relative to workspace"),
    background: z
      .boolean()
      .optional()
      .default(false)
      .describe("Backward-compatible shortcut: when true, run action behaves like start_background"),
    timeoutMs: z
      .number()
      .int()
      .min(1_000)
      .max(24 * 60 * 60 * 1000)
      .optional()
      .default(120_000),
    maxOutputChars: z
      .number()
      .int()
      .min(2_000)
      .max(1_000_000)
      .optional()
      .default(200_000),
    jobId: z.string().optional().describe("Background job id for status/stop"),
    tailChars: z
      .number()
      .int()
      .min(200)
      .max(200_000)
      .optional()
      .default(4_000),
  }),
  execute: async ({
    action,
    command,
    cwd,
    background,
    timeoutMs,
    maxOutputChars,
    jobId,
    tailChars,
  }) => {
    const resolvedAction = action ?? "run";
    const resolvedBackground = background ?? false;
    const resolvedTimeoutMs = typeof timeoutMs === "number" ? timeoutMs : 120_000;
    const resolvedMaxOutputChars =
      typeof maxOutputChars === "number" ? maxOutputChars : 200_000;
    const resolvedTailChars = typeof tailChars === "number" ? tailChars : 4_000;

    const effectiveAction: RunCommandAction =
      resolvedAction === "run" && resolvedBackground ? "start_background" : resolvedAction;

    const requiresApproval =
      effectiveAction === "run" ||
      effectiveAction === "start_background" ||
      effectiveAction === "stop_background";
    if (requiresApproval) {
      const summary =
        effectiveAction === "stop_background"
          ? `Stop background job ${jobId ?? "(missing jobId)"}`
          : `Run: ${command ?? "(missing command)"}`;
      const approved = await requestApproval("run_command", summary);
      if (!approved) {
        return { status: "denied", message: "User declined to run the command" };
      }
    }

    let state = reconcileAllJobs(loadJobsState());

    if (effectiveAction === "list_background") {
      saveJobsState(state);
      const jobs = Object.values(state.jobs).sort((a, b) =>
        a.startedAt < b.startedAt ? 1 : -1
      );
      return { jobs };
    }

    if (effectiveAction === "status_background") {
      if (!jobId) throw new Error("jobId is required for status_background");
      const job = state.jobs[jobId];
      if (!job) return { found: false, jobId };
      const updated = reconcileJob(job);
      state.jobs[jobId] = updated;
      saveJobsState(state);
      return {
        found: true,
        job: updated,
        tail: await readTail(updated.logPath, resolvedTailChars),
      };
    }

    if (effectiveAction === "stop_background") {
      if (!jobId) throw new Error("jobId is required for stop_background");
      const job = state.jobs[jobId];
      if (!job) return { stopped: false, message: `Unknown job: ${jobId}` };
      const updated = stopBackgroundJob(job);
      state.jobs[jobId] = updated;
      saveJobsState(state);
      return {
        stopped: true,
        job: updated,
      };
    }

    if (!command?.trim()) {
      throw new Error("command is required for run/start_background");
    }

    if (effectiveAction === "start_background") {
      process.stderr.write(pc.dim(`  ⚙ run_command background ${command}\n`));
      const job = startBackgroundCommand({ command, cwd });
      state.jobs[job.id] = job;
      saveJobsState(state);
      return {
        status: "started",
        job,
      };
    }

    process.stderr.write(pc.dim(`  ⚙ run_command ${command}\n`));
    const result = await runForegroundCommand({
      command,
      cwd,
      timeoutMs: resolvedTimeoutMs,
      maxOutputChars: resolvedMaxOutputChars,
    });
    process.stderr.write(
      pc.dim(`  ✓ exit ${result.exitCode} (${(result.durationMs / 1000).toFixed(1)}s)\n`)
    );
    return result;
  },
});
