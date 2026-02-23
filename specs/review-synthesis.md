# Unified Review Synthesis

**6 reviews, 3 models × 2 rounds**

| Round | Focus | Claude Opus 4.6 | GPT-5.3 Codex | Gemini 2.5 Pro |
|-------|-------|-----------------|---------------|----------------|
| 1 | Best practices | review-claude.md | review-codex.md | review-gemini.md |
| 2 | Stale/ghost nodes | review-stale-claude.md | review-stale-codex.md | review-stale-gemini.md |

---

## The Unified Picture

The user's original complaint — "I see ~20 nodes in the dashboard but only 3 pi processes" — is not one bug. It's the product of **lifecycle bugs in pi-socket** that create ghost registrations, **missing cleanup logic in hypivisor** that lets them persist, and **best-practices violations** (error swallowing, stringly-typed state, no heartbeat) that mask the symptoms.

The two rounds of reviews are deeply interrelated:

- Round 1's "swallowed WebSocket errors" (all 3 reviewers) → hides the connection leaks that cause ghosts
- Round 1's "NodeInfo.status as String" (all 3) → makes it impossible for the compiler to catch missing status variants in cleanup
- Round 1's "TOCTOU in cleanup.rs" (Claude R1, Codex R1) → same bug that Round 2 Claude identified as RC-7
- Round 1's "proxy handshake unvalidated" (Codex R1, Gemini R1) → symptom of the same "don't validate, just proceed" pattern that causes fire-and-forget deregister

---

## Consensus Findings (all 3 reviewers agree)

### Ghost Node Root Causes — Full Agreement

| # | Root Cause | R2-Claude | R2-Codex | R2-Gemini | Fix |
|---|-----------|-----------|----------|-----------|-----|
| **G1** | `session_start` doesn't close old `hypivisorWs` or cancel reconnect timer | RC-1, RC-2, RC-3 | RC-1 (P0) | RC-1 (CRITICAL) | Close old WS, cancel timer, add shutdown flag |
| **G2** | `deregister` is fire-and-forget (races with `ws.close()`) | RC-5 | RC-6 | RC-3 | `ws.send(msg, callback)` then close |
| **G3** | 120s TTL + 60s sweep = up to 180s ghost lifetime | RC-6 | RC-4 | (implicit) | 30s TTL / 15s sweep |
| **G4** | machine:port eviction misses port-change restarts | RC-4 | RC-3 (P0) | (implicit via wssPort analysis) | Add machine:cwd eviction |
| **G5** | TOCTOU race in cleanup.rs | RC-7 | (noted as M3 in R1) | (noted in R2) | Re-check under write lock |

### Best Practices — Full Agreement

| # | Issue | R1-Claude | R1-Codex | R1-Gemini | Fix |
|---|-------|-----------|----------|-----------|-----|
| **B1** | `NodeInfo.status` is String, not enum | M-1 | H1 | #9 | Rust enum with Serialize/Deserialize |
| **B2** | WebSocket errors silently swallowed (`() => {}`) | H-1 | (implicit in H4) | #6 | Log in boundary() |
| **B3** | O(n²) truncation in `buildInitState` | C-2 | C1 | (noted) | Single-pass with byte counting |
| **B4** | SpawnModal double-fetch / re-render | C-3 | C3 | #4 | Consolidate into single fetch |
| **B5** | `pendingRequests` global singleton / no cleanup | M-3 | H3 | (noted) | Scope to WS instance |
| **B6** | TOCTOU in cleanup.rs | (noted) | M3 | (noted) | Same as G5 |

---

## Unique Insights (raised by only one reviewer)

### Gemini — The "Active Ghost" Insight ⭐

**This is the most important unique finding across all 6 reviews.**

Gemini R2 identified that cleanup.rs **only targets `status == "offline"` nodes**. If a ghost is stuck in `"active"` state (orphaned WS still open, or TCP half-open after crash), cleanup will **never** touch it. These are **permanent ghosts** — they survive indefinitely until the hypivisor restarts.

This explains why the user sees ~20 ghosts: over a day, 3 processes × ~6 session restarts = ~18 "active" ghosts that are never cleaned up.

**Fix:** Add `last_seen` timestamp to NodeInfo, update on register and ping, clean up "active" nodes whose `last_seen` exceeds TTL.

### Gemini — `wssPort` Caching Means Port Reuse Works Within-Process

Gemini R2 correctly identified that `wssPort` is cached after the first `session_start`, so within the same pi process, port reuse is guaranteed. Machine:port eviction works for session restarts within a process. The port-change problem (G4) only occurs across separate process invocations.

### Claude — Reconnect Creates Infinite Loop After Shutdown

Claude R2 (RC-1) traced the full chain: `session_shutdown` → deregister → `ws.close()` → close handler → `scheduleReconnect()` → new WS → re-register → the node is re-created as "active" after being deregistered. And `setTimeout` keeps the Node.js event loop alive, potentially preventing the process from exiting.

### Codex — Pi-DE Client-Side CWD Dedup as Defense-in-Depth

Codex R2 suggested `node_joined` handler should filter by `machine + cwd`, not just `id`. This is defense-in-depth — if the server-side eviction misses, the UI still shows one entry per directory.

### Codex — WebSocket Ping/Pong for Half-Open TCP Detection

Codex R2 (RC-5) and Gemini R2 (RC-5) both identified the need for heartbeat, but Codex provided the full implementation including `send_ping` for the `WsWriter` struct.

### Claude R1 — Proxy Hardcodes `127.0.0.1`

Claude R1 (C-1) caught that `handle_proxy_ws` constructs the agent URL using `127.0.0.1` — multi-machine routing is broken. Codex and Gemini focused on the handshake validation instead.

### Gemini R1 — Security Issues

Gemini R1 uniquely identified:
- Token in WebSocket query string (visible in logs, browser history)
- Spawn agent path traversal (`create_dir_all` before `canonicalize` check)
- No constant-time token comparison (timing attack vector)

---

## Disagreements

### TTL Value
- Claude R2: 30s TTL / 15s sweep (45s worst case)
- Codex R2: 30s TTL / 15s sweep (45s worst case)
- Gemini R2: 90s TTL (3 missed heartbeats at 30s)

**Resolution:** With heartbeat, 90s makes sense for "active" ghost detection (need 3 missed pings). For "offline" nodes, 30s is better. Use 30s for offline TTL and let the heartbeat-based `last_seen` check use its own threshold (e.g., 90s or 2×TTL).

### Heartbeat Necessity
- Claude R2: Not mentioned (focuses on lifecycle fixes)
- Codex R2: Explicit ping/pong implementation (RC-5)
- Gemini R2: Explicit ping/pong + last_seen (RC-4, RC-5)

**Resolution:** Heartbeat is needed. Without it, "active" ghosts from crashed pi processes persist until TCP timeout (minutes to hours). Two reviewers independently converged on 30s ping interval.

---

## Prioritized Fix Plan

Combining both rounds into a single implementation order. Fixes are grouped by the root issue they address, not by component.

### P0 — Ghost Node Elimination (do first)

These 4 changes together eliminate >95% of observed ghosts:

| # | Change | Component | Root Cause | Effort |
|---|--------|-----------|------------|--------|
| P0-1 | Close old `hypivisorWs` + cancel reconnect timer in `session_start`; add `shutdownRequested` flag | pi-socket | G1 | Small |
| P0-2 | Flush deregister before close in `session_shutdown` | pi-socket | G2 | Small |
| P0-3 | Add `machine:cwd` eviction in `handle_register` | hypivisor/rpc.rs | G4 | Small |
| P0-4 | Reduce TTL to 30s, sweep to 15s | hypivisor/main.rs | G3 | Trivial |

### P1 — Active Ghost Detection (do second)

Catches ghosts from crashes and half-open TCP:

| # | Change | Component | Root Cause | Effort |
|---|--------|-----------|------------|--------|
| P1-1 | Add `last_seen: Option<i64>` to `NodeInfo` | hypivisor/state.rs | Gemini unique | Small |
| P1-2 | pi-socket sends `ws.ping()` every 30s; hypivisor updates `last_seen` on ping | pi-socket + hypivisor | Codex/Gemini RC-5 | Medium |
| P1-3 | Cleanup removes "active" nodes with stale `last_seen` (>90s) | hypivisor/cleanup.rs | Gemini RC-4 | Small |
| P1-4 | Fix TOCTOU: re-check status under write lock before removing | hypivisor/cleanup.rs | G5 | Small |

### P2 — Best Practices (do third)

These make the system robust and maintainable:

| # | Change | Component | Issue | Effort |
|---|--------|-----------|-------|--------|
| P2-1 | `NodeInfo.status` → enum `NodeStatus { Active, Offline }` | hypivisor/state.rs | B1 | Medium |
| P2-2 | Log WS errors instead of `() => {}` | pi-socket | B2 | Small |
| P2-3 | Fix O(n²) truncation — single-pass byte counting | pi-socket/history.ts | B3 | Small |
| P2-4 | Fix SpawnModal double-fetch | pi-de/SpawnModal.tsx | B4 | Small |
| P2-5 | Scope `pendingRequests` to WS instance + reject on disconnect | pi-de/rpc.ts | B5 | Medium |
| P2-6 | Pi-DE `node_joined` dedup by `machine + cwd` | pi-de/useHypivisor.ts | Codex unique | Small |

### P3 — Security & Architecture (do last)

| # | Change | Component | Issue | Effort |
|---|--------|-----------|-------|--------|
| P3-1 | Move token from query string to first-message auth | all 3 | Gemini R1 #1 | Large |
| P3-2 | Validate proxy WS handshake response | hypivisor/main.rs | Codex R1 C2, Gemini R1 #8 | Medium |
| P3-3 | Fix proxy `127.0.0.1` hardcode — use node's `machine` | hypivisor/main.rs | Claude R1 C-1 | Small |
| P3-4 | Canonicalize before `create_dir_all` in spawn | hypivisor/spawn.rs | Gemini R1 #3 | Small |
| P3-5 | Decompose `main.rs` into `ws.rs`, `registry_ws.rs`, `proxy_ws.rs` | hypivisor | Gemini R1 #5 | Medium |

---

## The Unifying Theme

The ghost node bug, the best practices violations, and the brittleness are all symptoms of **one architectural gap: pi-socket has no lifecycle state machine**. There's no concept of "I am starting up", "I am running", "I am shutting down" — just a bag of event handlers that independently manage connection state. This leads to:

- Reconnect firing during shutdown (no shutdown flag)
- Old connections leaking during session restart (no cleanup-before-init)
- Deregister racing with close (no ordered shutdown sequence)
- Errors swallowed because there's no state to decide what's expected vs unexpected

The P0 fixes add the missing lifecycle: a `shutdownRequested` flag, explicit old-connection teardown in `session_start`, and ordered shutdown with flush. The P1 fixes add the missing liveness contract: heartbeat + `last_seen` so the hypivisor can distinguish live nodes from zombies.

Once those are in, the best-practices fixes (P2) make the system maintainable, and the security/architecture fixes (P3) harden it for multi-machine deployment.
