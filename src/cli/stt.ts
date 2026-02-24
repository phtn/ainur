import { existsSync } from "node:fs";
import { join } from "node:path";
import { getConfigDir } from "../config/settings.ts";
import { STT_Service } from "../services/stt.ts";
import { transcribeAudioFile as vcrTranscribeAudioFile } from "../services/vcr.ts";

export interface TranscribeAudioFileOptions {
  filePath: string;
}

const STT_USAGE = "Usage: cale stt [audio-file]\n  No file: start interactive recording (press q to finish).";
const DEFAULT_STT_BASENAME = "stt-input";
const DEFAULT_STT_EXTENSIONS = [".webm", ".m4a", ".wav", ".mp3", ".ogg", ".mp4"];

interface SttArgs {
  filePath?: string;
  help: boolean;
}

function parseSttArgs(args: string[]): SttArgs {
  const parsed: SttArgs = { help: false };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }
    if (arg === "--file") {
      parsed.filePath = args[i + 1];
      i++;
      continue;
    }
    if (arg.startsWith("--file=")) {
      parsed.filePath = arg.slice("--file=".length);
      continue;
    }
    if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    }
    if (!parsed.filePath) {
      parsed.filePath = arg;
      continue;
    }
    throw new Error(`Unexpected argument: ${arg}`);
  }
  return parsed;
}

function getDefaultSttAudioFilePath(): string {
  const runtimeDir = join(getConfigDir(), "runtime");
  for (const ext of DEFAULT_STT_EXTENSIONS) {
    const candidate = join(runtimeDir, `${DEFAULT_STT_BASENAME}${ext}`);
    if (existsSync(candidate)) return candidate;
  }
  return join(runtimeDir, `${DEFAULT_STT_BASENAME}.webm`);
}

/** Transcribe an audio file using the new STT service (local Whisper via vcr). */
export async function transcribeAudioFile(options: TranscribeAudioFileOptions): Promise<string> {
  return vcrTranscribeAudioFile(options.filePath, { service: "whisper" });
}

export async function runSttCli(args: string[]): Promise<void> {
  const parsed = parseSttArgs(args);

  if (parsed.help) {
    console.log(STT_USAGE);
    return;
  }

  const filePath = parsed.filePath ?? getDefaultSttAudioFilePath();
  const hasExplicitFile = Boolean(parsed.filePath);
  const defaultFileExists = !hasExplicitFile && existsSync(filePath);

  if (hasExplicitFile && !existsSync(filePath)) {
    throw new Error(`${STT_USAGE}\nFile not found: ${filePath}`);
  }

  if (hasExplicitFile || defaultFileExists) {
    const transcript = await vcrTranscribeAudioFile(filePath, { service: "whisper" });
    console.log(transcript);
    return;
  }

  // No file: interactive recording via new STT service
  const sttService = new STT_Service();
  const transcript = await sttService.startRecording();
  console.log(transcript);
}
