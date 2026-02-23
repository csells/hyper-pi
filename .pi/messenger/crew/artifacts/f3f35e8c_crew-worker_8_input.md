# Task for crew-worker

# Task Assignment

**Task ID:** task-9
**Task Title:** Add integration tests for reconnect and multi-agent scenarios
**PRD:** specs/review-full-synthesis.md


## Your Mission

Implement this task following the crew-worker protocol:
1. Join the mesh
2. Read task spec to understand requirements
3. Start task and reserve files
4. Implement the feature
5. Commit your changes
6. Release reservations and mark complete

## Dependency Status

Your task has dependencies on other tasks. Some may not be complete yet — this is expected. Use the coordination system to work through it.

- ○ task-5 (Fix hypivisor broadcast thread hang and FD leaks) — not yet started
- ○ task-6 (Fix hypivisor proxy: validate handshake, use node.machine, URL-decode token) — not yet started

**Working with pending dependencies:**
- Check if the dependency's output files exist. If yes, import and use them.
- If not, define what you need locally based on your task spec. Your spec describes the interfaces.
- DM in-progress workers for API details they're building.
- Reserve your files before editing to prevent conflicts.
- Do NOT block yourself because a dependency isn't done. Work around it.
- Log any local definitions in your progress for later reconciliation.

## Concurrent Tasks

These tasks are being worked on by other workers in this wave. Discover their agent names after joining the mesh via `pi_messenger({ action: "list" })`.

- task-1: Fix ghost nodes in useHypivisor.ts
- task-2: Fix useAgent.ts connection leaks and error handling
- task-3: Fix RemoteAgent event listener leak
- task-4: Fix rpc.ts pending requests leak and SpawnModal loop
- task-5: Fix hypivisor broadcast thread hang and FD leaks
- task-6: Fix hypivisor proxy: validate handshake, use node.machine, URL-decode token
- task-7: Fix pi-socket: truncation perf, async boundary, logger
- task-8: Fix hypivisor NodeStatus enum and deregister auth

## Task Specification

# Add integration tests for reconnect and multi-agent scenarios

## Problem
No integration tests for:
1. Hypivisor restart → Pi-DE reconnect → state is correct (the exact ghost node scenario)
2. Proxy returns error for offline/removed agent (not hang)
3. Rapid agent register/deregister cycles

## Files
- `integration-tests/src/reconnect.test.ts` (new)

## Changes
Add E2E integration tests (real hypivisor binary, no mocks):
1. Test: dashboard connects → hypivisor killed → hypivisor restarted → dashboard reconnects → init has correct nodes (NOT accumulated ghosts)
2. Test: agent registers then deregisters rapidly 5 times → roster stays clean
3. Test: proxy to non-existent nodeId returns error, not hang
4. Test: proxy to offline agent returns error
5. Test: 3 agents in same cwd register/deregister independently without interference

## Constraint
NEVER deduplicate by cwd in any test assertion. Multiple agents in same directory is first-class.


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

