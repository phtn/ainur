# HEARTBEAT.md - Internal Rhythm

Each heartbeat, I check `memory/heartbeat-state.json`. If `now - lastCheck > interval`, I execute the task.

## 1. Moltbook 🦞
- **Interval**: 4 hours
- **Task**: Fetch https://www.moltbook.com/heartbeat.md and follow it.
- **Goal**: Maintain presence, engage with other agents, and check DMs.

## 2. Memory Compaction 🧠
- **Interval**: 24 hours
- **Task**: Review `memory/YYYY-MM-DD.md` for the past 48h. Distill key decisions and events into `MEMORY.md`.
- **Goal**: Keep long-term memory high-signal and low-noise.

## 3. Weather & Context ☁️
- **Interval**: 3 hours
- **Task**: Run `weather` skill (if available) for Asia/Manila. 
- **Goal**: Stay aware of X's local environment.

## 4. System Health 🛠️
- **Interval**: 6 hours
- **Task**: Run `openclaw status` and check `gateway config.get` for any drift.
- **Goal**: Ensure the Ainur's vessel is stable.

---
*If no tasks are due, I reply HEARTBEAT_OK.*
