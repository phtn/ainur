import { loadSettings } from "../config/settings.ts";

const DEFAULT_TTS_ENDPOINT =
  "http://localhost:5002/api/text-to-speech?speakerId=hot-moody";
const DEFAULT_REQUEST_TIMEOUT_MS = 2500;
const VOICE_VALUE_KEYS = [
  "speaker_id",
  "speakerId",
  "speaker",
  "voiceId",
  "voice",
  "value",
  "id",
  "name",
];
const VOICE_LABEL_KEYS = ["label", "title", "displayName", "name"];

export interface TtsVoiceOption {
  id: string;
  label?: string;
}

export interface TtsVoiceOptionsResult {
  options: TtsVoiceOption[];
  sourceUrl?: string;
  method?: "GET" | "OPTIONS";
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

function isVoiceContextKey(context: string): boolean {
  const key = context.trim().toLowerCase();
  if (!key) return false;
  return key.includes("voice") || key.includes("speaker") || key === "options";
}

function addVoiceOption(map: Map<string, TtsVoiceOption>, idRaw: string, labelRaw?: string): void {
  const id = idRaw.trim();
  if (!id) return;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(id)) return;
  const mapKey = id.toLowerCase();
  const existing = map.get(mapKey);
  if (!existing) {
    map.set(mapKey, {
      id,
      ...(labelRaw?.trim() ? { label: labelRaw.trim() } : {}),
    });
    return;
  }
  if (!existing.label && labelRaw?.trim()) {
    existing.label = labelRaw.trim();
  }
}

function collectVoiceOptions(
  payload: unknown,
  output: Map<string, TtsVoiceOption>,
  context = "root",
  depth = 0
): void {
  if (depth > 7 || payload === null || payload === undefined) return;

  if (Array.isArray(payload)) {
    const primitiveItems = payload.filter(
      (item) => typeof item === "string" || typeof item === "number"
    );
    const allPrimitive = primitiveItems.length === payload.length;
    const canUsePrimitiveItems = context === "root" || isVoiceContextKey(context);
    if (allPrimitive && canUsePrimitiveItems) {
      for (const item of primitiveItems) addVoiceOption(output, String(item));
      return;
    }
    for (const item of payload) collectVoiceOptions(item, output, context, depth + 1);
    return;
  }

  if (typeof payload === "string") {
    if (isVoiceContextKey(context)) addVoiceOption(output, payload);
    return;
  }

  if (!isRecord(payload)) return;
  const record = payload;
  const keys = Object.keys(record);

  const hasVoiceShapedKey = keys.some((key) => isVoiceContextKey(key));
  const voiceId = firstString(record, VOICE_VALUE_KEYS);
  if (voiceId && (hasVoiceShapedKey || isVoiceContextKey(context))) {
    addVoiceOption(output, voiceId, firstString(record, VOICE_LABEL_KEYS));
  }

  const preferredKeys = [
    "voices",
    "speakers",
    "speakerOptions",
    "voiceOptions",
    "options",
    "items",
    "results",
    "data",
  ];
  for (const key of preferredKeys) {
    if (key in record) collectVoiceOptions(record[key], output, key, depth + 1);
  }

  for (const [key, value] of Object.entries(record)) {
    if (preferredKeys.includes(key)) continue;
    if (isVoiceContextKey(key)) {
      collectVoiceOptions(value, output, key, depth + 1);
    }
  }
}

function parseTextVoiceOptions(raw: string): TtsVoiceOption[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  const candidates = trimmed
    .split(/\r?\n|,/)
    .map((line) => line.replace(/^[\s*-]+/, "").trim())
    .filter(Boolean);
  const map = new Map<string, TtsVoiceOption>();
  for (const item of candidates) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(item)) continue;
    addVoiceOption(map, item);
  }
  return [...map.values()];
}

function parseVoiceOptions(payload: unknown): TtsVoiceOption[] {
  const map = new Map<string, TtsVoiceOption>();
  collectVoiceOptions(payload, map);
  return [...map.values()];
}

function parseUnknownPayload(raw: string, contentType: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const shouldTryJson =
    contentType.includes("application/json") ||
    trimmed.startsWith("{") ||
    trimmed.startsWith("[");
  if (!shouldTryJson) return raw;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return raw;
  }
}

function buildVoiceCandidates(endpoint: string): string[] {
  const parsed = new URL(endpoint);
  parsed.hash = "";
  parsed.search = "";
  const normalizedPath = parsed.pathname.replace(/\/+$/, "") || "/";
  const baseUrl = `${parsed.origin}${normalizedPath}`;

  const candidates = [
    baseUrl,
    normalizedPath.endsWith("/voices") ? baseUrl : `${baseUrl}/voices`,
    normalizedPath.endsWith("/speakers") ? baseUrl : `${baseUrl}/speakers`,
    `${parsed.origin}/status`,
    `${parsed.origin}/api/voices`,
    `${parsed.origin}/api/speakers`,
  ];
  return [...new Set(candidates)];
}

async function requestVoiceOptions(
  url: string,
  method: "GET" | "OPTIONS"
): Promise<{ options: TtsVoiceOption[]; error?: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method,
      headers: { accept: "application/json,text/plain" },
      signal: controller.signal,
    });
    if (!response.ok) {
      return {
        options: [],
        error: `${method} ${url} -> HTTP ${response.status}`,
      };
    }
    const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
    const raw = await response.text();
    const payload = parseUnknownPayload(raw, contentType);
    const parsedOptions = parseVoiceOptions(payload);
    if (parsedOptions.length > 0) return { options: parsedOptions };
    if (typeof payload === "string") {
      const textOptions = parseTextVoiceOptions(payload);
      if (textOptions.length > 0) return { options: textOptions };
    }
    return {
      options: [],
      error: `${method} ${url} -> no voice options in response`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      options: [],
      error: `${method} ${url} -> ${message}`,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function getConfiguredTtsEndpoint(): string {
  const configured =
    process.env.CALE_TTS_ENDPOINT ??
    loadSettings().ttsEndpoint ??
    DEFAULT_TTS_ENDPOINT;
  return configured.trim() || DEFAULT_TTS_ENDPOINT;
}

export function getTtsVoiceIdFromEndpoint(endpoint: string): string | undefined {
  try {
    const parsed = new URL(endpoint);
    const speakerId = parsed.searchParams.get("speakerId")?.trim();
    if (speakerId) return speakerId;
    const voice = parsed.searchParams.get("voice")?.trim();
    if (voice) return voice;
    return undefined;
  } catch {
    return undefined;
  }
}

export function withTtsVoice(endpoint: string, voiceId: string): string {
  const trimmedVoice = voiceId.trim();
  if (!trimmedVoice) throw new Error("Voice id cannot be empty.");
  const parsed = new URL(endpoint);
  parsed.searchParams.set("speakerId", trimmedVoice);
  return parsed.toString();
}

export async function fetchTtsVoiceOptions(endpoint: string): Promise<TtsVoiceOptionsResult> {
  let candidates: string[];
  try {
    candidates = buildVoiceCandidates(endpoint);
  } catch {
    return {
      options: [],
      error: `Invalid TTS endpoint URL: ${endpoint}`,
    };
  }

  const errors: string[] = [];
  for (const url of candidates) {
    const getAttempt = await requestVoiceOptions(url, "GET");
    if (getAttempt.options.length > 0) {
      return {
        options: getAttempt.options,
        sourceUrl: url,
        method: "GET",
      };
    }
    if (getAttempt.error) errors.push(getAttempt.error);

    const optionsAttempt = await requestVoiceOptions(url, "OPTIONS");
    if (optionsAttempt.options.length > 0) {
      return {
        options: optionsAttempt.options,
        sourceUrl: url,
        method: "OPTIONS",
      };
    }
    if (optionsAttempt.error) errors.push(optionsAttempt.error);
  }

  return {
    options: [],
    error: errors[errors.length - 1] ?? "No voice options found from API responses.",
  };
}
