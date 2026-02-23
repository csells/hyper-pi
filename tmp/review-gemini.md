Review written to `/Users/csells/Code/csells/hyper-pi/tmp/review-gemini.md`.

## Summary

**Delta from previous review:** Of the 23 issues Claude identified, **2 were fixed** (M-5 useHypivisor reconnect leak, partially H-1), **20 remain open**, and **1 was partially addressed** (L-6 stale docs). The 5 new commits primarily addressed **new bugs** not in the original review (ghost registrations, machine:cwd eviction, WebSocket leak).

**6 new issues found:**
- **N-6 (High):** Proxy `agent_to_dash` thread leaks indefinitely when dashboard disconnects while agent is idle
- **N-3 (Medium):** In-flight reconnect not cancelled by `teardownHypivisor()`
- **N-4 (Medium):** `RemoteAgent.connect()` doesn't clean up old message listener
- **N-1 (Low):** TOCTOU race in cleanup with stale timestamp
- **N-2 (Low):** Hardcoded 30s heartbeat vs configurable TTL
- **N-8 (Low):** Protocol type mismatch TS vs Rust

**Top 3 priorities:**
1. **C-1:** Proxy hardcodes `127.0.0.1` — 5-line fix that unblocks multi-machine
2. **C-2 + M-2:** O(n²) truncation + missing test — replace with estimate-and-slice
3. **N-6:** Proxy thread leak — shut down agent stream on dashboard disconnect
t's **tolerable** but the double-fetch still occurs on first open and every navigation where canonical differs from input. |
| H-1 | WebSocket errors silently swallowed | **Partially fixed** | The `ws.on("error", () => {})` pattern remains on both client WebSocket and `wss`. The `wss.on("error", () => {})` at line ~93 of `index.ts` still swallows errors. The client-side `ws.on("error")` in the `wss.on("connection")` handler at line ~90 is also still empty. |
| M-5 | `useHypivisor` reconnect timer can fire multiple times | **Fixed** | The `useHypivisor` hook now uses a `disposed` flag and explicitly sets `ws.onclose = null` before closing in the cleanup function. The `connect()` function also closes the previous WebSocket before creating a new one. |
| L-6 | pi-socket/AGENTS.md event catalog is stale | **Partially fixed** | The AGENTS.md still lists the old decomposed event names (`delta`, `thinking_delta`, `toolcall_start`, etc.) as the event catalog, but the code now forwards native pi events directly. The catalog describes the *logical* events the client will see, not the wire format. This is confusing but not blocking. |
| M-6 | `useAgent` double-parses every WebSocket message | **Still present** | Both `useAgent`'s `ws.onmessage` (checking for `init_state` to set `historyTruncated`) and `RemoteAgent.connect(ws)` (adding its own `addEventListener("message", ...)`) parse every message. During LLM streaming, every `message_update` is parsed twice. |

### Fixed by the 5 new commits

| Commit | What it fixed | Relates to previous issue? |
|---|---|---|
| `6873028` | Reverted `machine:cwd` eviction — multiple agents per directory is first-class. Added `R-HV-20b`, `R-HV-20c` requirements. | **New correctness fix** — the previous eviction logic was silently killing agents sharing a directory. Now eviction is only on `machine:port`, which is correct since a port can only belong to one process. |
| `5acdebc` | Pi-DE WebSocket leak: `useHypivisor` now properly cleans up previous connections before creating new ones. | **Fixes M-5** from previous review. |
| `1d049fb` | Heartbeat-based ghost node detection: pi-socket sends `ws.ping()` every 30s, hypivisor updates `last_seen`, cleanup removes "active" nodes whose heartbeat is stale (>3× TTL). | **New feature** addressing a gap the previous review didn't identify. |
| `3af3604` | Eliminate ghost registrations on session restart: `session_start` now calls `teardownHypivisor()` to close the previous connection before creating a new one, preventing orphaned WebSocket connections. | **New correctness fix** — was causing duplicate registrations. |
| `6e5ba93` | Added `hyper-pi-protocol` shared package, eliminating type duplication. | **Addresses DRY** — pi-socket and pi-de now import from a single source of truth. |

### Still Open from Previous Review

| Previous ID | Issue | Current Status |
|---|---|---|
| **C-1** | Proxy hardcodes `127.0.0.1` — multi-machine broken | **Still present.** `main.rs` line ~330: `("127.0.0.1".to_string(), node.port)`. The `node.machine` field is ignored entirely in the proxy lookup. Multi-machine deployments via the proxy will silently connect to the wrong host. |
| **C-2** | O(n²) truncation in `buildInitState` | **Still present.** `history.ts` still uses `while (messages.length > 10) { messages.shift(); if (JSON.stringify(messages).length <= MAX_INIT_BYTES) break; }`. Each iteration re-serializes the entire remaining array. |
| **H-1** | WebSocket errors silently swallowed | **Partially present.** `ws.on("error", () => {})` at line ~90 and `wss.on("error", () => {})` at line ~93 of `index.ts`. |
| **H-2** | Sync file I/O in logger | **Still present.** `log.ts` uses `fs.appendFileSync`. |
| **H-3** | WebSocket key generation not random | **Still present.** `base64_ws_key()` in `main.rs` uses `SystemTime::now().as_nanos()`. |
| **H-4** | `safeSerialize` swallows failures without logging | **Still present.** The final `catch` in `safeSerialize()` logs nothing. |
| **H-5** | Proxy read buffer unbounded | **Still present.** `ws_read()` has no check on `read_buf.len()`. |
| **M-1** | `NodeInfo.status` is String, not enum | **Still present.** |
| **M-2** | No test for truncation path | **Still present.** `history.test.ts` has no test for the >500KB path. |
| **M-3** | `rpc.ts` global pending map | **Still present.** `pendingRequests` is a module-level export. |
| **M-4** | `RemoteAgent.prompt()` drops array content | **Still present.** |
| **M-7** | Spawned process lifecycle not tracked | **Still present.** `Child` handle is dropped immediately. |
| **M-8** | `main.rs` is large — multiple responsibilities | **Still present** but slightly improved — auth, cleanup, fs_browser, spawn, rpc, and state are now in separate modules. `main.rs` is still ~500+ lines with WsWriter, ws_read, registry handler, proxy handler, and base64 encoding. |
| **M-9** | Proxy doesn't validate agent's 101 response | **Still present.** |
| **M-10** | `catch (e: any)` in SpawnModal | **Still present.** |
| **L-1** | Missing `boundary()` on `ws.on("close")` | **Still present.** |
| **L-2** | Token visible in URL query string | **Acknowledged design choice.** |
| **L-3** | `patchLit.ts` fragile to Lit version changes | **Still present.** No version guard added. |
| **L-4** | `handleGoUp` assumes Unix paths | **Still present.** |
| **L-5** | Cleanup thread uses polling | **Reduced impact** — interval changed from 60s to 15s (for ghost detection), but still uses `std::thread::sleep` polling. |

---

## New Issues Found

### N-1. Ghost cleanup can delete nodes that just re-registered (TOCTOU race)

**File:** `hypivisor/src/cleanup.rs`
**Severity:** Medium
**Violates:** Eliminate Race Conditions

The cleanup function reads the node map with a `read()` lock, identifies stale nodes, drops the lock, then acquires a `write()` lock to remove them. Between the two locks, a node could have reconnected and re-registered. The code has a "re-check" guard:

```rust
let still_stale = nodes.get(id).is_some_and(|n| match n.status.as_str() {
    "offline" => n.offline_since.is_some_and(|since| now - since > ttl),
    "active" => n.last_seen.is_some_and(|seen| now - seen > active_ttl),
    _ => false,
});
```

This is good — and there's even a test (`reactivated_node_not_removed`). However, the re-check uses the same `now` timestamp from before the read lock was dropped. If the cleanup took non-trivial time (e.g., many nodes), `now` could be slightly stale, potentially causing a freshly-registered node to appear stale if its `last_seen` was set to a timestamp very close to the threshold.

**Impact:** Low in practice (cleanup runs every 15s, thresholds are 30s/90s), but the pattern is subtly incorrect.

**Fix:** Re-capture `now` inside the write lock:
```rust
let now = Utc::now().timestamp(); // refresh timestamp for accuracy
```

### N-2. Heartbeat interval is not configurable and hardcoded to 30s

**File:** `pi-socket/src/index.ts`, line ~156
**Severity:** Low
**Violates:** Clear Abstractions & Contracts

```typescript
heartbeatInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
    }
}, 30_000);
```

The 30s heartbeat is hardcoded while the hypivisor's cleanup uses `3 × node_ttl` (default 30s = 90s) as the active ghost threshold. If someone configures `--node-ttl 10`, the heartbeat at 30s means agents will be cleaned up as ghosts after 30s without a ping, but the ping only arrives every 30s — so every agent will appear as a ghost periodically.

**Fix:** Either make the heartbeat interval configurable via environment variable, or document the relationship: heartbeat interval must be < node_ttl.

### N-3. `teardownHypivisor()` doesn't await in-flight reconnect

**File:** `pi-socket/src/index.ts`
**Severity:** Low-Medium
**Violates:** Eliminate Race Conditions

`teardownHypivisor()` clears `reconnectTimer` and closes the WebSocket, but if `connectToHypivisor()` is currently executing (creating a `new WebSocket(url)` that hasn't connected yet), the `teardownHypivisor` won't catch it — it only clears `hypivisorWs` if it's already set. The new WebSocket from the in-flight `connectToHypivisor` could connect after teardown, creating a ghost connection.

The window is small (WebSocket constructor → `hypivisorWs = ws` assignment) but real under rapid session restarts.

**Fix:** Add a generation counter. Increment it in `teardownHypivisor()` and check it in the `ws.on("open")` handler:
```typescript
let generation = 0;
function teardownHypivisor() {
    generation++;
    // ... existing cleanup
}
function connectToHypivisor(port: number) {
    const myGen = generation;
    // ... create ws
    ws.on("open", boundary("hypivisor.open", () => {
        if (myGen !== generation) { ws.close(); return; }
        // ... proceed with registration
    }));
}
```

### N-4. `useAgent` reconnects after agent goes offline, then re-adds `onmessage`

**File:** `pi-de/src/useAgent.ts`
**Severity:** Low-Medium
**Violates:** DRY, Eliminate Race Conditions

When the agent WebSocket closes, `useAgent` schedules a reconnect in 3s. When reconnection succeeds, `connect()` is called again, which:
1. Creates a new WebSocket
2. Adds `ws.onmessage` (to catch `init_state` for truncation)
3. Calls `remoteAgent.connect(ws)` (which adds its own `addEventListener("message", ...)`)

But `remoteAgent.connect(ws)` never calls `remoteAgent.disconnect()` first on reconnect. The old WebSocket's message listener was added via `addEventListener` on the raw DOM WebSocket object, which doesn't get cleaned up when `useAgent`'s effect cleanup closes the WebSocket (it calls `remoteAgent.disconnect()` which sets `this.ws = null` but doesn't remove the event listener from the old WebSocket).

Since the old WebSocket is closed, the old listener is harmless (no messages will arrive). But the pattern is sloppy — each reconnection adds a new listener on a new WebSocket without removing the old one. If the old WebSocket somehow lingered (didn't close cleanly), you'd get double processing.

**Fix:** In `RemoteAgent.connect(ws)`, clean up the previous WebSocket's listener first.

### N-5. `safeSerialize` fallback returns a non-standard event type

**File:** `pi-socket/src/index.ts`
**Severity:** Low
**Violates:** Clear Abstractions & Contracts

```typescript
return '{"type":"error","message":"non-serializable event"}';
```

This returns `{ type: "error", message: "..." }` which is not a recognized `SocketEvent` type. `RemoteAgent.handleSocketEvent` will pass this to the `switch` on `event.type`, hit no case, and silently ignore it. The client never knows serialization failed.

**Fix:** Log the failure (as noted in H-4 from the previous review) and consider returning a structured error event that Pi-DE can display:
```typescript
return '{"type":"error","error":"non-serializable event","timestamp":' + Date.now() + '}';
```

### N-6. Proxy `agent_to_dash` thread leaks if dashboard disconnects first

**File:** `hypivisor/src/main.rs`, `handle_proxy_ws()`
**Severity:** Medium
**Violates:** Eliminate Race Conditions, Scalability

The proxy creates two threads: one for `agent → dashboard` and one for `dashboard → agent`. The `dashboard → agent` thread is the main thread of `handle_proxy_ws()`. If the dashboard disconnects, the main thread breaks out of its loop, then calls `agent_to_dash.join()`.

But the `agent_to_dash` thread is blocked on `ws_read(&mut agent_stream, ...)` which has a 100ms read timeout. If the agent is silent, the thread will keep looping on `WouldBlock` errors indefinitely — `join()` will block until the agent either sends something (causing a write error to the closed dashboard) or the agent itself disconnects.

In the worst case, if the agent is idle and never sends, the `agent_to_dash` thread lives forever. Each orphaned proxy connection leaks a thread + TCP connection.

**Fix:** When the dashboard disconnects, shut down the agent stream to unblock the read:
```rust
// After the dashboard→agent loop exits:
let _ = agent_stream.shutdown(std::net::Shutdown::Both);
let _ = agent_to_dash.join();
```

Or use a shared `AtomicBool` flag that the `agent_to_dash` thread checks on each `WouldBlock` iteration.

### N-7. `deregister` RPC handler holds write lock while broadcasting

**File:** `hypivisor/src/rpc.rs`, `handle_deregister()`
**Severity:** Low
**Violates:** Scalability

```rust
let removed = {
    let mut nodes = state.nodes.write().expect("nodes lock poisoned in deregister");
    nodes.remove(node_id).is_some()
};
if removed {
    let event = ...;
    let _ = state.tx.send(cx, event);
}
```

Actually, looking more carefully, the lock is dropped before the broadcast (`removed` is extracted from the block). This is correct. No issue.

### N-8. Protocol type mismatch: `RpcRequest.id` required in TypeScript, optional in Rust

**File:** `hyper-pi-protocol/src/index.ts` vs `hypivisor/src/rpc.rs`
**Severity:** Low
**Violates:** Clear Abstractions & Contracts

The protocol package declares:
```typescript
export interface RpcRequest {
  id: string;       // required
  method: string;
  params: Record<string, unknown>;
}
```

But the Rust side:
```rust
pub struct RpcRequest {
    pub id: Option<String>,     // optional
    pub method: String,
    pub params: Option<Value>,  // optional, and Value not Record<string, unknown>
}
```

The TypeScript type is stricter than the wire format. This means: (a) TypeScript code must always provide `id` even for fire-and-forget RPCs, and (b) `params` is required in TS but optional in Rust. A `list_nodes` call with no params would violate the TS type.

This was noted as L-7 in the previous review but is worth upgrading — it's a DRY violation since the protocol package exists specifically to be the single source of truth, but it doesn't match the actual wire format.

**Fix:** Align:
```typescript
export interface RpcRequest {
  id?: string;
  method: string;
  params?: Record<string, unknown>;
}
```

---

## Remaining Issues (Updated & Re-Prioritized)

### Critical

| ID | Component | Issue | Notes |
|---|---|---|---|
| C-1 | hypivisor | Proxy hardcodes `127.0.0.1` — multi-machine broken | **Blocks vision.** The design doc shows multi-machine topologies as a core use case. Fix: use `node.machine` for remote nodes. |
| C-2 | pi-socket | O(n²) truncation can freeze pi process | **Blocks scalability.** For sessions with hundreds of messages, `buildInitState` can block the event loop for seconds. Fix: estimate-and-slice from end. |

### High

| ID | Component | Issue | Notes |
|---|---|---|---|
| H-1 | pi-socket | `ws.on("error")` / `wss.on("error")` swallowed | Violates the project's own AGENTS.md rule. Log via `log.warn`. |
| H-2 | pi-socket | `fs.appendFileSync` blocks event loop | Every log call blocks. Switch to async buffered writes. |
| H-3 | hypivisor | `base64_ws_key()` uses timestamp, not random | Low entropy, violates RFC 6455. Use `getrandom` crate. |
| H-4 | pi-socket | `safeSerialize` final catch logs nothing | Hardening system can never detect this class of failure. |
| H-5 | hypivisor | Proxy `read_buf` has no size limit | Unbounded memory growth per connection. |
| N-6 | hypivisor | Proxy `agent_to_dash` thread leaks on dashboard disconnect | Each idle proxy leaks a thread indefinitely. |

### Medium

| ID | Component | Issue | Notes |
|---|---|---|---|
| M-1 | hypivisor | `NodeInfo.status` is `String` not enum | Typos compile silently. |
| M-2 | pi-socket | No test for truncation path | The O(n²) bug would have been caught. |
| M-3 | Pi-DE | `rpc.ts` global pending map | Cross-connection response routing risk. |
| M-4 | Pi-DE | `RemoteAgent.prompt()` drops array content | User message silently lost. |
| M-6 | Pi-DE | Double JSON.parse on every WebSocket message | GC pressure during streaming. |
| M-7 | hypivisor | Spawned process has no lifecycle tracking | `Child` handle dropped immediately. |
| M-8 | hypivisor | `main.rs` still has 5+ responsibilities | WsWriter, ws_read, registry, proxy, base64 all in one file. |
| M-9 | hypivisor | Proxy doesn't validate agent's 101 response | Garbage forwarding if agent port is recycled. |
| M-10 | Pi-DE | `catch (e: any)` in SpawnModal | Should use `unknown`. |
| N-3 | pi-socket | In-flight reconnect not cancelled by teardown | Small race window on rapid restarts. |
| N-4 | Pi-DE | `RemoteAgent.connect()` doesn't clean up old listener | Sloppy but harmless if old WS is closed. |
| N-8 | protocol | `RpcRequest` type mismatch TS vs Rust | Single source of truth doesn't match wire format. |

### Low

| ID | Component | Issue | Notes |
|---|---|---|---|
| L-1 | pi-socket | Missing `boundary()` on `ws.on("close")` | Low risk but violates stated pattern. |
| L-3 | Pi-DE | `patchLit.ts` fragile to Lit version changes | Add version guard. |
| L-4 | Pi-DE | `handleGoUp` assumes Unix paths | Windows cross-platform issue. |
| N-1 | hypivisor | TOCTOU race in cleanup re-check | Stale `now` timestamp. Low practical impact. |
| N-2 | pi-socket | Heartbeat 30s hardcoded vs configurable TTL | Will cause ghost detection at low TTL values. |
| N-5 | pi-socket | `safeSerialize` fallback is not a valid event type | Client silently ignores. |

---

## Architecture Assessment

### Strengths

1. **Clean component boundaries.** pi-socket, hypivisor, and Pi-DE have clear responsibilities with minimal coupling. The `hyper-pi-protocol` package is the right DRY solution for shared types. The wire protocol is simple enough to debug with `wscat`.

2. **The ghost node problem is well-solved.** The combination of `teardownHypivisor()` on session restart (commit `3af3604`), `deregister` RPC on clean shutdown, `machine:port` eviction on registration, and heartbeat-based cleanup for dead TCP connections (commit `1d049fb`) covers all four ghost scenarios. The cleanup module has excellent test coverage including the TOCTOU re-check case.

3. **The "multiple agents per directory" fix is architecturally correct.** Commit `6873028` and the new integration tests in `multi-agent.test.ts` demonstrate that `machine:port` is the only valid eviction key. The tests are thorough: 2 agents same cwd, 5 agents same cwd, eviction on same port only, and non-eviction on same cwd different port.

4. **Integration test quality is high.** The test suite starts real hypivisor binaries on random ports, simulates agents and dashboards with `BufferedWs`, and verifies full event flows. The proxy relay tests use a real WebSocket server simulating pi-socket. The deregister test validates the clean shutdown path end-to-end.

5. **Error architecture (two-layer pattern) is genuinely good.** The distinction between inner-layer known-error handling and outer-layer `boundary()` catch-all with `needsHardening` flags is production-quality. The structured JSONL log with hardening skill integration is practical.

6. **Pass-through event forwarding is elegant.** pi-socket forwards native pi `AgentEvent` objects directly over WebSocket. `RemoteAgent` receives them and emits — no reconstruction, no custom event format. This means pi-web-ui's `AgentInterface` works with the exact same event objects it was designed for.

### Weaknesses

1. **`main.rs` is doing too much.** At 500+ lines, it contains the WebSocket upgrade logic, frame reading/writing, registry handler, proxy handler, and base64 encoding. The module decomposition for business logic (auth, cleanup, fs_browser, spawn, rpc, state) is excellent — but the WebSocket infrastructure in `main.rs` is the remaining monolith.

2. **The proxy implementation is fragile.** Thread-per-connection with blocking I/O, no read buffer limits, no connection timeout, leaked threads on dashboard disconnect, hardcoded `127.0.0.1`, and hand-rolled WebSocket handshake. This is the weakest part of the codebase architecturally. For the vision's "thousands of agents" scenario, each Pi-DE tab connecting to an agent creates 3 threads (main, broadcast forwarder, agent-to-dashboard) plus 2 TCP connections. 100 concurrent proxy connections = 300 threads.

3. **No test coverage for the truncation path.** The `buildInitState` function's >500KB path is completely untested. The O(n²) bug in this code path would have been caught by even a basic test with large messages. This is a TDD violation.

4. **Double message parsing in Pi-DE.** Both `useAgent` and `RemoteAgent` parse every WebSocket message. During LLM streaming with rapid `message_update` events, this doubles GC pressure for no reason.

### Scalability Assessment

**Can this handle thousands of agents?**

- **Hypivisor registry:** Yes. `HashMap<String, NodeInfo>` with `RwLock` scales well for reads. Broadcast channel handles fan-out to dashboards.
- **Hypivisor proxy:** No. Thread-per-proxy-connection with blocking I/O will exhaust OS thread limits at hundreds of concurrent connections. Need to move to async I/O (tokio/asupersync) for the proxy path.
- **pi-socket:** Yes per instance. Each pi-socket is its own process. The `WebSocketServer` handles multiple clients fine.
- **Pi-DE:** Mostly yes. Each agent connection creates one WebSocket. The roster is just a list render. The main bottleneck would be the double-parsing and the reconnection logic creating duplicate connections.

**Verdict:** The registry scales; the proxy does not. For the "local god-mode" use case (3-10 agents, one developer), it's fine. For "autonomous agent swarms" (hundreds), the proxy needs a rewrite to async I/O.

---

## Recommendations (Priority Order)

### Must Fix (Blocking correctness or stability)

1. **Fix C-1: Proxy hardcodes `127.0.0.1`.** Use `node.machine` for the proxy target. Compare `node.machine` to the local hostname and use `127.0.0.1` only for same-machine nodes. This is a 5-line fix that unblocks the multi-machine vision.

2. **Fix C-2: O(n²) truncation in `buildInitState`.** Replace the `while/shift/JSON.stringify` loop with estimate-and-slice:
   ```typescript
   const avgSize = serialized.length / messages.length;
   const keepCount = Math.max(10, Math.floor(MAX_INIT_BYTES / avgSize));
   return { ..., messages: messages.slice(-keepCount), truncated: true, totalMessages };
   ```
   And add a test (M-2).

3. **Fix N-6: Proxy thread leak.** Shut down the agent stream when the dashboard disconnects so the `agent_to_dash` thread unblocks and exits.

### Should Fix (Brittleness under real conditions)

4. **Fix H-1: Log WebSocket errors.** Replace `ws.on("error", () => {})` with `ws.on("error", (err) => log.warn("ws.client", "error", { error: String(err) }))`.

5. **Fix H-4: Log `safeSerialize` failures.** Add `log.error("safeSerialize", err)` in the final catch.

6. **Fix H-2: Async logger.** Buffer writes and flush with `setImmediate` + `fs.appendFile`.

7. **Fix H-5: Bound proxy read buffer.** Add `const MAX_READ_BUF: usize = 16 * 1024 * 1024;` check.

8. **Fix M-4: `RemoteAgent.prompt()` handle array content.** Extract text from `(TextContent | ImageContent)[]` before sending.

### Should Improve (Tech debt / maintainability)

9. **Extract `main.rs` WebSocket infrastructure** into `ws.rs` (WsWriter, ReadResult, ws_read, upgrade_websocket) and `proxy.rs` (handle_proxy_ws, base64_ws_key). Get `main.rs` down to ~100 lines.

10. **Fix M-6: Eliminate double JSON.parse** by having `RemoteAgent` expose a callback or event for `init_state.truncated` so `useAgent` doesn't need its own `onmessage`.

11. **Fix N-8: Align `RpcRequest` type** in hyper-pi-protocol to match the actual wire format (`id?`, `params?`).

12. **Add M-2: Truncation test** for `buildInitState`. This would catch the O(n²) bug and prevent regressions:
    ```typescript
    it("truncates when serialized messages exceed 500KB", () => {
        const entries = Array.from({ length: 60 }, (_, i) => ({
            type: "message",
            message: { role: "assistant", content: [{ type: "text", text: "x".repeat(10_000) }], timestamp: i },
        }));
        const result = buildInitState(entries, []);
        expect(result.truncated).toBe(true);
        expect(result.messages.length).toBeLessThan(60);
    });
    ```

### Nice to Have (Polish)

13. **Fix H-3:** Replace `base64_ws_key()` with `getrandom` + standard `base64` crate.
14. **Fix M-1:** Change `NodeInfo.status` from `String` to an enum with serde `rename_all`.
15. **Fix L-3:** Add Lit version guard to `patchLit.ts`.
16. **Fix N-2:** Make heartbeat interval configurable or document the relationship with `node_ttl`.

---

## Test Coverage Summary

| Component | Unit Tests | Integration Tests | Gaps |
|---|---|---|---|
| pi-socket `history.ts` | ✅ 9 tests | — | **No truncation test** (M-2) |
| pi-socket `safety.ts` | — | — | No tests (trivial wrapper, acceptable) |
| pi-socket `log.ts` | — | — | No tests (side-effect heavy, acceptable) |
| pi-socket `index.ts` | — | — | No unit tests (requires pi mock, covered by integration) |
| hypivisor `rpc.rs` | ✅ 7 tests | — | Good coverage including deregister |
| hypivisor `auth.rs` | ✅ 4 tests | — | Good coverage |
| hypivisor `cleanup.rs` | ✅ 6 tests | — | **Excellent** — includes reactivation race test |
| hypivisor `fs_browser.rs` | ✅ 2 tests | — | Minimal but covers core paths |
| hypivisor `spawn.rs` | — | — | No tests (spawns real process, acceptable) |
| Pi-DE `RemoteAgent.ts` | ✅ 9 tests | — | Good event forwarding coverage |
| Pi-DE `rpc.ts` | ✅ 4 tests | — | Good coverage |
| Pi-DE hooks | — | — | No tests (React hooks, acceptable for v1) |
| Integration: smoke | ✅ 7 tests | ✅ | Comprehensive end-to-end flow |
| Integration: multi-agent | ✅ 4 tests | ✅ | Thorough multi-cwd coverage |
| Integration: proxy-relay | ✅ 3 tests | ✅ | Bidirectional relay verified |
| Integration: e2e-live | ✅ 5 tests | ✅ | Live infrastructure validation |

**Overall assessment:** Good test coverage for a v1. The integration test suite is excellent and catches real architectural bugs. The main gap is the `buildInitState` truncation path — the one place where a test would have directly prevented the most impactful performance bug (C-2).
