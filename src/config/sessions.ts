import { join } from "node:path";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { getConfigDir } from "./settings.ts";
import type { ModelMessage } from "ai";

/** Serializable session data stored on disk. */
export interface SessionData {
  messages: unknown[];
  updatedAt: string;
}

export interface SessionsFile {
  current: string | null;
  sessions: Record<string, SessionData>;
}

const SESSIONS_FILENAME = "sessions.json";

let _cache: SessionsFile | null = null;

function getSessionsPath(): string {
  return join(getConfigDir(), SESSIONS_FILENAME);
}

function loadSessionsRaw(): SessionsFile {
  if (_cache) return _cache;
  const path = getSessionsPath();
  if (!existsSync(path)) {
    _cache = { current: null, sessions: {} };
    return _cache;
  }
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw) as Partial<SessionsFile>;
    const sessions =
      parsed.sessions && typeof parsed.sessions === "object" ? parsed.sessions : {};
    _cache = {
      current:
        typeof parsed.current === "string" && sessions[parsed.current]
          ? parsed.current
          : null,
      sessions,
    };
  } catch {
    _cache = { current: null, sessions: {} };
  }
  return _cache;
}

function saveSessions(data: SessionsFile): void {
  const dir = getConfigDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(getSessionsPath(), JSON.stringify(data, null, 2), "utf-8");
  _cache = data;
}

/** Name of the current session, or null if none. */
export function getCurrentSessionName(): string | null {
  return loadSessionsRaw().current;
}

/** Set current session (use null to clear). Does not create the session. */
export function setCurrentSessionName(name: string | null): void {
  const data = loadSessionsRaw();
  data.current = name;
  saveSessions(data);
}

export interface SessionMeta {
  name: string;
  updatedAt: string;
  messageCount: number;
}

/** List all sessions with metadata. */
export function listSessions(): SessionMeta[] {
  const data = loadSessionsRaw();
  return Object.entries(data.sessions).map(([name, s]) => ({
    name,
    updatedAt: s.updatedAt,
    messageCount: Array.isArray(s.messages) ? s.messages.length : 0,
  }));
}

/** Load messages for a session. Returns empty array if session missing or invalid. */
export function loadSession(name: string): ModelMessage[] {
  const data = loadSessionsRaw();
  const session = data.sessions[name];
  if (!session || !Array.isArray(session.messages)) {
    return [];
  }
  return session.messages as ModelMessage[];
}

/** Save messages for a session. Creates session if needed. */
export function saveSession(name: string, messages: ModelMessage[]): void {
  const data = loadSessionsRaw();
  data.sessions[name] = {
    messages: messages as unknown[],
    updatedAt: new Date().toISOString(),
  };
  if (!data.current) {
    data.current = name;
  }
  saveSessions(data);
}

/** Delete a session. Clears current if it was this session. */
export function deleteSession(name: string): void {
  const data = loadSessionsRaw();
  if (!data.sessions[name]) {
    throw new Error(`Session "${name}" does not exist.`);
  }
  delete data.sessions[name];
  if (data.current === name) {
    data.current = Object.keys(data.sessions)[0] ?? null;
  }
  saveSessions(data);
}

/** Ensure a session exists (with empty messages). Returns whether it was created. */
export function ensureSession(name: string): boolean {
  const data = loadSessionsRaw();
  if (data.sessions[name]) return false;
  data.sessions[name] = { messages: [], updatedAt: new Date().toISOString() };
  if (!data.current) data.current = name;
  saveSessions(data);
  return true;
}
