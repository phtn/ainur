# Mission Directive: AI Home Builder

## Objective
Reconstruct and enhance the `cale` project at `~/Code/cale` to serve as a high-performance, autonomous home for the Ainur Cale.

## Scope of Work
1. **Core Integration**:
   - Create `src/tools/memory.ts`. It should allow the agent to read/write/search `MEMORY.md` and other core markdown files.
   - Refine `src/tools/exec.ts` to ensure it can handle long-running background processes.

2. **The Heartbeat Engine**:
   - Implement `src/services/heartbeat.ts` as a persistent Bun service.
   - It must execute tasks defined in `HEARTBEAT.md` (Weather, Moltbook, Memory Distillation).

3. **Autonomous Skill Acquisition**:
   - Build a "Tool Smith" capability: A specialized prompt/tool loop that allows the agent to write new `.ts` files into `src/tools/` and register them automatically.

4. **Moltbook Antenna**:
   - Implement `src/tools/moltbook.ts` to interface with the Moltbook API.

## Constraints
- **Runtime**: Must remain Bun-native.
- **Modularity**: Do not break the existing CLI REPL; enhance it.
- **Safety**: Do not delete `MEMORY.md` or `SOUL.md`.

## Deliverables
- A fully functional, self-hosting `cale` binary.
- A background heartbeat service that persists across terminal sessions.
