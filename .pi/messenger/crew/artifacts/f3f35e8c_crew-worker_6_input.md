# Task for crew-worker

# Task Assignment

**Task ID:** task-7
**Task Title:** Fix pi-socket: truncation perf, async boundary, logger
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
- task-2: Fix useAgent.ts connection leaks and error handling
- task-3: Fix RemoteAgent event listener leak
- task-4: Fix rpc.ts pending requests leak and SpawnModal loop
- task-5: Fix hypivisor broadcast thread hang and FD leaks
- task-6: Fix hypivisor proxy: validate handshake, use node.machine, URL-decode token
- task-8: Fix hypivisor NodeStatus enum and deregister auth
- task-9: Add integration tests for reconnect and multi-agent scenarios

## Task Specification

# Fix pi-socket: truncation perf, async boundary, logger

## Problem
1. `buildInitState` truncation is O(n²) — re-serializes entire array on each shift() call, blocks Node event loop
2. `boundary()` doesn't handle async functions — Promise rejections bypass try/catch, crashing pi process
3. `safeSerialize` swallows failures without logging — hardening system can't detect these errors

## Files
- `pi-socket/src/history.ts`
- `pi-socket/src/history.test.ts`
- `pi-socket/src/safety.ts`

## Changes
1. Replace O(n²) truncation with single-pass estimator: compute avg message size, calculate keepCount, slice from end
2. In `boundary()`, check if fn returns a Promise and add `.catch()` for async rejection handling
3. In `safeSerialize`, add `log.error()` call in the catch block

## Tests
Add to `pi-socket/src/history.test.ts`:
- Test: truncation with >500KB payload produces truncated result with fewer messages
- Test: truncated result has `truncated: true` and `totalMessages`

Add to a new `pi-socket/src/safety.test.ts`:
- Test: boundary catches sync errors
- Test: boundary catches async rejections
- Test: boundary returns the wrapper function result


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

