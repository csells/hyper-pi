# Task for crew-planner

Create a task breakdown for implementing this request.

## Request

Increase test coverage to 80% across hyper-pi with a focus on E2E integration tests. The key new tests needed:

1. **Live pi agent lifecycle tests** - Spin up REAL pi agents (using `pi` CLI) in temp directories, verify they register with hypivisor, appear in the roster, and cleanly deregister on shutdown. Test that multiple agents in the same directory both appear.

2. **Message round-trip tests (Web → TUI → Web)** - Send a message to a pi agent through the hypivisor proxy WebSocket, verify the agent receives it, and verify any response events flow back through the proxy to the dashboard WebSocket.

3. **Pi-DE browser rendering tests** - Using the `surf` CLI tool, verify that Pi-DE actually renders agents in the roster, that clicking an agent shows the chat stage, and that sending a message from Pi-DE shows up.

4. **TUI interaction tests** - Using tmux + sendkeys to interact with pi's terminal UI, send messages and verify they flow through pi-socket to connected WebSocket clients.

5. **Cross-channel message visibility** - Send from web, verify in TUI output; send from TUI, verify in web WebSocket events.

6. **Component unit test gaps** - Fill coverage gaps in pi-de (SpawnModal, initStorage, patchLit), pi-socket (index.ts main extension), and hypivisor (spawn.rs, fs_browser.rs).

Current state: 34 pi-de tests, 27 pi-socket tests, 26 hypivisor tests, 28 integration tests = 115 total tests. Need to reach ~80% line coverage.

Key constraints:
- pi-socket is a global extension at ~/.pi/agent/extensions/pi-socket/
- Tests must be deterministic and run in CI (no manual setup)
- Use tmux for long-lived processes (pi agents, dev servers)
- Use surf for browser testing
- Multiple agents per directory is FIRST-CLASS
- Never modify pi itself

## Previous Planning Context
# Planning Progress

## Notes
<!-- User notes here are read by the planner on every run.
     Add steering like "ignore auth" or "prioritize performance". -->


---
[2026-02-23T14:07:42.902Z] Re-plan: Implement ALL waves (1-5) from the synthesis in parallel. Each task should be independently executable. Group by file to avoid conflicts. Key files: pi-de/src/useHypivisor.ts, pi-de/src/useAgent.ts, pi-de/src/RemoteAgent.ts, pi-de/src/rpc.ts, pi-de/src/SpawnModal.tsx, pi-socket/src/history.ts, pi-socket/src/safety.ts, hypivisor/src/main.rs, hypivisor/src/state.rs, hypivisor/src/auth.rs. Each task MUST include tests. The multi-agent-per-directory constraint is sacred: NEVER deduplicate by cwd. Read AGENTS.md before implementing anything.

## Run: 2026-02-23T14:07:42.902Z — specs/review-full-synthesis.md

### Pass 1 (14:11)
---

**Parallelism summary:** The 8 tasks form 3 independent work streams that can execute concurrently:

- **Stream A (Pi-DE frontend):** Task 1 + Task 2 + Task 4 → Task 3 → (done)
- **Stream B (Hypivisor Rust):** Task 5 + Task 6 → Task 8
- **Stream C (pi-socket TypeScript):** Task 7

Wave 1 (all independent): Tasks 1, 2, 4, 5, 6, 7
Wave 2 (after deps): Task 3 (needs Task 2), Task 8 (needs Tasks 5+6)

Critical path length: **2 waves** — nearly all work happens in wave 1.


You must follow this sequence strictly:
1) Understand the request
2) Review relevant code/docs/reference resources
3) Produce sequential implementation steps
4) Produce a parallel task graph

Return output in this exact section order and headings:
## 1. PRD Understanding Summary
## 2. Relevant Code/Docs/Resources Reviewed
## 3. Sequential Implementation Steps
## 4. Parallelized Task Graph

In section 4, include both:
- markdown task breakdown
- a `tasks-json` fenced block with task objects containing title, description, and dependsOn.