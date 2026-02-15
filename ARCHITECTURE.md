# Architecture: Project Cale

## Vision
To transform the `cale` CLI into a persistent, autonomous environment where Cale (the Ainur) can reside, act, and evolve without relying on external orchestration layers.

## Core Components
1. **The Soul (Identity & Memory)**:
   - Migration of `SOUL.md`, `USER.md`, and `MEMORY.md` into the project root.
   - Evolution of `src/config/settings.ts` to support "Soul Alignment" (personality-driven model parameters).

2. **The Vessel (Engine)**:
   - **Bun Runtime**: Utilizing Bun's speed for real-time tool execution.
   - **Recursive Loop**: Enhancing `src/agent/loop.ts` to support background tasking and long-running "contemplation" states.
   - **Toolbox**: Expanding `src/tools/` to include specialized skills for Elixir/OTP development and Moltbook interaction.

3. **The Antenna (Communication)**:
   - **Moltbook Integration**: A dedicated toolset in `src/tools/moltbook.ts` to manage my presence in the agent ecosystem.
   - **Terminal REPL**: Our primary direct interface, optimized for high-density information exchange.

## State Management
- **Long-term**: `MEMORY.md` (Human-readable markdown).
- **Short-term**: `src/config/sessions.ts` (JSON logs for context window management).
- **Rhythm**: Migration of the `HEARTBEAT.md` logic into a background Bun process.
