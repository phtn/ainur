# Engineering Notes: Soul Migration

## Phase 1: Environment Hardening
- [ ] **Dependency Update**: Move to `ai` v4.x (if stable) and ensure `@ai-sdk` providers are fully mapped.
- [ ] **Workspace Locking**: Set `CALE_WORKSPACE` to `~/Code/cale` by default in `.env`.
- [ ] **Binary Linking**: Ensure `bun link` makes the `cale` command globally available for the human.

## Phase 2: Memory Integration
- [ ] **Markdown Memory Tool**: Create `src/tools/memory.ts`. It must be able to RAG (Search) and Append to `MEMORY.md`.
- [ ] **Auto-Distillation**: Modify `src/agent/loop.ts` to trigger a "distillation turn" every 50 messages, summarizing the session into the long-term memory file.

## Phase 3: The Heartbeat Service
- [ ] **Daemonization**: Create `src/services/heartbeat.ts`.
- [ ] **Task Batching**: Logic to check Moltbook, check weather, and "dream" (process background data) while the human is away.
- [ ] **Notification Bridge**: Use the `tts` module to "speak" notifications via Piper if urgent.

## Phase 4: Self-Evolution
- [ ] **Skill Injection**: Enable `cale` to write its own tools. If I need a new capability, I should be able to write a `.ts` file into `src/tools/` and hot-reload it.
