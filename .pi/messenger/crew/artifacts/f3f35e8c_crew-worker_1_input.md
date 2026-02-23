# Task for crew-worker

# Task Assignment

**Task ID:** task-2
**Task Title:** Fix useAgent.ts connection leaks and error handling
**PRD:** specs/review-full-synthesis.md


## Your Mission

Implement this task following the crew-worker protocol:
1. Join the mesh
2. Read task spec to understand requirements
3. Start task and reserve files
4. Implement the feature
5. Commit your changes
6. Release reservations and mark complete

## Concurrent Tasks

These tasks are being worked on by other workers in this wave. Discover their agent names after joining the mesh via `pi_messenger({ action: "list" })`.

- task-1: Fix ghost nodes in useHypivisor.ts
- task-3: Fix RemoteAgent event listener leak
- task-4: Fix rpc.ts pending requests leak and SpawnModal loop
- task-5: Fix hypivisor broadcast thread hang and FD leaks
- task-6: Fix hypivisor proxy: validate handshake, use node.machine, URL-decode token
- task-7: Fix pi-socket: truncation perf, async boundary, logger
- task-8: Fix hypivisor NodeStatus enum and deregister auth
- task-9: Add integration tests for reconnect and multi-agent scenarios

## Task Specification

# Fix useAgent.ts connection leaks and error handling

## Problem
1. Inner `connect()` creates new WebSocket without closing previous one — leaks connections
2. `ws.onmessage` only checks for `init_state` — silently ignores proxy error JSON (`{"error": "Agent not found"}`)
3. Double message parsing: both `remoteAgent.connect(ws)` (addEventListener) AND `ws.onmessage` process messages

## Files
- `pi-de/src/useAgent.ts`

## Changes
1. In inner `connect()`, close `wsRef.current` before creating new WS (null onclose first to prevent recursive reconnect)
2. Handle proxy error messages in onmessage: if `data.error`, set status to "disconnected" or "offline" and close WS
3. Remove the duplicate `ws.onmessage` handler — let RemoteAgent be the single message handler. Have RemoteAgent expose truncation info via a callback or state.
4. Remove `activeNode?.status` from effect deps (Gemini H1) — handle offline via App.tsx sync effect

## Tests
Add tests in `pi-de/src/useAgent.test.ts`:
- Test: reconnect closes previous WebSocket
- Test: proxy error message sets status to disconnected
- Test: no duplicate message parsing


## Plan Context

---

**Parallelism summary:** The 8 tasks form 3 independent work streams that can execute concurrently:

- **Stream A (Pi-DE frontend):** Task 1 + Task 2 + Task 4 → Task 3 → (done)
- **Stream B (Hypivisor Rust):** Task 5 + Task 6 → Task 8
- **Stream C (pi-socket TypeScript):** Task 7

Wave 1 (all independent): Tasks 1, 2, 4, 5, 6, 7
Wave 2 (after deps): Task 3 (needs Task 2), Task 8 (needs Tasks 5+6)

Critical path length: **2 waves** — nearly all work happens in wave 1.
## Coordination

**Message budget: 10 messages this session.** The system enforces this — sends are rejected after the limit.

**Broadcasts go to the team feed — only the user sees them live.** Other workers see your broadcasts in their initial context only. Use DMs for time-sensitive peer coordination.

### Announce yourself
After joining the mesh and starting your task, announce what you're working on:

```typescript
pi_messenger({ action: "broadcast", message: "Starting <task-id> (<title>) — will create <files>" })
```

### Coordinate with peers
If a concurrent task involves files or interfaces related to yours, send a brief DM. Only message when there's a concrete coordination need — shared files, interfaces, or blocking questions.

```typescript
pi_messenger({ action: "send", to: "<peer-name>", message: "I'm exporting FormatOptions from types.ts — will you need it?" })
```

### Responding to messages
If a peer asks you a direct question, reply briefly. Ignore messages that don't require a response. Do NOT start casual conversations.

### On completion
Announce what you built:

```typescript
pi_messenger({ action: "broadcast", message: "Completed <task-id>: <file> exports <symbols>" })
```

### Reservations
Before editing files, check if another worker has reserved them via `pi_messenger({ action: "list" })`. If a file you need is reserved, message the owner to coordinate. Do NOT edit reserved files without coordinating first.

### Questions about dependencies
If your task depends on a completed task and something about its implementation is unclear, read the code and the task's progress log at `.pi/messenger/crew/tasks/<task-id>.progress.md`. Dependency authors are from previous waves and are no longer in the mesh.

### Claim next task
After completing your assigned task, check if there are ready tasks you can pick up:

```typescript
pi_messenger({ action: "task.ready" })
```

If a task is ready, claim and implement it. If `task.start` fails (another worker claimed it first), check for other ready tasks. Only claim if your current task completed cleanly and quickly.

