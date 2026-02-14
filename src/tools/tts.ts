import { spawn } from "node:child_process";
import { platform } from "node:os";
import { join } from "node:path";
import { mkdtempSync, unlinkSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { tool } from "ai";
import { z } from "zod";
import { requestApproval } from "./approval.ts";
import { getConfigDir, loadSettings } from "../config/settings.ts";

const DEFAULT_TTS_MODEL_FILENAME = "en_US-libritts_r-medium.onnx";

function getPiperModel(): string | undefined {
  const configured =
    process.env.CALE_TTS_MODEL ??
    process.env.CALE_PIPER_MODEL ??
    process.env.PIPER_MODEL ??
    loadSettings().ttsModel;
  if (configured) return configured;
  const defaultPath = join(getConfigDir(), "piper", DEFAULT_TTS_MODEL_FILENAME);
  return existsSync(defaultPath) ? defaultPath : undefined;
}

/** Remove actions/reactions like *giggles* or *laughs* from text */
function stripReactions(text: string): string {
  return text.replace(/\*[^*]+\*/g, "").replace(/\s{2,}/g, " ").trim();
}

function getPlayCommand(): { cmd: string; args: string[] } | null {
  const plat = platform();
  if (plat === "darwin") return { cmd: "afplay", args: [] };
  if (plat === "linux") return { cmd: "aplay", args: ["-q"] };
  if (plat === "win32") return { cmd: "powershell", args: ["-NoProfile", "-Command", ""] };
  return null;
}

async function runPiper(text: string, wavPath: string, modelPath: string): Promise<{ ok: boolean; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn("piper", ["--model", modelPath, "--output_file", wavPath], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    proc.stdin?.write(text, "utf-8", () => proc.stdin?.end());

    let stderr = "";
    proc.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });

    proc.on("close", (code) => {
      resolve({ ok: code === 0, stderr });
    });
    proc.on("error", (err) => {
      resolve({ ok: false, stderr: err.message });
    });
  });
}

export const speakTool = tool({
  description:
    "Convert text to speech and play it using local Piper TTS. Use when the user asks to speak, read aloud, or use text-to-speech. Requires Piper (piper-tts) and a voice model. Set CALE_TTS_MODEL to the path of your .onnx model. Requires user approval before playing.",
  inputSchema: z.object({
    text: z.string().describe("The text to speak aloud"),
  }),
  execute: async ({ text }) => {
    const approved = await requestApproval("speak", `Speak: "${text.slice(0, 60)}${text.length > 60 ? "..." : ""}"`);
    if (!approved) {
      return { played: false, message: "User declined" };
    }

    const modelPath = getPiperModel();
    if (!modelPath || !existsSync(modelPath)) {
      const hint =
        process.env.CALE_TTS_MODEL ?? process.env.CALE_PIPER_MODEL
          ? "CALE_TTS_MODEL path does not exist"
          : "Set CALE_TTS_MODEL to your Piper .onnx model path (e.g. ~/.local/share/piper/en_US-libritts_r-medium.onnx). Install: pip install piper-tts, then download a model from https://huggingface.co/rhasspy/piper-voices";
      return {
        played: false,
        message: `Piper TTS not configured. ${hint}`,
      };
    }

    const tmpDir = mkdtempSync(join(tmpdir(), "cale-tts-"));
    const wavPath = join(tmpDir, "speech.wav");

    try {
      const cleanText = stripReactions(text);
      if (!cleanText) {
        return { played: false, message: "No speakable text after filtering" };
      }
      const { ok, stderr } = await runPiper(cleanText, wavPath, modelPath);
      if (!ok) {
        return {
          played: false,
          message: `Piper failed. Is 'piper' in PATH? (pip install piper-tts). ${stderr.slice(0, 200)}`,
        };
      }

      const play = getPlayCommand();
      if (!play) {
        return {
          played: false,
          message: `WAV saved to ${wavPath}. No audio player found for ${platform()}.`,
        };
      }

      if (platform() === "win32") {
        const escaped = wavPath.replace(/'/g, "''");
        play.args[2] = `(New-Object System.Media.SoundPlayer '${escaped}').PlaySync()`;
      } else {
        play.args.push(wavPath);
      }

      await new Promise<void>((resolve, reject) => {
        const proc = spawn(play.cmd, play.args, { stdio: "ignore" });
        proc.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`Player exited ${code}`))));
        proc.on("error", reject);
      });

      return { played: true, message: `Spoke: "${text.slice(0, 80)}${text.length > 80 ? "..." : ""}"` };
    } finally {
      try {
        if (existsSync(wavPath)) unlinkSync(wavPath);
        rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        /* ignore cleanup errors */
      }
    }
  },
});

/** Speak text directly (no approval). Used when /speak is on for auto-speaking responses. */
export async function speakText(text: string): Promise<boolean> {
  const modelPath = getPiperModel();
  if (!modelPath || !existsSync(modelPath)) return false;
  const trimmed = stripReactions(text);
  if (!trimmed) return false;

  const tmpDir = mkdtempSync(join(tmpdir(), "cale-tts-"));
  const wavPath = join(tmpDir, "speech.wav");

  try {
    const { ok } = await runPiper(trimmed, wavPath, modelPath);
    if (!ok) return false;
    const play = getPlayCommand();
    if (!play) return false;
    if (platform() === "win32") {
      const escaped = wavPath.replace(/'/g, "''");
      play.args[2] = `(New-Object System.Media.SoundPlayer '${escaped}').PlaySync()`;
    } else {
      play.args.push(wavPath);
    }
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(play.cmd, play.args, { stdio: "ignore" });
      proc.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`Player exited ${code}`))));
      proc.on("error", reject);
    });
    return true;
  } catch {
    return false;
  } finally {
    try {
      if (existsSync(wavPath)) unlinkSync(wavPath);
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}
