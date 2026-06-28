import { writeFileSync } from "node:fs";
import { getSettingsWithEnv } from "../config/settings.ts";

export const DEFAULT_MELO_TTS_ENDPOINT = "http://localhost:8000";
export const DEFAULT_MELO_TTS_LANGUAGE = "EN_NEWEST";
export const DEFAULT_MELO_TTS_SPEED = 1;

const REQUEST_TIMEOUT_MS = 10 * 60 * 1000;

export interface MeloTtsVoice {
  id: string;
  name?: string;
  embeddingReady?: boolean;
}

export interface MeloTtsLanguage {
  code: string;
  speaker?: string;
}

export interface MeloTtsListResult<T> {
  items: T[];
  sourceUrl: string;
  error?: string;
}

export interface MeloTtsSynthesizeOptions {
  endpoint?: string;
  voiceId?: string;
  language?: string;
  speed?: number;
}

export interface MeloTtsSynthesizeResult {
  ok: boolean;
  stderr: string;
  audioUrl?: string;
}

export interface MeloTtsVoiceResolution {
  ok: boolean;
  voiceId?: string;
  selector?: string;
  error?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function firstString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const raw = record[key];
    if (typeof raw === "string" && raw.trim()) return raw.trim();
    if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
  }
  return undefined;
}

function firstBoolean(record: Record<string, unknown>, keys: string[]): boolean | undefined {
  for (const key of keys) {
    const raw = record[key];
    if (typeof raw === "boolean") return raw;
  }
  return undefined;
}

function normalizeEndpoint(endpoint: string): string {
  return endpoint.trim().replace(/\/+$/, "") || DEFAULT_MELO_TTS_ENDPOINT;
}

function withTimeout(): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer),
  };
}

function readJsonError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function getMeloTtsEndpoint(): string {
  const settings = getSettingsWithEnv();
  return normalizeEndpoint(settings.meloTtsEndpoint ?? DEFAULT_MELO_TTS_ENDPOINT);
}

export function getMeloTtsVoiceId(): string | undefined {
  const voiceId = getSettingsWithEnv().meloTtsVoiceId?.trim();
  return voiceId || undefined;
}

export function getMeloTtsLanguage(): string {
  return getSettingsWithEnv().meloTtsLanguage?.trim() || DEFAULT_MELO_TTS_LANGUAGE;
}

export function getMeloTtsSpeed(): number {
  const speed = getSettingsWithEnv().meloTtsSpeed;
  return typeof speed === "number" && Number.isFinite(speed) && speed > 0 ? speed : DEFAULT_MELO_TTS_SPEED;
}

export function getMeloTtsVoiceSelector(voiceId: string): string {
  const trimmed = voiceId.trim();
  const separatorIndex = trimmed.indexOf("-");
  return separatorIndex > 0 ? trimmed.slice(0, separatorIndex) : trimmed;
}

function collectVoices(payload: unknown, output: Map<string, MeloTtsVoice>, depth = 0): void {
  if (depth > 7 || payload === null || payload === undefined) return;

  if (Array.isArray(payload)) {
    for (const item of payload) collectVoices(item, output, depth + 1);
    return;
  }

  if (typeof payload === "string") {
    const id = payload.trim();
    if (id) output.set(id.toLowerCase(), { id });
    return;
  }

  if (!isRecord(payload)) return;

  const id = firstString(payload, ["voice_id", "voiceId", "id", "uuid", "name"]);
  if (id) {
    const embeddingReady = firstBoolean(payload, ["embedding_ready", "embeddingReady"]);
    output.set(id.toLowerCase(), {
      id,
      name: firstString(payload, ["name", "label", "display_name", "displayName"]),
      ...(embeddingReady !== undefined ? { embeddingReady } : {}),
    });
  }

  for (const key of ["voices", "items", "results", "data"]) {
    if (key in payload) collectVoices(payload[key], output, depth + 1);
  }
}

function collectLanguages(payload: unknown, output: Map<string, MeloTtsLanguage>, depth = 0): void {
  if (depth > 7 || payload === null || payload === undefined) return;

  if (Array.isArray(payload)) {
    for (const item of payload) collectLanguages(item, output, depth + 1);
    return;
  }

  if (typeof payload === "string") {
    const code = payload.trim();
    if (code) output.set(code.toLowerCase(), { code });
    return;
  }

  if (!isRecord(payload)) return;

  for (const [key, value] of Object.entries(payload)) {
    if (typeof value === "string" || isRecord(value) || Array.isArray(value)) {
      if (/^[A-Z][A-Z0-9_]{1,31}$/.test(key)) {
        output.set(key.toLowerCase(), {
          code: key,
          speaker: isRecord(value) ? firstString(value, ["default_speaker", "speaker", "speaker_id"]) : undefined,
        });
      }
    }
  }

  const code = firstString(payload, ["code", "language", "id", "name"]);
  if (code && /^[A-Za-z][A-Za-z0-9_ -]{1,31}$/.test(code)) {
    output.set(code.toLowerCase(), {
      code,
      speaker: firstString(payload, ["default_speaker", "speaker", "speaker_id"]),
    });
  }

  for (const key of ["languages", "items", "results", "data"]) {
    if (key in payload) collectLanguages(payload[key], output, depth + 1);
  }
}

function findAudioUrl(payload: unknown, depth = 0): string | undefined {
  if (depth > 7 || payload === null || payload === undefined) return undefined;
  if (typeof payload === "string") {
    return payload.endsWith(".wav") || payload.includes("/audio/") ? payload : undefined;
  }
  if (Array.isArray(payload)) {
    for (const item of payload) {
      const found = findAudioUrl(item, depth + 1);
      if (found) return found;
    }
    return undefined;
  }
  if (!isRecord(payload)) return undefined;

  for (const key of ["audio_url", "audioUrl", "url", "href"]) {
    const raw = payload[key];
    if (typeof raw === "string" && raw.trim()) return raw.trim();
  }

  for (const key of ["audio", "result", "data"]) {
    if (key in payload) {
      const found = findAudioUrl(payload[key], depth + 1);
      if (found) return found;
    }
  }

  return undefined;
}

async function fetchJson(url: string): Promise<unknown> {
  const timeout = withTimeout();
  try {
    const response = await fetch(url, {
      headers: { accept: "application/json" },
      signal: timeout.signal,
    });
    if (!response.ok) {
      const text = (await response.text()).slice(0, 300);
      throw new Error(`HTTP ${response.status}${text ? `: ${text}` : ""}`);
    }
    return await response.json();
  } finally {
    timeout.clear();
  }
}

export async function fetchMeloTtsVoices(endpoint = getMeloTtsEndpoint()): Promise<MeloTtsListResult<MeloTtsVoice>> {
  const sourceUrl = `${normalizeEndpoint(endpoint)}/voices`;
  try {
    const payload = await fetchJson(sourceUrl);
    const voices = new Map<string, MeloTtsVoice>();
    collectVoices(payload, voices);
    return { items: [...voices.values()], sourceUrl };
  } catch (error) {
    return { items: [], sourceUrl, error: readJsonError(error) };
  }
}

export async function resolveMeloTtsVoiceId(
  selector: string,
  endpoint = getMeloTtsEndpoint()
): Promise<MeloTtsVoiceResolution> {
  const normalizedSelector = selector.trim();
  if (!normalizedSelector) {
    return { ok: false, error: "MeloTTS voice is required." };
  }

  const result = await fetchMeloTtsVoices(endpoint);
  if (!result.items.length) {
    return {
      ok: false,
      error: `No MeloTTS voices found. ${result.error ?? ""}`.trim(),
    };
  }

  const lowerSelector = normalizedSelector.toLowerCase();
  const exactId = result.items.find((voice) => voice.id.toLowerCase() === lowerSelector);
  if (exactId) {
    return { ok: true, voiceId: exactId.id, selector: getMeloTtsVoiceSelector(exactId.id) };
  }

  const aliasMatches = result.items.filter((voice) => getMeloTtsVoiceSelector(voice.id).toLowerCase() === lowerSelector);
  const nameMatches = result.items.filter((voice) => voice.name?.trim().toLowerCase() === lowerSelector);
  const matches = aliasMatches.length > 0 ? aliasMatches : nameMatches;

  if (matches.length === 1) {
    const voice = matches[0] as MeloTtsVoice;
    return { ok: true, voiceId: voice.id, selector: getMeloTtsVoiceSelector(voice.id) };
  }

  if (matches.length > 1) {
    const readyMatches = matches.filter((voice) => voice.embeddingReady === true);
    if (readyMatches.length === 1) {
      const voice = readyMatches[0] as MeloTtsVoice;
      return { ok: true, voiceId: voice.id, selector: getMeloTtsVoiceSelector(voice.id) };
    }
    const options = matches.map((voice) => voice.id).join(", ");
    return {
      ok: false,
      error: `MeloTTS voice "${normalizedSelector}" is ambiguous. Use one of: ${options}`,
    };
  }

  if (normalizedSelector.includes("-")) {
    return { ok: true, voiceId: normalizedSelector, selector: getMeloTtsVoiceSelector(normalizedSelector) };
  }

  return {
    ok: false,
    error: `MeloTTS voice "${normalizedSelector}" was not found. Run voice list and use the short name or full id.`,
  };
}

export async function fetchMeloTtsLanguages(
  endpoint = getMeloTtsEndpoint()
): Promise<MeloTtsListResult<MeloTtsLanguage>> {
  const sourceUrl = `${normalizeEndpoint(endpoint)}/languages`;
  try {
    const payload = await fetchJson(sourceUrl);
    const languages = new Map<string, MeloTtsLanguage>();
    collectLanguages(payload, languages);
    return { items: [...languages.values()], sourceUrl };
  } catch (error) {
    return { items: [], sourceUrl, error: readJsonError(error) };
  }
}

export async function runMeloTts(
  text: string,
  wavPath: string,
  options: MeloTtsSynthesizeOptions = {}
): Promise<MeloTtsSynthesizeResult> {
  const endpoint = normalizeEndpoint(options.endpoint ?? getMeloTtsEndpoint());
  const voiceId = options.voiceId?.trim() || getMeloTtsVoiceId();
  if (!voiceId) {
    return {
      ok: false,
      stderr: "MeloTTS voice is not configured. Upload a voice, then set meloTtsVoiceId or CALE_MELO_TTS_VOICE_ID.",
    };
  }

  const language = options.language?.trim() || getMeloTtsLanguage();
  const speed = options.speed ?? getMeloTtsSpeed();
  const timeout = withTimeout();

  try {
    const response = await fetch(`${endpoint}/synthesize`, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        voice_id: voiceId,
        text,
        language,
        speed,
      }),
      signal: timeout.signal,
    });

    if (!response.ok) {
      const body = (await response.text()).slice(0, 500);
      return { ok: false, stderr: `MeloTTS failed: HTTP ${response.status}${body ? `: ${body}` : ""}` };
    }

    const payload = (await response.json()) as unknown;
    const rawAudioUrl = findAudioUrl(payload);
    if (!rawAudioUrl) {
      return { ok: false, stderr: "MeloTTS response did not include audio.audio_url." };
    }

    const audioUrl = new URL(rawAudioUrl, `${endpoint}/`).toString();
    const audioResponse = await fetch(audioUrl, {
      headers: { accept: "audio/wav,audio/*" },
      signal: timeout.signal,
    });
    if (!audioResponse.ok) {
      return { ok: false, stderr: `MeloTTS audio download failed: HTTP ${audioResponse.status}` };
    }

    const bytes = new Uint8Array(await audioResponse.arrayBuffer());
    if (bytes.byteLength === 0) {
      return { ok: false, stderr: "MeloTTS returned an empty audio file." };
    }

    writeFileSync(wavPath, bytes);
    return { ok: true, stderr: "", audioUrl };
  } catch (error) {
    return { ok: false, stderr: readJsonError(error) };
  } finally {
    timeout.clear();
  }
}
