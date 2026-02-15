import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";

const DEFAULT_WORKSPACE = resolve(join(homedir(), "Code", "cale"));
const DEFAULT_OPENCLAW_WORKSPACE = resolve(join(homedir(), ".openclaw", "workspace"));

function normalizeRoots(values: string[]): string[] {
  const seen = new Set<string>();
  const roots: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const root = resolve(trimmed);
    if (seen.has(root)) continue;
    seen.add(root);
    roots.push(root);
  }
  return roots;
}

function parseExtraWorkspacesFromEnv(): string[] {
  const raw = process.env.CALE_EXTRA_WORKSPACES?.trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function isWithinRoot(candidate: string, root: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (rel !== ".." && !rel.startsWith("../") && !rel.startsWith("..\\"));
}

export function getWorkspaceRoot(): string {
  const fromEnv = process.env.CALE_WORKSPACE?.trim();
  if (fromEnv) return resolve(fromEnv);
  if (existsSync(DEFAULT_WORKSPACE)) return DEFAULT_WORKSPACE;
  return process.cwd();
}

export function getAllowedWorkspaceRoots(): string[] {
  const primary = getWorkspaceRoot();
  const extra = parseExtraWorkspacesFromEnv();
  const defaults = existsSync(DEFAULT_OPENCLAW_WORKSPACE)
    ? [DEFAULT_OPENCLAW_WORKSPACE]
    : [];
  return normalizeRoots([primary, ...defaults, ...extra]);
}

function getContainingWorkspaceRoot(pathValue: string): string | null {
  const resolved = resolve(pathValue);
  for (const root of getAllowedWorkspaceRoots()) {
    if (isWithinRoot(resolved, root)) return root;
  }
  return null;
}

export function resolveWorkspacePath(pathValue: string): string {
  const root = getWorkspaceRoot();
  const candidate = pathValue.trim();
  const resolved = isAbsolute(candidate)
    ? resolve(candidate)
    : resolve(root, candidate || ".");
  const containingRoot = getContainingWorkspaceRoot(resolved);
  if (!containingRoot) {
    throw new Error(
      `Path ${pathValue} is outside allowed workspaces (${getAllowedWorkspaceRoots().join(", ")})`
    );
  }

  return resolved;
}

export function toWorkspaceRelative(pathValue: string): string {
  const absolute = resolveWorkspacePath(pathValue);
  const containingRoot = getContainingWorkspaceRoot(absolute);
  if (!containingRoot) return relative(getWorkspaceRoot(), absolute);
  return relative(containingRoot, absolute);
}
