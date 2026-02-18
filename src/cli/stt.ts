import { existsSync } from "node:fs";
import { join } from "node:path";
import { basename } from "node:path";
import { getConfigDir, loadSettings } from "../config/settings.ts";

interface SttArgs {
  filePath?: string;
  endpoint?: string;
  help: boolean;
}

export interface TranscribeAudioFileOptions {
  filePath: string;
  endpoint?: string;
}

const STT_USAGE =
  "Usage: cale stt [audio-file] [--endpoint <url>]";
const DEFAULT_STT_ENDPOINT = "http://localhost:5002/api/speech-to-text";
const DEFAULT_STT_BASENAME = "stt-input";
const DEFAULT_STT_EXTENSIONS = [".webm", ".m4a", ".wav", ".mp3", ".ogg", ".mp4"];

function parseSttArgs(args: string[]): SttArgs {
  const parsed: SttArgs = {
    help: false,
  };

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

    if (arg === "--endpoint") {
      parsed.endpoint = args[i + 1];
      i++;
      continue;
    }

    if (arg.startsWith("--endpoint=")) {
      parsed.endpoint = arg.slice("--endpoint=".length);
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

function trimBody(body: string, maxChars: number): string {
  if (body.length <= maxChars) return body;
  return `${body.slice(0, maxChars)}...`;
}

function getSttEndpoint(override?: string): string | undefined {
  if (override?.trim()) return override.trim();
  const settings = loadSettings();
  const endpoint =
    process.env.CALE_STT_ENDPOINT ??
    settings.sttEndpoint ??
    DEFAULT_STT_ENDPOINT;
  return endpoint.trim() || DEFAULT_STT_ENDPOINT;
}

function getDefaultSttAudioFilePath(): string {
  const runtimeDir = join(getConfigDir(), "runtime");
  for (const ext of DEFAULT_STT_EXTENSIONS) {
    const candidate = join(runtimeDir, `${DEFAULT_STT_BASENAME}${ext}`);
    if (existsSync(candidate)) return candidate;
  }
  return join(runtimeDir, `${DEFAULT_STT_BASENAME}.webm`);
}

interface SttResponse {
  contentType: string;
  payload: string | { text?: string; transcript?: string };
}

async function postAudioForTranscription(
  filePath: string,
  endpoint: string
): Promise<SttResponse> {
  if (!existsSync(filePath)) {
    throw new Error(`Audio file not found: ${filePath}`);
  }

  const form = new FormData();
  form.append("file", Bun.file(filePath), basename(filePath));

  const response = await fetch(endpoint, {
    method: "POST",
    body: form,
  });

  const contentType = (response.headers.get("content-type") ?? "").toLowerCase();

  if (!response.ok) {
    const errBody = trimBody(await response.text(), 300);
    throw new Error(`STT request failed (${response.status}): ${errBody}`);
  }

  if (contentType.includes("application/json")) {
    const payload = (await response.json()) as {
      text?: string;
      transcript?: string;
    };
    return {
      contentType,
      payload,
    };
  }

  return {
    contentType,
    payload: await response.text(),
  };
}

export async function transcribeAudioFile(
  options: TranscribeAudioFileOptions
): Promise<string> {
  const endpoint = getSttEndpoint(options.endpoint);
  if (!endpoint) {
    throw new Error(
      "STT endpoint is not configured. Set it with: cale config set sttEndpoint <url>"
    );
  }

  const result = await postAudioForTranscription(options.filePath, endpoint);

  if (result.contentType.includes("application/json")) {
    const payload = result.payload as { text?: string; transcript?: string };
    const transcript = payload.text?.trim() || payload.transcript?.trim() || "";
    if (!transcript) {
      throw new Error(
        "STT response JSON must include `text` or `transcript`."
      );
    }
    return transcript;
  }

  const text = String(result.payload).trim();
  if (!text) {
    throw new Error("STT endpoint returned an empty response.");
  }
  return text;
}

export async function runSttCli(args: string[]): Promise<void> {
  const parsed = parseSttArgs(args);

  if (parsed.help) {
    console.log(STT_USAGE);
    return;
  }
  const filePath = parsed.filePath ?? getDefaultSttAudioFilePath();
  if (!existsSync(filePath)) {
    throw new Error(
      `${STT_USAGE}\nNo audio file found. Press '\\' in REPL to record first, or pass a file path.`
    );
  }

  const endpoint = getSttEndpoint(parsed.endpoint);
  if (!endpoint) {
    throw new Error(
      "STT endpoint is not configured. Set it with: cale config set sttEndpoint <url>"
    );
  }

  const result = await postAudioForTranscription(
    filePath,
    endpoint
  );

  if (result.contentType.includes("application/json")) {
    const payload = result.payload as { text?: string; transcript?: string };
    const transcript = payload.text?.trim() || payload.transcript?.trim() || "";
    if (!transcript) {
      throw new Error("STT response JSON must include `text` or `transcript`.");
    }
    console.log(transcript);
    return;
  }

  const text = String(result.payload).trim();
  if (!text) {
    throw new Error("STT endpoint returned an empty response.");
  }
  console.log(text);
}
