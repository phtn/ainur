import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { platform } from "node:os";
import { join } from "node:path";
import { getConfigDir } from "../config/settings.ts";

const DEFAULT_STT_BASENAME = "stt-input";
const DEFAULT_STT_EXTENSIONS = [".wav", ".webm", ".m4a", ".mp3", ".ogg", ".mp4"];

export interface VoiceRecordingSession {
  filePath: string;
  recorder: string;
  stop: () => Promise<void>;
  cleanup: () => void;
}

export interface StartVoiceRecordingOptions {
  onReady?: () => void;
}

interface RecorderSpec {
  cmd: string;
  args: string[];
  label: string;
}

function sttRuntimeDir(): string {
  const dir = join(getConfigDir(), "runtime");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function getDefaultOutputPath(): string {
  return join(sttRuntimeDir(), `${DEFAULT_STT_BASENAME}.wav`);
}

function removeOldDefaultAudioFiles(): void {
  const dir = sttRuntimeDir();
  for (const ext of DEFAULT_STT_EXTENSIONS) {
    try {
      rmSync(join(dir, `${DEFAULT_STT_BASENAME}${ext}`), { force: true });
    } catch {
      /* ignore */
    }
  }
}

function isCommandAvailable(cmd: string): boolean {
  try {
    return typeof Bun !== "undefined" ? Boolean(Bun.which(cmd)) : true;
  } catch {
    return true;
  }
}

function recorderSpecs(filePath: string): RecorderSpec[] {
  const os = platform();

  if (os === "darwin") {
    return [
      {
        cmd: "ffmpeg",
        label: "ffmpeg(avfoundation)",
        args: [
          "-hide_banner",
          "-loglevel",
          "error",
          "-f",
          "avfoundation",
          "-i",
          ":0",
          "-ac",
          "1",
          "-ar",
          "16000",
          "-y",
          filePath,
        ],
      },
      {
        cmd: "rec",
        label: "sox(rec)",
        args: ["-q", "-c", "1", "-r", "16000", filePath],
      },
      {
        cmd: "sox",
        label: "sox",
        args: ["-q", "-d", "-c", "1", "-r", "16000", filePath],
      },
    ];
  }

  if (os === "linux") {
    return [
      {
        cmd: "ffmpeg",
        label: "ffmpeg(alsa)",
        args: [
          "-hide_banner",
          "-loglevel",
          "error",
          "-f",
          "alsa",
          "-i",
          "default",
          "-ac",
          "1",
          "-ar",
          "16000",
          "-y",
          filePath,
        ],
      },
      {
        cmd: "arecord",
        label: "arecord",
        args: ["-q", "-f", "S16_LE", "-c", "1", "-r", "16000", filePath],
      },
      {
        cmd: "rec",
        label: "sox(rec)",
        args: ["-q", "-c", "1", "-r", "16000", filePath],
      },
    ];
  }

  if (os === "win32") {
    return [
      {
        cmd: "ffmpeg",
        label: "ffmpeg(dshow)",
        args: [
          "-hide_banner",
          "-loglevel",
          "error",
          "-f",
          "dshow",
          "-i",
          "audio=default",
          "-ac",
          "1",
          "-ar",
          "16000",
          "-y",
          filePath,
        ],
      },
    ];
  }

  return [];
}

function spawnRecorder(spec: RecorderSpec): ChildProcess {
  return spawn(spec.cmd, spec.args, {
    stdio: ["ignore", "ignore", "pipe"],
  });
}

async function waitForSpawnOrError(proc: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    let done = false;
    const onSpawn = (): void => {
      if (done) return;
      done = true;
      cleanup();
      resolve();
    };
    const onError = (error: Error): void => {
      if (done) return;
      done = true;
      cleanup();
      reject(error);
    };
    const cleanup = (): void => {
      proc.off("spawn", onSpawn);
      proc.off("error", onError);
    };

    proc.once("spawn", onSpawn);
    proc.once("error", onError);
  });
}

async function stopRecorderProcess(proc: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;

    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(sigtermTimer);
      clearTimeout(sigkillTimer);
      cleanup();
      if (error) reject(error);
      else resolve();
    };

    const onClose = (code: number | null): void => {
      // ffmpeg can return 255 when interrupted intentionally.
      if (code === 0 || code === 255 || code === null) {
        finish();
        return;
      }
      finish(new Error(`Recorder exited with code ${code}`));
    };

    const onError = (error: Error): void => {
      finish(error);
    };

    const cleanup = (): void => {
      proc.off("close", onClose);
      proc.off("error", onError);
    };

    proc.once("close", onClose);
    proc.once("error", onError);

    try {
      proc.kill("SIGINT");
    } catch {
      // ignore initial signal failures
    }

    const sigtermTimer = setTimeout(() => {
      if (settled || proc.killed) return;
      try {
        proc.kill("SIGTERM");
      } catch {
        // ignore
      }
    }, 700);

    const sigkillTimer = setTimeout(() => {
      if (settled || proc.killed) return;
      try {
        proc.kill("SIGKILL");
      } catch {
        // ignore
      }
    }, 2200);
  });
}

export async function startVoiceRecording(
  options?: StartVoiceRecordingOptions
): Promise<VoiceRecordingSession> {
  const filePath = getDefaultOutputPath();
  removeOldDefaultAudioFiles();

  const candidates = recorderSpecs(filePath).filter((spec) =>
    isCommandAvailable(spec.cmd)
  );

  if (candidates.length === 0) {
    throw new Error(
      "No recorder found. Install ffmpeg or sox (or arecord on Linux)."
    );
  }

  let lastError = "";

  for (const spec of candidates) {
    const proc = spawnRecorder(spec);
    let stderr = "";
    proc.stderr?.on("data", (chunk) => {
      if (stderr.length < 900) stderr += String(chunk);
    });

    try {
      await waitForSpawnOrError(proc);

      options?.onReady?.();

      return {
        filePath,
        recorder: spec.label,
        stop: async (): Promise<void> => {
          await stopRecorderProcess(proc);
          if (!existsSync(filePath)) {
            const detail = stderr.trim();
            throw new Error(
              detail
                ? `Recording did not produce audio. ${detail}`
                : "Recording did not produce audio."
            );
          }
        },
        cleanup: (): void => {
          // Keep file for default `cale stt` usage.
        },
      };
    } catch (error) {
      try {
        if (proc.exitCode === null) proc.kill("SIGKILL");
      } catch {
        /* ignore */
      }

      const reason = error instanceof Error ? error.message : String(error);
      const extra = stderr.trim();
      lastError = `${spec.label}: ${reason}${extra ? ` (${extra})` : ""}`;
    }
  }

  throw new Error(
    lastError || "Failed to start voice recorder."
  );
}
