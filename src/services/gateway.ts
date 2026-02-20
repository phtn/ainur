import type { ModelMessage } from "ai";
import { resolveModel } from "../agent/config.ts";
import { runAgentTextOnly } from "../agent/loop.ts";
import { getSettingsWithEnv } from "../config/settings.ts";

type OpenAiChatRole = "system" | "user" | "assistant" | "developer";

interface OpenAiChatMessage {
  role: OpenAiChatRole;
  content: unknown;
}

interface OpenAiChatCompletionsRequest {
  model?: string;
  messages?: unknown;
  stream?: boolean;
}

interface GatewayRuntime {
  host: string;
  port: number;
  startedAt: number;
}

export interface GatewayStatus {
  running: boolean;
  host?: string;
  port?: number;
  url?: string;
  startedAt?: string;
}

export interface StartGatewayResult {
  started: boolean;
  alreadyRunning: boolean;
  message: string;
  status: GatewayStatus;
}

let server: Bun.Server<unknown> | null = null;
let runtime: GatewayRuntime | null = null;

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function getBearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? null;
}

function normalizeGatewayHost(rawHost?: string): string {
  const trimmed = rawHost?.trim();
  if (!trimmed || trimmed === "loopback") return "127.0.0.1";
  if (trimmed === "lan") return "0.0.0.0";
  return trimmed;
}

function extractTextContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const item of content) {
      if (!item || typeof item !== "object") continue;
      const part = item as { type?: unknown; text?: unknown };
      if (
        (part.type === "text" || part.type === "input_text") &&
        typeof part.text === "string"
      ) {
        parts.push(part.text);
      }
    }
    return parts.join("\n").trim();
  }
  if (content && typeof content === "object") {
    const value = content as { text?: unknown };
    if (typeof value.text === "string") return value.text;
  }
  return "";
}

function toModelMessages(rawMessages: unknown): ModelMessage[] {
  if (!Array.isArray(rawMessages)) {
    throw new Error("messages must be an array");
  }

  const messages: ModelMessage[] = [];
  for (const rawMessage of rawMessages) {
    if (!rawMessage || typeof rawMessage !== "object") {
      throw new Error("each message must be an object");
    }
    const message = rawMessage as Partial<OpenAiChatMessage>;
    const role = message.role;
    if (role !== "system" && role !== "user" && role !== "assistant" && role !== "developer") {
      throw new Error(`unsupported message role: ${String(role)}`);
    }

    const normalizedRole = role === "developer" ? "system" : role;
    messages.push({
      role: normalizedRole,
      content: extractTextContent(message.content),
    });
  }
  return messages;
}

function resolveGatewayModel(rawModel?: string) {
  const requested = rawModel?.trim();
  if (!requested) return resolveModel();
  if (
    requested === "cale" ||
    requested.startsWith("cale:") ||
    requested.startsWith("openclaw:") ||
    requested.startsWith("agent:")
  ) {
    return resolveModel();
  }
  return resolveModel({ model: requested });
}

function getResponseModelName(rawModel?: string): string {
  const settings = getSettingsWithEnv();
  const requested = rawModel?.trim();
  if (!requested || requested === "cale" || requested.startsWith("cale:")) {
    return `${settings.provider}/${settings.model}`;
  }
  if (requested.startsWith("openclaw:") || requested.startsWith("agent:")) {
    return `${settings.provider}/${settings.model}`;
  }
  return requested;
}

async function handleChatCompletions(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return jsonResponse({ error: { message: "Method Not Allowed" } }, 405);
  }

  const settings = getSettingsWithEnv();
  const sharedToken = settings.gatewayToken?.trim();
  if (sharedToken) {
    const bearer = getBearerToken(request);
    if (!bearer || bearer !== sharedToken) {
      return jsonResponse({ error: { message: "Unauthorized" } }, 401);
    }
  }

  let body: OpenAiChatCompletionsRequest;
  try {
    body = (await request.json()) as OpenAiChatCompletionsRequest;
  } catch {
    return jsonResponse({ error: { message: "Invalid JSON body" } }, 400);
  }

  if (body.stream) {
    return jsonResponse(
      {
        error: {
          message: "stream=true is not supported yet for cale gateway",
        },
      },
      400
    );
  }

  let messages: ModelMessage[];
  try {
    messages = toModelMessages(body.messages);
  } catch (error) {
    return jsonResponse(
      {
        error: {
          message: error instanceof Error ? error.message : "Invalid messages payload",
        },
      },
      400
    );
  }

  const model = resolveGatewayModel(body.model);
  const startedAt = Date.now();
  const result = await runAgentTextOnly({
    model,
    messages,
  });
  const completionText = result.text ?? "";

  return jsonResponse({
    id: `chatcmpl_${crypto.randomUUID()}`,
    object: "chat.completion",
    created: Math.floor(startedAt / 1000),
    model: getResponseModelName(body.model),
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: completionText,
        },
        finish_reason: "stop",
      },
    ],
  });
}

async function handleGatewayRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/health") {
    return jsonResponse({
      ok: true,
      service: "cale-gateway",
      uptimeMs: runtime ? Date.now() - runtime.startedAt : 0,
    });
  }
  if (url.pathname === "/v1/chat/completions") {
    try {
      return await handleChatCompletions(request);
    } catch (error) {
      return jsonResponse(
        {
          error: {
            message:
              error instanceof Error ? error.message : "Internal server error",
          },
        },
        500
      );
    }
  }
  return jsonResponse({ error: { message: "Not Found" } }, 404);
}

export function getGatewayStatus(): GatewayStatus {
  if (!server || !runtime) return { running: false };
  return {
    running: true,
    host: runtime.host,
    port: runtime.port,
    url: server.url.toString(),
    startedAt: new Date(runtime.startedAt).toISOString(),
  };
}

export async function probeGatewayStatus(): Promise<GatewayStatus> {
  const live = getGatewayStatus();
  if (live.running) return live;

  const settings = getSettingsWithEnv();
  const host = normalizeGatewayHost(settings.gatewayBind);
  const port = settings.gatewayPort ?? 18889;
  const probeHost = host === "0.0.0.0" ? "127.0.0.1" : host;
  const baseUrl = `http://${probeHost}:${port}`;

  try {
    const response = await fetch(`${baseUrl}/health`, {
      signal: AbortSignal.timeout(1200),
    });
    if (!response.ok) {
      return {
        running: false,
        host,
        port,
        url: `${baseUrl}/`,
      };
    }
    const payload = (await response.json()) as { ok?: unknown; service?: unknown };
    const healthy = payload?.ok === true && payload?.service === "cale-gateway";
    return {
      running: healthy,
      host,
      port,
      url: `${baseUrl}/`,
    };
  } catch {
    return {
      running: false,
      host,
      port,
      url: `${baseUrl}/`,
    };
  }
}

export function startGatewayServer(options?: { auto?: boolean }): StartGatewayResult {
  if (server && runtime) {
    return {
      started: true,
      alreadyRunning: true,
      message: `Gateway already running at ${server.url.toString()}`,
      status: getGatewayStatus(),
    };
  }

  const settings = getSettingsWithEnv();
  if (settings.gatewayEnabled === false) {
    return {
      started: false,
      alreadyRunning: false,
      message: "Gateway is disabled (gatewayEnabled=false).",
      status: getGatewayStatus(),
    };
  }
  if (options?.auto && settings.gatewayAutoStart === false) {
    return {
      started: false,
      alreadyRunning: false,
      message: "Gateway auto-start is disabled (gatewayAutoStart=false).",
      status: getGatewayStatus(),
    };
  }

  const host = normalizeGatewayHost(settings.gatewayBind);
  const port = settings.gatewayPort ?? 18889;

  try {
    server = Bun.serve({
      hostname: host,
      port,
      fetch: handleGatewayRequest,
    });
    runtime = {
      host,
      port,
      startedAt: Date.now(),
    };
    return {
      started: true,
      alreadyRunning: false,
      message: `Gateway started at ${server.url.toString()}`,
      status: getGatewayStatus(),
    };
  } catch (error) {
    server = null;
    runtime = null;
    return {
      started: false,
      alreadyRunning: false,
      message:
        error instanceof Error ? `Gateway failed to start: ${error.message}` : "Gateway failed to start.",
      status: getGatewayStatus(),
    };
  }
}

export function stopGatewayServer(): { stopped: boolean; message: string } {
  if (!server) {
    return { stopped: false, message: "Gateway is not running." };
  }
  server.stop(true);
  server = null;
  runtime = null;
  return { stopped: true, message: "Gateway stopped." };
}
