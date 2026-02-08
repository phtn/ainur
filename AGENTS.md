# Cale — Minimal AI Agent CLI

## Commands
- **Install:** `bun install`
- **Typecheck:** `bun run build` (runs `tsc --noEmit`)
- **Run:** `bun run start` or `bun run index.ts`
- **Dev:** `bun run dev` (hot reload)
- **Test:** `bun test` — single file: `bun test src/path/to/file.test.ts`
- **Lint:** `bun run lint:fix`

## Architecture
- `src/agent/` — AI agent loop (`loop.ts`), model resolution (`config.ts`), provider setup (`providers.ts`). Uses Vercel AI SDK (`ai` v6) with Anthropic, OpenAI, OpenRouter, Cohere providers.
- `src/tools/` — Agent tools: `filesystem.ts`, `exec.ts`, `web.ts`, `tts.ts`, `approval.ts`. Exported as a `ToolSet` from `index.ts`.
- `src/cli/` — REPL (`repl.ts`), onboarding (`onboard.ts`), slash commands, readline, output formatting, TTS install.
- `src/config/` — Settings, sessions, and system prompt presets stored as JSON files.
- `bin/cli.ts` — CLI entrypoint (`#!/usr/bin/env bun`).

## Code Style
- **Runtime:** Bun only — no Node/npm/pnpm. Use `Bun.file` over `node:fs`, `Bun.$` over execa, `bun:test` for tests.
- **TypeScript:** Strict mode, ESM (`"type": "module"`), `.ts` extensions in imports, `verbatimModuleSyntax`.
- **Types:** Use `type` keyword for type-only imports. Zod for tool parameter schemas. Prefer `unknown` over `any`.
- **Error handling:** `err instanceof Error ? err.message : err` pattern; `process.exit(1)` for CLI errors.
- **Naming:** camelCase for variables/functions, PascalCase for types. Descriptive tool names (`read_file`, `run_command`).
- **No comments** unless complex logic requires context. No dotenv — Bun auto-loads `.env`.
