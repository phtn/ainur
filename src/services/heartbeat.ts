import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { getConfigDir } from "../config/settings.ts";
import { getWorkspaceRoot, resolveWorkspacePath } from "../config/workspace.ts";
import {
  appendDailyMemory,
  distillRecentDailyNotes,
} from "./memory.ts";
import { fetchMoltbookHeartbeatMarkdown } from "../tools/moltbook.ts";
import { speakText } from "../tools/tts.ts";

interface HeartbeatTask {
  key: string;
  title: string;
  intervalSeconds: number;
  description?: string;
}

interface HeartbeatState {
  lastChecks: Record<string, number>;
  lastResults?: Record<string, string>;
}

interface HeartbeatRuntime {
  pid: number;
  startedAt: string;
  workspace: string;
}

interface HeartbeatTaskRun {
  key: string;
  title: string;
  ok: boolean;
  summary: string;
  urgent?: boolean;
}

function heartbeatRuntimeDir(): string {
  const dir = join(getConfigDir(), "heartbeat");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function heartbeatPidPath(): string {
  return join(heartbeatRuntimeDir(), "heartbeat.pid.json");
}

function heartbeatLogPath(): string {
  return join(heartbeatRuntimeDir(), "heartbeat.log");
}

function heartbeatStatePath(): string {
  const path = resolveWorkspacePath("memory/heartbeat-state.json");
  const dir = resolveWorkspacePath("memory");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return path;
}

function loadHeartbeatState(): HeartbeatState {
  const path = heartbeatStatePath();
  if (!existsSync(path)) return { lastChecks: {} };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as Partial<HeartbeatState>;
    return {
      lastChecks:
        parsed.lastChecks && typeof parsed.lastChecks === "object"
          ? (parsed.lastChecks as Record<string, number>)
          : {},
      lastResults:
        parsed.lastResults && typeof parsed.lastResults === "object"
          ? (parsed.lastResults as Record<string, string>)
          : {},
    };
  } catch {
    return { lastChecks: {} };
  }
}

function saveHeartbeatState(state: HeartbeatState): void {
  writeFileSync(heartbeatStatePath(), JSON.stringify(state, null, 2), "utf-8");
}

function parseIntervalSeconds(value: string): number | null {
  const match = value.match(/(\d+(?:\.\d+)?)\s*(hour|hours|hr|hrs|h|day|days|d|minute|minutes|min|mins|m)/i);
  if (!match) return null;
  const amount = Number.parseFloat(match[1] ?? "0");
  const unit = (match[2] ?? "").toLowerCase();
  if (!Number.isFinite(amount) || amount <= 0) return null;
  if (unit.startsWith("day") || unit === "d") return Math.round(amount * 24 * 60 * 60);
  if (unit.startsWith("hour") || unit.startsWith("hr") || unit === "h") {
    return Math.round(amount * 60 * 60);
  }
  return Math.round(amount * 60);
}

function toTaskKey(title: string): string {
  const lower = title.toLowerCase();
  if (lower.includes("moltbook")) return "moltbook";
  if (lower.includes("memory")) return "memory_compaction";
  if (lower.includes("weather")) return "weather";
  if (lower.includes("system")) return "system_health";
  if (lower.includes("current events") || lower.includes("current_events")) return "current_events";
  return lower.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function fallbackTasks(): HeartbeatTask[] {
  return [
    {
      key: "moltbook",
      title: "Moltbook",
      intervalSeconds: 4 * 60 * 60,
      description: "Fetch heartbeat directive and maintain antenna presence.",
    },
    {
      key: "memory_compaction",
      title: "Memory Compaction",
      intervalSeconds: 24 * 60 * 60,
      description: "Distill recent daily memory into long-term memory.",
    },
    {
      key: "weather",
      title: "Weather & Context",
      intervalSeconds: 3 * 60 * 60,
      description: "Track local weather context for Asia/Manila.",
    },
    {
      key: "current_events",
      title: "Current Events",
      intervalSeconds: 6 * 60 * 60,
      description: "Brief world-news headline summary.",
    },
  ];
}

export function parseHeartbeatPlan(markdown: string): HeartbeatTask[] {
  const lines = markdown.split(/\r?\n/);
  const tasks: HeartbeatTask[] = [];

  let currentTitle = "";
  let currentInterval: number | null = null;
  let currentTask = "";

  const flush = (): void => {
    if (!currentTitle || !currentInterval) return;
    tasks.push({
      key: toTaskKey(currentTitle),
      title: currentTitle,
      intervalSeconds: currentInterval,
      description: currentTask || undefined,
    });
  };

  for (const line of lines) {
    const section = line.match(/^##\s+\d+\.\s+(.+)$/);
    if (section) {
      flush();
      currentTitle = (section[1] ?? "").trim();
      currentInterval = null;
      currentTask = "";
      continue;
    }

    const interval = line.match(/^-+\s+\*\*Interval\*\*:\s*(.+)$/i);
    if (interval) {
      currentInterval = parseIntervalSeconds(interval[1] ?? "");
      continue;
    }

    const taskLine = line.match(/^-+\s+\*\*Task\*\*:\s*(.+)$/i);
    if (taskLine) {
      currentTask = (taskLine[1] ?? "").trim();
    }
  }
  flush();
  return tasks.length > 0 ? tasks : fallbackTasks();
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function loadRuntime(): HeartbeatRuntime | null {
  const path = heartbeatPidPath();
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as Partial<HeartbeatRuntime>;
    if (
      typeof parsed.pid !== "number" ||
      typeof parsed.startedAt !== "string" ||
      typeof parsed.workspace !== "string"
    ) {
      return null;
    }
    return parsed as HeartbeatRuntime;
  } catch {
    return null;
  }
}

function saveRuntime(runtime: HeartbeatRuntime): void {
  writeFileSync(heartbeatPidPath(), JSON.stringify(runtime, null, 2), "utf-8");
}

function clearRuntime(): void {
  const path = heartbeatPidPath();
  if (!existsSync(path)) return;
  try {
    unlinkSync(path);
  } catch {
    /* ignore */
  }
}

async function runShell(command: string, timeoutMs = 15_000): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
}> {
  return new Promise((resolve) => {
    const child = spawn("zsh", ["-lc", command], {
      cwd: getWorkspaceRoot(),
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
      if (stdout.length > 20_000) stdout = stdout.slice(stdout.length - 20_000);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
      if (stderr.length > 20_000) stderr = stderr.slice(stderr.length - 20_000);
    });

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
    }, timeoutMs);

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        exitCode: code ?? 1,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      });
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({
        exitCode: 1,
        stdout,
        stderr: `${stderr}\n${error.message}`.trim(),
      });
    });
  });
}

const WEATHER_CODE: Record<number, string> = {
  0: "clear sky",
  1: "mainly clear",
  2: "partly cloudy",
  3: "overcast",
  45: "fog",
  48: "depositing rime fog",
  51: "light drizzle",
  53: "moderate drizzle",
  55: "dense drizzle",
  61: "slight rain",
  63: "moderate rain",
  65: "heavy rain",
  71: "slight snow",
  73: "moderate snow",
  75: "heavy snow",
  80: "rain showers",
  81: "moderate showers",
  82: "violent showers",
  95: "thunderstorm",
};

async function runWeatherTask(): Promise<HeartbeatTaskRun> {
  const url =
    "https://api.open-meteo.com/v1/forecast?latitude=14.5995&longitude=120.9842&current=temperature_2m,apparent_temperature,weather_code&timezone=Asia%2FManila";
  const res = await fetch(url, { headers: { "User-Agent": "cale/0.1.0" } });
  if (!res.ok) {
    return {
      key: "weather",
      title: "Weather & Context",
      ok: false,
      summary: `Weather request failed (${res.status})`,
    };
  }
  const payload = (await res.json()) as {
    current?: {
      temperature_2m?: number;
      apparent_temperature?: number;
      weather_code?: number;
    };
  };
  const current = payload.current;
  if (!current) {
    return {
      key: "weather",
      title: "Weather & Context",
      ok: false,
      summary: "Weather payload missing current data",
    };
  }
  const weatherText = WEATHER_CODE[current.weather_code ?? -1] ?? "unknown";
  const summary = `Manila weather: ${current.temperature_2m ?? "?"}°C (feels ${
    current.apparent_temperature ?? "?"
  }°C), ${weatherText}.`;
  await appendDailyMemory(`## Heartbeat Weather\n- ${summary}`);
  return {
    key: "weather",
    title: "Weather & Context",
    ok: true,
    summary,
    urgent:
      weatherText.includes("thunderstorm") ||
      weatherText.includes("heavy rain") ||
      weatherText.includes("violent"),
  };
}

async function runMoltbookTask(): Promise<HeartbeatTaskRun> {
  const result = await fetchMoltbookHeartbeatMarkdown();
  const preview = result.body
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .slice(0, 3)
    .join(" | ")
    .replace(/[^\x20-\x7E]/g, "")
    .slice(0, 240);
  const summary = `Fetched Moltbook heartbeat (${result.status}). ${preview || "No preview."}`;
  await appendDailyMemory(`## Heartbeat Moltbook\n- ${summary}`);
  return {
    key: "moltbook",
    title: "Moltbook",
    ok: result.status >= 200 && result.status < 400,
    summary,
  };
}

async function runMemoryCompactionTask(): Promise<HeartbeatTaskRun> {
  const result = await distillRecentDailyNotes(48);
  const summary = result.appended
    ? `Compacted notes from: ${result.sourceFiles.join(", ")}`
    : result.sourceFiles.length > 0
      ? "Memory compaction already performed for today."
      : "No recent daily memory notes to compact.";
  await appendDailyMemory(`## Heartbeat Memory\n- ${summary}`);
  return {
    key: "memory_compaction",
    title: "Memory Compaction",
    ok: true,
    summary,
  };
}

async function runSystemHealthTask(): Promise<HeartbeatTaskRun> {
  const [openclaw, gateway] = await Promise.all([
    runShell("openclaw status"),
    runShell("gateway config.get"),
  ]);
  const ok = openclaw.exitCode === 0 && gateway.exitCode === 0;
  const summary = ok
    ? "System health checks are nominal."
    : `System health drift detected (openclaw=${openclaw.exitCode}, gateway=${gateway.exitCode}).`;
  await appendDailyMemory(`## Heartbeat System\n- ${summary}`);
  return {
    key: "system_health",
    title: "System Health",
    ok,
    summary,
    urgent: !ok,
  };
}

const CURRENT_EVENTS_RSS_URL = "https://www.theinformation.com/feed";
const CURRENT_EVENTS_MAX_HEADLINES = 7;
const CURRENT_EVENTS_HEADLINE_MAX_LEN = 120;

function parseFeedTitles(xml: string): string[] {
  const titles: string[] = [];
  // The Information uses Atom (<entry>), not RSS (<item>)
  const blocks = xml.split(/<\/?entry\s*>/i).filter((_, i) => i > 0 && i % 2 === 1);
  for (const block of blocks) {
    if (titles.length >= CURRENT_EVENTS_MAX_HEADLINES) break;
    if (!block) continue;
    const titleMatch = block.match(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i);
    if (!titleMatch) continue;
    let raw = (titleMatch[1] ?? "").trim();
    raw = raw
      .replace(/\s+/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
    if (raw.length > CURRENT_EVENTS_HEADLINE_MAX_LEN) {
      raw = raw.slice(0, CURRENT_EVENTS_HEADLINE_MAX_LEN - 1) + "…";
    }
    if (raw.length > 0) titles.push(raw);
  }
  return titles;
}

async function runCurrentEventsTask(): Promise<HeartbeatTaskRun> {
  try {
    const res = await fetch(CURRENT_EVENTS_RSS_URL, {
      headers: { "User-Agent": "cale/0.1.0" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      return {
        key: "current_events",
        title: "Current Events",
        ok: false,
        summary: `Current events fetch failed (${res.status})`,
      };
    }
    const xml = await res.text();
    const headlines = parseFeedTitles(xml);
    const summary =
      headlines.length > 0
        ? `Fetched ${headlines.length} world headlines.`
        : "No headlines parsed.";
    const bulletList = headlines.length > 0 ? headlines.map((h) => `- ${h}`).join("\n") : "- No items.";
    await appendDailyMemory(`## Heartbeat Current Events\n${bulletList}`);
    return {
      key: "current_events",
      title: "Current Events",
      ok: true,
      summary,
    };
  } catch (error) {
    return {
      key: "current_events",
      title: "Current Events",
      ok: false,
      summary: error instanceof Error ? error.message : String(error),
    };
  }
}

async function executeTask(task: HeartbeatTask): Promise<HeartbeatTaskRun> {
  try {
    if (task.key === "moltbook") return await runMoltbookTask();
    if (task.key === "memory_compaction") return await runMemoryCompactionTask();
    if (task.key === "weather") return await runWeatherTask();
    if (task.key === "system_health") return await runSystemHealthTask();
    if (task.key === "current_events") return await runCurrentEventsTask();
    return {
      key: task.key,
      title: task.title,
      ok: true,
      summary: "No built-in executor for this task yet.",
    };
  } catch (error) {
    return {
      key: task.key,
      title: task.title,
      ok: false,
      summary: error instanceof Error ? error.message : String(error),
    };
  }
}

function loadHeartbeatPlan(): HeartbeatTask[] {
  const path = resolveWorkspacePath("HEARTBEAT.md");
  if (!existsSync(path)) return fallbackTasks();
  const markdown = readFileSync(path, "utf-8");
  return parseHeartbeatPlan(markdown);
}

export async function runHeartbeatOnce(options?: {
  speakUrgent?: boolean;
}): Promise<{
  ok: boolean;
  dueCount: number;
  runs: HeartbeatTaskRun[];
}> {
  const plan = loadHeartbeatPlan();
  const state = loadHeartbeatState();
  const nowSeconds = Math.floor(Date.now() / 1000);

  const due = plan.filter((task) => {
    const last = state.lastChecks[task.key] ?? 0;
    return nowSeconds - last >= task.intervalSeconds;
  });
  if (due.length === 0) {
    return { ok: true, dueCount: 0, runs: [] };
  }

  const runs: HeartbeatTaskRun[] = [];
  for (const task of due) {
    const run = await executeTask(task);
    runs.push(run);
    state.lastChecks[task.key] = nowSeconds;
    if (!state.lastResults) state.lastResults = {};
    state.lastResults[task.key] = `${new Date().toISOString()} ${run.ok ? "OK" : "ERR"}: ${
      run.summary
    }`;
    if (options?.speakUrgent && run.urgent) {
      void speakText(`Urgent heartbeat event: ${run.summary}`);
    }
  }
  saveHeartbeatState(state);

  return {
    ok: runs.every((run) => run.ok),
    dueCount: due.length,
    runs,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runHeartbeatService(): Promise<void> {
  saveRuntime({
    pid: process.pid,
    startedAt: new Date().toISOString(),
    workspace: getWorkspaceRoot(),
  });

  const cleanup = (): void => {
    clearRuntime();
  };
  process.on("SIGINT", () => {
    cleanup();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    cleanup();
    process.exit(0);
  });
  process.on("exit", cleanup);

  const pollSeconds = Number.parseInt(process.env.CALE_HEARTBEAT_POLL_SECONDS ?? "60", 10);
  const pollMs = Number.isFinite(pollSeconds) && pollSeconds >= 15 ? pollSeconds * 1000 : 60_000;

  for (;;) {
    await runHeartbeatOnce({ speakUrgent: true });
    await sleep(pollMs);
  }
}

export function getHeartbeatStatus(): {
  running: boolean;
  runtime: HeartbeatRuntime | null;
  logPath: string;
  statePath: string;
} {
  const runtime = loadRuntime();
  const running = !!runtime && isAlive(runtime.pid);
  return {
    running,
    runtime: running ? runtime : null,
    logPath: heartbeatLogPath(),
    statePath: heartbeatStatePath(),
  };
}

export function startHeartbeatDaemon(): {
  started: boolean;
  pid: number | null;
  logPath: string;
  message?: string;
} {
  const existing = loadRuntime();
  if (existing && isAlive(existing.pid)) {
    return {
      started: false,
      pid: existing.pid,
      logPath: heartbeatLogPath(),
      message: "Heartbeat service is already running.",
    };
  }

  const entryScript = process.argv[1];
  if (!entryScript) {
    return {
      started: false,
      pid: null,
      logPath: heartbeatLogPath(),
      message: "Unable to resolve entry script for heartbeat daemon.",
    };
  }

  const logFd = openSync(heartbeatLogPath(), "a");
  const child = spawn(process.execPath, [entryScript, "heartbeat", "run"], {
    cwd: getWorkspaceRoot(),
    stdio: ["ignore", logFd, logFd],
    detached: true,
    env: {
      ...process.env,
      CALE_WORKSPACE: getWorkspaceRoot(),
    },
  });
  closeSync(logFd);
  child.unref();

  const pid = child.pid ?? null;
  if (pid) {
    saveRuntime({
      pid,
      startedAt: new Date().toISOString(),
      workspace: getWorkspaceRoot(),
    });
  }
  return {
    started: Boolean(pid),
    pid,
    logPath: heartbeatLogPath(),
    message: pid ? "Heartbeat daemon started." : "Failed to start heartbeat daemon.",
  };
}

export function stopHeartbeatDaemon(): {
  stopped: boolean;
  message: string;
} {
  const runtime = loadRuntime();
  if (!runtime) {
    return { stopped: false, message: "Heartbeat service is not running." };
  }
  try {
    process.kill(runtime.pid, "SIGTERM");
    clearRuntime();
    return { stopped: true, message: "Heartbeat service stopped." };
  } catch (error) {
    return {
      stopped: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
