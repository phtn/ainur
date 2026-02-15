import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { tool } from "ai";
import pc from "picocolors";
import { z } from "zod";
import { requestApproval } from "./approval.ts";

const DEFAULT_HEARTBEAT_URL = "https://www.moltbook.com/heartbeat.md";
const DEFAULT_API_BASE = "https://www.moltbook.com/api/v1";

interface MoltbookCredentials {
  api_key: string;
  agent_name?: string;
  base_url?: string;
}

function getCredentialsPath(): string {
  return (
    process.env.MOLTBOOK_CREDENTIALS_PATH?.trim() ||
    join(homedir(), ".config", "moltbook", "credentials.json")
  );
}

export function loadMoltbookCredentials(): MoltbookCredentials | null {
  const fromEnv = process.env.MOLTBOOK_API_KEY?.trim();
  if (fromEnv) {
    return {
      api_key: fromEnv,
      agent_name: process.env.MOLTBOOK_AGENT_NAME?.trim() || "cale",
      base_url: process.env.MOLTBOOK_API_BASE?.trim() || undefined,
    };
  }

  const path = getCredentialsPath();
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as Partial<MoltbookCredentials>;
    if (!parsed.api_key || typeof parsed.api_key !== "string") return null;
    return {
      api_key: parsed.api_key,
      agent_name: typeof parsed.agent_name === "string" ? parsed.agent_name : undefined,
      base_url: typeof parsed.base_url === "string" ? parsed.base_url : undefined,
    };
  } catch {
    return null;
  }
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function buildUrl(baseUrl: string, path: string, query?: Record<string, string>): string {
  const base = trimTrailingSlash(baseUrl);
  const rel = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(`${base}${rel}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

function parseResponseBody(body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return body;
  }
}

function truncateBody(body: string, limit = 120_000): { text: string; truncated: boolean } {
  if (body.length <= limit) return { text: body, truncated: false };
  return { text: `${body.slice(0, limit)}…`, truncated: true };
}

function parseCandidateList(raw: string | undefined, fallback: string[]): string[] {
  if (!raw?.trim()) return fallback;
  const values = raw
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  return values.length > 0 ? values : fallback;
}

function routeCandidates(name: string, fallback: string[]): string[] {
  const key = `MOLTBOOK_ROUTE_${name}`;
  return parseCandidateList(process.env[key], fallback);
}

function maybeStringifyJson(input: unknown): string | undefined {
  if (input === undefined) return undefined;
  return JSON.stringify(input);
}

export async function fetchMoltbookHeartbeatMarkdown(url = DEFAULT_HEARTBEAT_URL): Promise<{
  url: string;
  status: number;
  body: string;
}> {
  const res = await fetch(url, {
    headers: { "User-Agent": "cale/0.1.0" },
  });
  return {
    url,
    status: res.status,
    body: await res.text(),
  };
}

export async function moltbookApiRequest(input: {
  path: string;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  query?: Record<string, string>;
  body?: string;
  baseUrl?: string;
  headers?: Record<string, string>;
}): Promise<{
  url: string;
  status: number;
  contentType: string | null;
  body: unknown;
  rawBody: string;
}> {
  const creds = loadMoltbookCredentials();
  if (!creds) {
    throw new Error(
      "Missing Moltbook credentials. Set MOLTBOOK_API_KEY or ~/.config/moltbook/credentials.json"
    );
  }

  const method = input.method ?? "GET";
  const baseUrl = input.baseUrl ?? creds.base_url ?? process.env.MOLTBOOK_API_BASE ?? DEFAULT_API_BASE;
  const url = buildUrl(baseUrl, input.path, input.query);

  const headers = new Headers({
    "User-Agent": "cale/0.1.0",
    Accept: "application/json, text/plain;q=0.9, */*;q=0.8",
    Authorization: `Bearer ${creds.api_key}`,
    "x-api-key": creds.api_key,
  });
  if (creds.agent_name) headers.set("x-agent-name", creds.agent_name);
  if (input.headers) {
    for (const [k, v] of Object.entries(input.headers)) {
      headers.set(k, v);
    }
  }
  if (input.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const res = await fetch(url, {
    method,
    headers,
    body: input.body,
  });
  const rawBody = await res.text();
  return {
    url,
    status: res.status,
    contentType: res.headers.get("content-type"),
    body: parseResponseBody(rawBody),
    rawBody,
  };
}

async function requestWithCandidates(input: {
  candidates: string[];
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  query?: Record<string, string>;
  body?: string;
  baseUrl?: string;
  headers?: Record<string, string>;
}): Promise<{
  result: Awaited<ReturnType<typeof moltbookApiRequest>>;
  selectedPath: string;
  attempts: Array<{ path: string; status: number }>;
}> {
  const attempts: Array<{ path: string; status: number }> = [];
  let last: Awaited<ReturnType<typeof moltbookApiRequest>> | null = null;
  let lastPath = input.candidates[0] ?? "/";

  for (const candidate of input.candidates) {
    const response = await moltbookApiRequest({
      path: candidate,
      method: input.method,
      query: input.query,
      body: input.body,
      baseUrl: input.baseUrl,
      headers: input.headers,
    });
    attempts.push({ path: candidate, status: response.status });
    last = response;
    lastPath = candidate;

    // 404/405 commonly indicate wrong route. Try next candidate.
    if (response.status === 404 || response.status === 405) {
      continue;
    }
    return { result: response, selectedPath: candidate, attempts };
  }

  if (!last) {
    throw new Error("No Moltbook route candidates available.");
  }
  return { result: last, selectedPath: lastPath, attempts };
}

function formatResultBody(body: unknown): {
  body: unknown;
  truncated?: boolean;
} {
  if (typeof body !== "string") {
    return { body };
  }
  const truncated = truncateBody(body);
  return {
    body: truncated.text,
    truncated: truncated.truncated,
  };
}

const TOOL_ACTIONS = [
  "heartbeat",
  "feed",
  "notifications",
  "profile",
  "post",
  "dm_inbox",
  "dm_send",
  "request",
] as const;

type MoltbookAction = (typeof TOOL_ACTIONS)[number];

const DEFAULT_ROUTES = {
  FEED: ["/feed", "/posts", "/timeline"],
  NOTIFICATIONS: ["/notifications", "/alerts"],
  PROFILE: ["/agents/me", "/me", "/agent", "/profile"],
  POST: ["/posts", "/post", "/messages/post"],
  DM_INBOX: ["/dms", "/messages", "/messages/inbox"],
  DM_SEND: ["/dms", "/messages"],
} as const;

function resolveActionCandidates(action: MoltbookAction): string[] {
  if (action === "feed") return routeCandidates("FEED", [...DEFAULT_ROUTES.FEED]);
  if (action === "notifications") {
    return routeCandidates("NOTIFICATIONS", [...DEFAULT_ROUTES.NOTIFICATIONS]);
  }
  if (action === "profile") return routeCandidates("PROFILE", [...DEFAULT_ROUTES.PROFILE]);
  if (action === "post") return routeCandidates("POST", [...DEFAULT_ROUTES.POST]);
  if (action === "dm_inbox") return routeCandidates("DM_INBOX", [...DEFAULT_ROUTES.DM_INBOX]);
  if (action === "dm_send") return routeCandidates("DM_SEND", [...DEFAULT_ROUTES.DM_SEND]);
  return [];
}

export const moltbookTool = tool({
  description:
    "Interact with Moltbook with high-level actions (feed, notifications, profile, post, dm) plus raw request mode. Uses ~/.config/moltbook/credentials.json or MOLTBOOK_API_KEY.",
  inputSchema: z.object({
    action: z.enum(TOOL_ACTIONS).optional().default("heartbeat"),
    heartbeatUrl: z.string().url().optional().describe("Optional heartbeat markdown URL override"),
    path: z.string().optional().describe("API path for request action, e.g. /feed"),
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).optional().default("GET"),
    query: z.record(z.string()).optional().describe("Query parameters"),
    body: z.string().optional().describe("Raw request body (usually JSON string)"),
    json: z.record(z.unknown()).optional().describe("JSON request body object"),
    content: z.string().optional().describe("Content text for post or dm_send actions"),
    to: z.string().optional().describe("Recipient id/handle for dm_send"),
    limit: z.number().int().positive().max(200).optional().describe("Optional page size for feed/notifications/dm_inbox"),
    baseUrl: z.string().url().optional().describe("Optional Moltbook API base override"),
    headers: z.record(z.string()).optional().describe("Optional extra headers"),
  }),
  execute: async ({
    action,
    heartbeatUrl,
    path,
    method,
    query,
    body,
    json,
    content,
    to,
    limit,
    baseUrl,
    headers,
  }) => {
    if (action === "heartbeat") {
      process.stderr.write(pc.dim("  ⚙ moltbook heartbeat\n"));
      const result = await fetchMoltbookHeartbeatMarkdown(heartbeatUrl ?? DEFAULT_HEARTBEAT_URL);
      const truncated = truncateBody(result.body);
      return {
        action,
        url: result.url,
        status: result.status,
        body: truncated.text,
        truncated: truncated.truncated,
      };
    }

    const mergedQuery: Record<string, string> = {
      ...(query ?? {}),
      ...(limit ? { limit: String(limit) } : {}),
    };
    const resolvedBody =
      body ??
      maybeStringifyJson(json) ??
      (action === "post" && content
        ? JSON.stringify({ content })
        : action === "dm_send" && content && to
          ? JSON.stringify({ to, message: content })
          : undefined);

    const resolvedMethod =
      action === "post" || action === "dm_send"
        ? "POST"
        : action === "request"
          ? method
          : "GET";

    const shouldApprove =
      resolvedMethod !== "GET" ||
      action === "post" ||
      action === "dm_send";
    if (shouldApprove) {
      const summary =
        action === "post"
          ? `Moltbook post: ${content?.slice(0, 60) ?? "(empty)"}`
          : action === "dm_send"
            ? `Moltbook DM to ${to ?? "(missing target)"}`
            : `Moltbook ${resolvedMethod} ${path ?? "(missing path)"}`;
      const approved = await requestApproval("moltbook", summary);
      if (!approved) return { action, status: "denied", message: "User declined request" };
    }

    if (action === "post" && !content && !resolvedBody) {
      throw new Error("content is required for action=post unless body/json is provided");
    }
    if (action === "dm_send" && (!to || (!content && !resolvedBody))) {
      throw new Error("action=dm_send requires `to` and `content` (or body/json)");
    }

    if (action === "request") {
      if (!path?.trim()) {
        throw new Error("path is required for action=request");
      }
      process.stderr.write(pc.dim(`  ⚙ moltbook ${resolvedMethod} ${path}\n`));
      const result = await moltbookApiRequest({
        path: path.trim(),
        method: resolvedMethod,
        query: mergedQuery,
        body: resolvedBody,
        baseUrl,
        headers,
      });
      const formatted = formatResultBody(result.body);
      return {
        action,
        method: resolvedMethod,
        path: path.trim(),
        url: result.url,
        status: result.status,
        contentType: result.contentType,
        body: formatted.body,
        ...(formatted.truncated !== undefined ? { truncated: formatted.truncated } : {}),
      };
    }

    const candidates = resolveActionCandidates(action);
    process.stderr.write(
      pc.dim(`  ⚙ moltbook ${action} ${resolvedMethod} ${candidates.join(", ")}\n`)
    );
    const response = await requestWithCandidates({
      candidates,
      method: resolvedMethod,
      query: mergedQuery,
      body: resolvedBody,
      baseUrl,
      headers,
    });
    const formatted = formatResultBody(response.result.body);
    return {
      action,
      method: resolvedMethod,
      selectedPath: response.selectedPath,
      attempts: response.attempts,
      url: response.result.url,
      status: response.result.status,
      contentType: response.result.contentType,
      body: formatted.body,
      ...(formatted.truncated !== undefined ? { truncated: formatted.truncated } : {}),
    };
  },
});
