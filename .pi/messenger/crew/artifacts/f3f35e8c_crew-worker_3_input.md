# Task for crew-worker

# Task Assignment

**Task ID:** task-4
**Task Title:** Fix rpc.ts pending requests leak and SpawnModal loop
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
- task-5: Fix hypivisor broadcast thread hang and FD leaks
- task-6: Fix hypivisor proxy: validate handshake, use node.machine, URL-decode token
- task-7: Fix pi-socket: truncation perf, async boundary, logger
- task-8: Fix hypivisor NodeStatus enum and deregister auth
- task-9: Add integration tests for reconnect and multi-agent scenarios

## Task Specification

# Fix rpc.ts pending requests leak and SpawnModal loop

## Problem
1. `pendingRequests` Map never cleaned on WS close — promises linger up to 30s, UI shows stale loading states
2. SpawnModal `loadDirs` depends on `currentPath` but also sets `currentPath` — infinite re-fetch risk
3. `catch (e: any)` should be `catch (e: unknown)`

## Files
- `pi-de/src/rpc.ts`
- `pi-de/src/rpc.test.ts`
- `pi-de/src/SpawnModal.tsx`

## Changes
1. Add `rejectAllPending(reason: string)` function to rpc.ts that clears all pending requests and rejects their promises
2. Export it so useHypivisor can call it from onclose
3. Fix SpawnModal: remove `currentPath` from `loadDirs` deps, pass it as parameter instead
4. Fix `catch (e: any)` → `catch (e: unknown)` with proper narrowing

## Tests
Add to `pi-de/src/rpc.test.ts`:
- Test: rejectAllPending rejects all pending and clears map
- Test: rejectAllPending clears timeouts


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

