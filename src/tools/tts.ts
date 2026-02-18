import { spawn } from "node:child_process";
import { platform } from "node:os";
import { join } from "node:path";
import { mkdtempSync, unlinkSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { tool } from "ai";
import { z } from "zod";
import { requestApproval } from "./approval.ts";
import { getConfigDir, loadSettings, type TtsProvider } from "../config/settings.ts";

const DEFAULT_TTS_MODEL_FILENAME = "en_US-libritts_r-medium.onnx";
const DEFAULT_TTS_ENDPOINT =
  "http://localhost:5002/api/text-to-speech?speakerId=hot-moody";
const DEFAULT_TTS_PROVIDER: TtsProvider = "endpoint";

function normalizeTtsProvider(value: string | undefined): TtsProvider | undefined {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "endpoint" || normalized === "piper") return normalized;
  return undefined;
}

export function getConfiguredTtsProvider(): TtsProvider {
  const fromEnv = normalizeTtsProvider(process.env.CALE_TTS_PROVIDER);
  if (fromEnv) return fromEnv;
  return loadSettings().ttsProvider ?? DEFAULT_TTS_PROVIDER;
}

export function getPiperModel(): string | undefined {
  const configured =
    process.env.CALE_TTS_MODEL ??
    process.env.CALE_PIPER_MODEL ??
    process.env.PIPER_MODEL ??
    loadSettings().ttsModel;
  if (configured) return configured;
  const defaultPath = join(getConfigDir(), "piper", DEFAULT_TTS_MODEL_FILENAME);
  return existsSync(defaultPath) ? defaultPath : undefined;
}

export function getTtsEndpoint(): string | undefined {
  const settings = loadSettings();
  const endpoint =
    process.env.CALE_TTS_ENDPOINT ??
    settings.ttsEndpoint ??
    DEFAULT_TTS_ENDPOINT;
  return endpoint?.trim() || undefined;
}

function isLocalhostTtsEndpoint(endpoint: string): boolean {
  try {
    const parsed = new URL(endpoint);
    const hostname = parsed.hostname.toLowerCase();
    const isLoopback =
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "[::1]" ||
      hostname === "::1";
    const port = parsed.port || (parsed.protocol === "https:" ? "443" : "80");
    return isLoopback && port === "5002";
  } catch {
    return false;
  }
}

function isEndpointUnavailable(stderr: string): boolean {
  const normalized = stderr.toLowerCase();
  return (
    normalized.includes("fetch failed") ||
    normalized.includes("econnrefused") ||
    normalized.includes("econnreset") ||
    normalized.includes("ehostunreach") ||
    normalized.includes("enotfound") ||
    normalized.includes("etimedout")
  );
}

function piperMissingHint(): string {
  return process.env.CALE_TTS_MODEL ?? process.env.CALE_PIPER_MODEL
    ? "CALE_TTS_MODEL path does not exist"
    : "Set CALE_TTS_MODEL to your Piper .onnx model path (e.g. ~/.local/share/piper/en_US-libritts_r-medium.onnx). Install: pip install piper-tts, then download a model from https://huggingface.co/rhasspy/piper-voices";
}

export interface TtsProviderStatus {
  id: TtsProvider;
  configured: boolean;
  detail: string;
}

export function listTtsProviders(): TtsProviderStatus[] {
  const endpoint = getTtsEndpoint();
  const modelPath = getPiperModel();
  return [
    {
      id: "endpoint",
      configured: Boolean(endpoint),
      detail: endpoint ?? "No endpoint configured",
    },
    {
      id: "piper",
      configured: Boolean(modelPath && existsSync(modelPath)),
      detail: modelPath
        ? existsSync(modelPath)
          ? modelPath
          : `${modelPath} (missing)`
        : "No Piper model configured",
    },
  ];
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

function decodeBase64Audio(value: string): Uint8Array | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const encodedRaw = trimmed.startsWith("data:")
    ? trimmed.slice(trimmed.indexOf(",") + 1)
    : trimmed;
  if (!encodedRaw) return null;

  const noWhitespace = encodedRaw.replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/=_-]+$/.test(noWhitespace)) return null;
  const normalized = noWhitespace.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");

  try {
    const decoded = Buffer.from(padded, "base64");
    if (decoded.length === 0) return null;
    const roundTrip = decoded.toString("base64").replace(/=+$/g, "");
    const source = padded.replace(/=+$/g, "");
    if (roundTrip !== source) return null;
    return Uint8Array.from(decoded);
  } catch {
    return null;
  }
}

async function fetchAudioUrl(url: string): Promise<Uint8Array | null> {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  } catch {
    return null;
  }

  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    return new Uint8Array(await response.arrayBuffer());
  } catch {
    return null;
  }
}

async function extractAudioBytes(payload: unknown, depth = 0): Promise<Uint8Array | null> {
  if (depth > 4 || payload === null || payload === undefined) return null;

  if (typeof payload === "string") {
    const fromUrl = await fetchAudioUrl(payload);
    if (fromUrl && fromUrl.byteLength > 0) return fromUrl;
    const fromBase64 = decodeBase64Audio(payload);
    return fromBase64 && fromBase64.byteLength > 0 ? fromBase64 : null;
  }

  if (Array.isArray(payload)) {
    for (const item of payload) {
      const extracted = await extractAudioBytes(item, depth + 1);
      if (extracted) return extracted;
    }
    return null;
  }

  if (typeof payload !== "object") return null;

  const obj = payload as Record<string, unknown>;
  const preferredKeys = [
    "audio",
    "audioBase64",
    "audio_base64",
    "base64",
    "data",
    "url",
    "audioUrl",
    "audio_url",
  ];

  for (const key of preferredKeys) {
    if (key in obj) {
      const extracted = await extractAudioBytes(obj[key], depth + 1);
      if (extracted) return extracted;
    }
  }

  for (const value of Object.values(obj)) {
    if (!value || typeof value !== "object") continue;
    const extracted = await extractAudioBytes(value, depth + 1);
    if (extracted) return extracted;
  }

  return null;
}

async function runEndpointTts(
  text: string,
  wavPath: string,
  endpoint: string
): Promise<{ ok: boolean; stderr: string }> {
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "text/plain; charset=utf-8",
        accept: "audio/wav,audio/*,application/json,text/plain",
      },
      body: text,
    });

    if (!response.ok) {
      const errText = (await response.text()).slice(0, 300);
      return { ok: false, stderr: `HTTP ${response.status}: ${errText}` };
    }

    const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
    if (contentType.includes("application/json")) {
      const payload = (await response.json()) as unknown;
      const bytes = await extractAudioBytes(payload);
      if (!bytes || bytes.byteLength === 0) {
        return {
          ok: false,
          stderr:
            "JSON response had no audio payload. Return raw audio bytes, or JSON with audio/base64/url fields.",
        };
      }
      writeFileSync(wavPath, bytes);
      return { ok: true, stderr: "" };
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0) {
      return { ok: false, stderr: "TTS endpoint returned an empty audio response." };
    }
    writeFileSync(wavPath, bytes);
    return { ok: true, stderr: "" };
  } catch (error) {
    const cause =
      error && typeof error === "object"
        ? (error as { cause?: unknown }).cause
        : undefined;
    const causeCode =
      cause && typeof cause === "object" && typeof (cause as { code?: unknown }).code === "string"
        ? String((cause as { code?: unknown }).code)
        : "";
    const base = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      stderr: causeCode ? `${base} (${causeCode})` : base,
    };
  }
}

export const speakTool = tool({
  description:
    "Convert text to speech and play it aloud. Uses CALE_TTS_ENDPOINT when configured (posts raw text body) and falls back to local Piper when localhost:5002 is unavailable. Requires user approval before playing.",
  inputSchema: z.object({
    text: z.string().describe("The text to speak aloud"),
  }),
  execute: async ({ text }) => {
    const approved = await requestApproval("speak", `Speak: "${text.slice(0, 60)}${text.length > 60 ? "..." : ""}"`);
    if (!approved) {
      return { played: false, message: "User declined" };
    }

    const provider = getConfiguredTtsProvider();
    const endpoint = getTtsEndpoint();
    const modelPath = getPiperModel();

    const tmpDir = mkdtempSync(join(tmpdir(), "cale-tts-"));
    const wavPath = join(tmpDir, "speech.wav");

    try {
      const cleanText = stripReactions(text);
      if (!cleanText) {
        return { played: false, message: "No speakable text after filtering" };
      }
      if (provider === "endpoint") {
        if (!endpoint) {
          return {
            played: false,
            message: "TTS endpoint is not configured. Set CALE_TTS_ENDPOINT or configure ttsEndpoint.",
          };
        }
        const endpointResult = await runEndpointTts(cleanText, wavPath, endpoint);
        if (!endpointResult.ok) {
          const shouldFallbackToPiper =
            isLocalhostTtsEndpoint(endpoint) && isEndpointUnavailable(endpointResult.stderr);
          if (!shouldFallbackToPiper) {
            return {
              played: false,
              message: `TTS endpoint failed (${endpoint}). ${endpointResult.stderr.slice(0, 200)}`,
            };
          }
          if (!modelPath || !existsSync(modelPath)) {
            return {
              played: false,
              message: `TTS endpoint unavailable (${endpoint}). Piper TTS not configured. ${piperMissingHint()}`,
            };
          }
          const { ok, stderr } = await runPiper(cleanText, wavPath, modelPath);
          if (!ok) {
            return {
              played: false,
              message: `TTS endpoint unavailable (${endpoint}). Piper failed. Is 'piper' in PATH? (pip install piper-tts). ${stderr.slice(0, 200)}`,
            };
          }
        }
      } else {
        if (!modelPath || !existsSync(modelPath)) {
          return {
            played: false,
            message: `Piper TTS not configured. ${piperMissingHint()}`,
          };
        }
        const { ok, stderr } = await runPiper(cleanText, wavPath, modelPath);
        if (!ok) {
          return {
            played: false,
            message: `Piper failed. Is 'piper' in PATH? (pip install piper-tts). ${stderr.slice(0, 200)}`,
          };
        }
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

export interface SpeakTextOptions {
  provider?: TtsProvider;
  onServiceWaitChange?: (waiting: boolean) => void;
}

/** Speak text directly (no approval). Used when /tts on is active for auto-speaking responses. */
export async function speakText(text: string, options: SpeakTextOptions = {}): Promise<boolean> {
  const provider = options.provider ?? getConfiguredTtsProvider();
  const endpoint = getTtsEndpoint();
  const modelPath = getPiperModel();
  const trimmed = stripReactions(text);
  if (!trimmed) return false;

  const tmpDir = mkdtempSync(join(tmpdir(), "cale-tts-"));
  const wavPath = join(tmpDir, "speech.wav");
  let waitingForEndpoint = false;

  try {
    if (provider === "endpoint") {
      if (!endpoint) return false;
      waitingForEndpoint = true;
      options.onServiceWaitChange?.(true);
      const endpointResult = await runEndpointTts(trimmed, wavPath, endpoint);
      waitingForEndpoint = false;
      options.onServiceWaitChange?.(false);
      if (!endpointResult.ok) {
        const shouldFallbackToPiper =
          isLocalhostTtsEndpoint(endpoint) && isEndpointUnavailable(endpointResult.stderr);
        if (!shouldFallbackToPiper) return false;
        if (!modelPath || !existsSync(modelPath)) return false;
        const { ok } = await runPiper(trimmed, wavPath, modelPath);
        if (!ok) return false;
      }
    } else {
      if (!modelPath || !existsSync(modelPath)) return false;
      const { ok } = await runPiper(trimmed, wavPath, modelPath);
      if (!ok) return false;
    }
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
    if (waitingForEndpoint) {
      options.onServiceWaitChange?.(false);
    }
    try {
      if (existsSync(wavPath)) unlinkSync(wavPath);
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}
