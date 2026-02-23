# Task for crew-planner

Create a task breakdown for implementing this PRD.

## PRD: specs/review-full-synthesis.md

# Full Project Review Synthesis

Three independent reviewers (Claude Opus 4.6, GPT-5.3 Codex, Gemini 2.5 Pro) reviewed the entire hyper-pi codebase. This document consolidates their findings.

**Total issues:** Claude 30, Codex 24, Gemini 34

## Multi-Agent Constraint Compliance
**All three reviewers confirm PASS.** No code anywhere deduplicates, evicts, or collapses agents by `cwd`. The `machine:port` constraint is properly enforced.

---

## Consensus Issues (2+ reviewers agree)

### P0: Ghost Nodes in Pi-DE — THE Root Cause

**Gemini's key insight (confirmed by Codex):** When the hypivisor restarts, Pi-DE reconnects and receives BOTH:
1. An `init` snapshot (e.g., 2 nodes) via `setNodes(data.nodes)` — correct full replace
2. `node_joined` broadcasts as agents re-register with NEW session IDs

Since `node_joined` filters by `n.id !== data.node.id`, and the new session IDs differ from the old init state, entries accumulate. Each reconnect cycle adds more ghosts (2 → 4 → 8).

**Contributing factor (Codex P0-1):** `useHypivisor`'s `connect()` nulls `ws.onclose` on the old WS but NOT `ws.onmessage`. The old WS can still dispatch events after the new one is created.

**Fix (Gemini):** Gate incremental events behind `init` reception:
```typescript
let initReceived = false;
ws.onopen = () => { initReceived = false; };
// In handleEvent:
if (data.event === "init") { setNodes(data.nodes); initReceived = true; }
else if (initReceived) { /* process node_joined etc. */ }
```
**Plus (Codex):** Null `ws.onmessage` before closing old WS in `connect()`.

### P0: "Connecting..." Hang on Agent Select

**All three agree on two causes:**
1. Proxy doesn't validate the 101 handshake response — a failed handshake enters the relay loop but never sends data
2. Pi-DE ignores proxy error JSON (`{"error": "Agent not found"}`) — `useAgent.onmessage` only checks for `init_state`, so the error is silently dropped and status stays "connecting" forever

**Fix:** Validate 101 in proxy + handle error JSON in `useAgent.ts`.

### P0: Connection Leak in `useAgent` Reconnect

**All three flag:** The inner `connect()` function creates a new WebSocket without closing the previous one. `wsRef.current` gets overwritten, orphaning the old WS.

**Fix:** Close `wsRef.current` before creating new WS in `connect()`.

### P0: Hypivisor Broadcast Thread Leak

**Codex P0-4 + Gemini C7:** `rx.recv().await` blocks forever when no broadcasts arrive. `broadcast_handle.join()` hangs after dashboard disconnect. Each disconnection during idle leaks a thread permanently. The `lsof` output showed 63 FDs for 22 connections — 3x amplification from `try_clone()`.

**Fix:** Drop the broadcast receiver or shutdown the stream to unblock the join.

### P0: RemoteAgent Event Listener Leak

**Codex P0-2 + Gemini:** `RemoteAgent.connect()` uses `addEventListener` but never calls `removeEventListener` in `disconnect()`. Each reconnect adds another listener.

**Fix:** Track the listener reference and remove it in `disconnect()`.

### P1: Proxy Hardcodes 127.0.0.1

**All three flag.** The proxy ignores `node.machine` and always connects to localhost. Breaks multi-machine deployments (R-CC-5/6/7).

### P1: Double Message Parsing

**Codex P0-3 + Gemini C4:** `useAgent.ts` sets BOTH `remoteAgent.connect(ws)` (which adds `addEventListener("message")`) AND `ws.onmessage`. Every message is parsed twice.

**Fix:** Remove `ws.onmessage` from `useAgent` — let RemoteAgent be the single message handler. Expose truncation info from RemoteAgent.

### P1: O(n²) or O(n³) Truncation

**All three flag.** `buildInitState` re-serializes the entire array on each `shift()` call. Claude calls it O(n³), others O(n²). Either way it blocks the Node event loop.

**Fix:** Single-pass size estimation with `Math.floor(MAX_INIT_BYTES / avgMsgSize)`.

### P1: SpawnModal Infinite Re-fetch

**Claude H-6 + Codex P2-1 + Gemini H8:** `loadDirs` depends on `currentPath` but also sets `currentPath` from the server response.

### P1: `pendingRequests` Not Cleared on WS Close

**Codex P1-8 + Gemini H7:** In-flight RPC promises linger up to 30s after WS closes.

### P1: `NodeInfo.status` Should Be Enum

**Claude M-1 + Gemini M8:** String status allows typo bugs that compile silently.

### P1: Proxy Handshake Response Not Validated

**All three flag.** The proxy reads the HTTP response and ignores it entirely.

---

## Unique Insights

### Gemini Only
- **boundary() doesn't handle async functions** — Promise rejections bypass the catch, crashing the pi process
- **100ms read timeouts cause busy-wait** — Each WS connection wakes 10x/second doing nothing. 100 agents = 1000 wakeups/sec
- **`useAgent` deps include `activeNode?.status`** — causes unnecessary reconnections when status toggles

### Codex Only
- **`useHypivisor` hardcodes `ws://localhost`** — won't work when Pi-DE is served remotely (but `useAgent` correctly uses `window.location.hostname`)
- **Token not URL-decoded** in `auth.rs` — fails with special characters. pi-socket uses `encodeURIComponent` but hypivisor compares raw
- **Binary frame proxy writes raw bytes without framing** — corrupts the WebSocket stream

### Claude Only
- **`deregister` RPC has no authorization** — any client can remove any node from the registry
- **`safeSerialize` swallows failures without logging** — hardening system can never detect this class of error
- **Synchronous `fs.appendFileSync` in logger** — blocks Node event loop on every log write

---

## Prioritized Fix Plan

### Wave 1: Fix the Ghost Nodes + Connecting (Pi-DE crisis)
1. `useHypivisor.ts` — Gate incremental events behind `initReceived` flag
2. `useHypivisor.ts` — Null `ws.onmessage` before closing old WS in `connect()`
3. `useAgent.ts` — Close old WS before creating new in inner `connect()`
4. `useAgent.ts` — Handle proxy error JSON messages (`{"error": ...}`)
5. `useAgent.ts` — Remove duplicate `ws.onmessage`; let RemoteAgent handle all events
6. `RemoteAgent.ts` — Track listener reference, remove in `disconnect()`

### Wave 2: Fix the Hypivisor Leaks
7. `main.rs` — Fix broadcast thread hang: drop rx or shutdown stream on disconnect
8. `main.rs` — Validate 101 in proxy handshake response
9. `main.rs` — Increase read timeout from 100ms to 1-5s to stop busy-wait
10. `rpc.ts` — Add `rejectAllPending()` called from `onclose`

### Wave 3: Correctness
11. `main.rs` — Use `node.machine` instead of `127.0.0.1` in proxy
12. `history.ts` — Single-pass truncation estimator
13. `safety.ts` — Handle async rejections in `boundary()`
14. `SpawnModal.tsx` — Fix `currentPath`/`loadDirs` dependency loop
15. `state.rs` — `NodeStatus` enum instead of String
16. `auth.rs` — URL-decode token before comparison

### Wave 4: Tests
17. Integration test: hypivisor restart → Pi-DE reconnect → correct state
18. Unit test: RemoteAgent disconnect/connect listener cleanup
19. Unit test: useHypivisor reconnect with initReceived gate
20. Unit test: truncation path with >500KB payload
21. Unit test: proxy error handling in useAgent

### Wave 5: Hardening
22. `useHypivisor.ts` — Use `window.location.hostname` instead of `localhost`
23. `rpc.rs` — Authorize deregister (verify caller owns node)
24. `main.rs` — Bound read buffer size
25. `log.ts` — Async buffered writes
26. `main.rs` — Decompose into ws.rs, proxy.rs, registry.rs


You must follow this sequence strictly:
1) Understand the PRD
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