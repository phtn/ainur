import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { getWorkspaceRoot, resolveWorkspacePath } from "../config/workspace.ts";

const HEARTBEAT_LABEL = "com.cale.heartbeat";

export interface LaunchdCommandResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  code: number;
}

export interface LaunchdStatus {
  supported: boolean;
  installed: boolean;
  loaded: boolean;
  plistPath: string;
  label: string;
  details?: string;
}

function launchAgentsDir(): string {
  return join(homedir(), "Library", "LaunchAgents");
}

export function heartbeatLaunchdPlistPath(): string {
  return join(launchAgentsDir(), `${HEARTBEAT_LABEL}.plist`);
}

function userDomain(): string | null {
  if (typeof process.getuid !== "function") return null;
  return `gui/${process.getuid()}`;
}

function runLaunchctl(args: string[]): LaunchdCommandResult {
  const result = spawnSync("launchctl", args, {
    encoding: "utf-8",
    env: process.env,
  });
  return {
    ok: (result.status ?? 1) === 0,
    stdout: result.stdout?.trim() ?? "",
    stderr: result.stderr?.trim() ?? "",
    code: result.status ?? 1,
  };
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function buildHeartbeatPlist(input: {
  bunPath: string;
  scriptPath: string;
  workspace: string;
  heartbeatPollSeconds: number;
}): string {
  const args = [
    input.bunPath,
    input.scriptPath,
    "heartbeat",
    "run",
  ].map((arg) => `    <string>${escapeXml(arg)}</string>`);

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${HEARTBEAT_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${args.join("\n")}
  </array>
  <key>WorkingDirectory</key>
  <string>${escapeXml(input.workspace)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>CALE_WORKSPACE</key>
    <string>${escapeXml(input.workspace)}</string>
    <key>CALE_HEARTBEAT_POLL_SECONDS</key>
    <string>${Math.max(15, input.heartbeatPollSeconds)}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${escapeXml(join(homedir(), ".cale", "heartbeat", "launchd.log"))}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(join(homedir(), ".cale", "heartbeat", "launchd.log"))}</string>
</dict>
</plist>
`;
}

function ensureSupported(): { supported: boolean; reason?: string } {
  if (platform() !== "darwin") {
    return { supported: false, reason: "launchd integration is only available on macOS." };
  }
  const domain = userDomain();
  if (!domain) {
    return { supported: false, reason: "Unable to resolve current user domain." };
  }
  return { supported: true };
}

export function getLaunchdStatus(): LaunchdStatus {
  const support = ensureSupported();
  const plistPath = heartbeatLaunchdPlistPath();
  if (!support.supported) {
    return {
      supported: false,
      installed: false,
      loaded: false,
      plistPath,
      label: HEARTBEAT_LABEL,
      details: support.reason,
    };
  }
  const domain = userDomain()!;
  const installed = existsSync(plistPath);
  const printResult = runLaunchctl(["print", `${domain}/${HEARTBEAT_LABEL}`]);
  return {
    supported: true,
    installed,
    loaded: printResult.ok,
    plistPath,
    label: HEARTBEAT_LABEL,
    details: printResult.ok ? printResult.stdout : printResult.stderr,
  };
}

export function installHeartbeatLaunchd(options?: {
  heartbeatPollSeconds?: number;
  scriptPath?: string;
}): {
  ok: boolean;
  message: string;
  plistPath: string;
} {
  const support = ensureSupported();
  const plistPath = heartbeatLaunchdPlistPath();
  if (!support.supported) {
    return { ok: false, message: support.reason ?? "Unsupported platform.", plistPath };
  }
  const domain = userDomain()!;
  const dir = launchAgentsDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const workspace = getWorkspaceRoot();
  const scriptPath = options?.scriptPath ?? resolveWorkspacePath("src/index.ts");
  const heartbeatPollSeconds = options?.heartbeatPollSeconds ?? 60;
  const content = buildHeartbeatPlist({
    bunPath: process.execPath,
    scriptPath,
    workspace,
    heartbeatPollSeconds,
  });
  writeFileSync(plistPath, content, "utf-8");

  // Attempt clean reload sequence. Non-zero bootout is tolerated if not loaded yet.
  void runLaunchctl(["bootout", `${domain}/${HEARTBEAT_LABEL}`]);
  void runLaunchctl(["bootout", domain, plistPath]);

  const bootstrap = runLaunchctl(["bootstrap", domain, plistPath]);
  if (!bootstrap.ok) {
    return {
      ok: false,
      message: bootstrap.stderr || "launchctl bootstrap failed.",
      plistPath,
    };
  }
  const enable = runLaunchctl(["enable", `${domain}/${HEARTBEAT_LABEL}`]);
  const kickstart = runLaunchctl(["kickstart", "-k", `${domain}/${HEARTBEAT_LABEL}`]);
  if (!enable.ok || !kickstart.ok) {
    return {
      ok: false,
      message: enable.stderr || kickstart.stderr || "Failed to enable/kickstart launch agent.",
      plistPath,
    };
  }
  return {
    ok: true,
    message: "Heartbeat launch agent installed and started.",
    plistPath,
  };
}

export function uninstallHeartbeatLaunchd(): {
  ok: boolean;
  message: string;
  plistPath: string;
} {
  const support = ensureSupported();
  const plistPath = heartbeatLaunchdPlistPath();
  if (!support.supported) {
    return { ok: false, message: support.reason ?? "Unsupported platform.", plistPath };
  }
  const domain = userDomain()!;

  // Best-effort unload
  void runLaunchctl(["bootout", `${domain}/${HEARTBEAT_LABEL}`]);
  void runLaunchctl(["bootout", domain, plistPath]);
  void runLaunchctl(["disable", `${domain}/${HEARTBEAT_LABEL}`]);

  if (existsSync(plistPath)) {
    try {
      unlinkSync(plistPath);
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
        plistPath,
      };
    }
  }
  return {
    ok: true,
    message: "Heartbeat launch agent removed.",
    plistPath,
  };
}

export function readHeartbeatLaunchdPlist(): string | null {
  const plistPath = heartbeatLaunchdPlistPath();
  if (!existsSync(plistPath)) return null;
  return readFileSync(plistPath, "utf-8");
}
