Review written to `/Users/csells/Code/csells/hyper-pi/tmp/review-claude.md` (682 lines).

## Review Summary

**30 issues found:** 3 critical, 6 high, 12 medium, 9 low

### Critical
| ID | Component | Issue |
|----|-----------|-------|
| C-1 | pi-socket | **O(n³) history truncation** can freeze the pi process — untested code path |
| C-2 | hypivisor | **Proxy hardcodes `127.0.0.1`** — ignores `node.machine`, breaks multi-machine |
| C-3 | hypivisor | **`deregister` RPC has no authorization** — any client can remove any node |

### Top Positives
1. **Error architecture** (boundary + JSONL + hardening) is production-quality
2. **Event pass-through** design (pi→pi-socket→RemoteAgent→AgentInterface) is elegant
3. **Multi-agent-per-directory** is correctly enforced with comprehensive integration tests
4. **Ghost node fix** is thorough (3-layer defense with TOCTOU protection)
5. **hyper-pi-protocol** shared types eliminate all type duplication

### Key Gaps
- **~40-45% test coverage** — truncation, safeSerialize, proxy, hooks all untested
- **Error swallowing** in 3 locations directly contradicts project's own AGENTS.md
- **Inspector pane** (R-UI-1/2) and **mobile layout** (R-UI-3/4) not implemented
- **main.rs** at 540+ lines violates SRP with 5+ responsibilities

### Fix Priority
1. Error handling discipline (H-1, H-3) — one sweep
2. Truncation fix + test (C-1, M-2)  
3. Deregister authorization (C-3)
4. Proxy hardcoding (C-2)
5. main.rs decomposition (M-7)
6. Test coverage expansion
es.shift();    // O(n) — shifts entire array
  if (JSON.stringify(messages).length <= MAX_INIT_BYTES) break;  // O(n) — serializes everything
}
```

Each iteration: `shift()` is O(n), `JSON.stringify()` is O(n), in a while loop of up to n iterations = **O(n³)**. For a 500KB history with 200 messages, this produces ~80MB of temporary string allocations synchronously on Node's event loop inside pi's process. This blocks the TUI, LLM streaming, and all other extensions.

**No test covers this path** — `history.test.ts` has 10 tests but all use small payloads that never trigger truncation (M-2 below).

**Fix:** Single-pass estimator:

```typescript
if (serialized.length > MAX_INIT_BYTES) {
  const avgSize = serialized.length / messages.length;
  const keepCount = Math.max(10, Math.floor(MAX_INIT_BYTES / avgSize));
  const trimmed = messages.slice(-keepCount);
  return {
    type: "init_state",
    messages: trimmed as InitStateEvent["messages"],
    tools: tools ?? [],
    truncated: true,
    totalMessages: messages.length,
  };
}
```

---

### C-2. Proxy hardcodes `127.0.0.1` — multi-machine architecture broken

**File:** `hypivisor/src/main.rs:342-344` (inside `handle_proxy_ws`)
**Violates:** Clear Abstractions & Contracts, Spec Adherence (R-CC-5/6/7)

```rust
Some(node) if node.status == "active" => {
    ("127.0.0.1".to_string(), node.port)
}
```

The node's registered `machine` field is completely ignored. The proxy always connects to localhost. This breaks the explicitly stated multi-machine topology in `specs/vision.md` and `specs/design.md`. A Pi-DE user connecting to an agent on Machine B gets routed to a random local port on the hypivisor's machine.

**Fix:** Use the `machine` field, with localhost optimization for same-machine:

```rust
Some(node) if node.status == "active" => {
    let host = if node.machine == hostname {
        "127.0.0.1".to_string()
    } else {
        node.machine.clone()
    };
    (host, node.port)
}
```

---

### C-3. `deregister` RPC has no authorization — any client can remove any node

**File:** `hypivisor/src/rpc.rs:67-88` (`handle_deregister`)
**Violates:** Clear Abstractions & Contracts, Security

The deregister method accepts `{ id: "any-node-id" }` and removes it from the registry, no questions asked. Any authenticated WebSocket client can wipe the entire roster by iterating through node IDs. The `registered_node_id` tracked in `handle_registry_ws` already identifies which node the connection owns — this should be used for authorization.

**Fix:** Pass `registered_node_id` into dispatch and verify the caller owns the node they're deregistering. Alternatively, only allow deregistration through the same WebSocket connection that registered the node.

---

## 2. High-Severity Issues

### H-1. WebSocket errors silently swallowed (3 locations)

**Files:** `pi-socket/src/index.ts:95,97`, `pi-de/src/useAgent.ts:86`
**Violates:** Don't Swallow Errors (explicitly listed in AGENTS.md)

```typescript
// pi-socket/src/index.ts
ws.on("error", () => {});   // line 95
wss.on("error", () => {});  // line 97

// pi-de/src/useAgent.ts
ws.onerror = () => {};       // line 86
```

The project's own AGENTS.md states: *"Don't Swallow Errors by catching exceptions... All of those are exceptions that should be thrown so that the errors can be seen, root causes can be found and fixes can be applied."* The `boundary()` pattern exists exactly for this purpose but isn't used on these handlers.

**Fix:** In pi-socket, wrap with boundary or at minimum log:
```typescript
ws.on("error", boundary("ws.client.error", (err) => {
  log.warn("ws.client", "client error", { error: String(err) });
}));
```

In Pi-DE, log to console for debugging:
```typescript
ws.onerror = (e) => console.warn("[useAgent] WebSocket error:", e);
```

---

### H-2. Synchronous file I/O in logger blocks the event loop

**File:** `pi-socket/src/log.ts:49` (`fs.appendFileSync`)
**Violates:** Scalability, Write for Maintainability

Every `log.info()`, `log.warn()`, and `log.error()` call uses `fs.appendFileSync()`, which blocks the Node event loop. This is called on every WebSocket connection, every broadcast, every reconnect. Under load with many connected clients, this creates back-pressure that slows WebSocket delivery and LLM streaming.

**Fix:** Buffer writes and flush asynchronously:
```typescript
let buffer: string[] = [];
let flushScheduled = false;

function write(entry: LogEntry): void {
  ensureDir();
  buffer.push(JSON.stringify(entry) + "\n");
  if (!flushScheduled) {
    flushScheduled = true;
    setImmediate(() => {
      const batch = buffer.join("");
      buffer = [];
      flushScheduled = false;
      fs.appendFile(LOG_FILE, batch, () => {});
    });
  }
}
```

---

### H-3. `safeSerialize` swallows serialization failures without logging

**File:** `pi-socket/src/index.ts:216-221`
**Violates:** Don't Swallow Errors, Observability & Testability

```typescript
} catch {
  return '{"type":"error","message":"non-serializable event"}';
}
```

When the inner replacer fails AND the outer catch fires, no log entry is written, no `needsHardening` flag is set. The hardening system can never detect this class of failure. The client receives a generic error message with zero diagnostic information.

**Fix:**
```typescript
} catch (e) {
  log.error("safeSerialize", e);
  return '{"type":"error","message":"non-serializable event"}';
}
```

---

### H-4. WebSocket key generation is not random

**File:** `hypivisor/src/main.rs:522-538` (`base64_ws_key`)
**Violates:** Clear Abstractions & Contracts

```rust
let seed = SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).unwrap().as_nanos();
```

RFC 6455 §4.1 requires a "randomly selected" 16-byte value. This uses nanosecond timestamp with low entropy and a hand-rolled base64 encoder. Two proxy connections in the same nanosecond produce identical keys. While functionally acceptable for trusted local connections today, it's fragile.

**Fix:** Use `getrandom` crate or mix in PID + counter for uniqueness.

---

### H-5. Proxy read buffer has no size limit

**File:** `hypivisor/src/main.rs:250` (`ws_read`)
**Violates:** Eliminate Race Conditions, Scalability

```rust
read_buf.extend_from_slice(&tmp[..n]);
```

`read_buf` grows without bound. A client sending an incomplete frame indefinitely causes unbounded memory growth per connection thread. With the thread-per-connection model, this is a denial-of-service vector.

**Fix:** Add `const MAX_READ_BUF: usize = 16 * 1024 * 1024;` and check before extending.

---

### H-6. SpawnModal has infinite re-fetch loop on navigation

**File:** `pi-de/src/SpawnModal.tsx:22-31`
**Violates:** Eliminate Race Conditions, KISS

```typescript
const loadDirs = useCallback(async () => {
  const result = await rpcCall(...);
  setCurrentPath(result.current);  // ← triggers re-render
}, [hvWs, currentPath]);           // ← depends on currentPath

useEffect(() => {
  loadDirs();
}, [loadDirs]);
```

When the modal opens, `loadDirs` fetches directories and sets `currentPath` to the server's canonicalized path. If the canonical path differs from the initial value (e.g., `""` → `/Users/csells`), `currentPath` changes → `loadDirs` is recreated (it depends on `currentPath`) → the effect re-fires → double fetch. This stabilizes after 2 iterations but causes flicker and wasted network calls.

**Fix:** Separate navigation intent from display path:
```typescript
const [navPath, setNavPath] = useState<string | null>(null);
const loadDirs = useCallback(async (path: string | null) => {
  const result = await rpcCall(hvWs, "list_directories", path ? { path } : {});
  setCurrentPath(result.current);
  setDirs(result.directories);
}, [hvWs]);
useEffect(() => { loadDirs(navPath); }, [loadDirs, navPath]);
```

---

## 3. Medium Issues

### M-1. `NodeInfo.status` is a String, not an enum

**File:** `hypivisor/src/state.rs:7`
**Violates:** Clear Abstractions, Prefer Non-Nullable Variables

```rust
pub status: String,
```

Status is compared against string literals (`"active"`, `"offline"`) in rpc.rs, cleanup.rs, and main.rs. A typo like `"actve"` compiles silently. The Rust type system is being underused.

**Fix:**
```rust
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum NodeStatus { Active, Offline }
```

---

### M-2. No test for history truncation code path

**File:** `pi-socket/src/history.test.ts`
**Violates:** TDD, Observability & Testability

The 500KB truncation path in `buildInitState` is completely untested. All 10 tests use small payloads. The only mention of `truncated` in tests is to assert it's `undefined`. A truncation test would have caught C-1.

**Fix:** Add a test with large payloads:
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

---

### M-3. `rpc.ts` pendingRequests is a module-level global singleton

**File:** `pi-de/src/rpc.ts:12`
**Violates:** Low Coupling, Separation of Concerns

```typescript
export const pendingRequests = new Map<string, PendingRequest>();
```

If the same `rpcCall` function is used with multiple WebSocket connections (hypivisor + agent proxy), responses could be routed to wrong promises. The `export` signals reuse intent.

**Fix:** Return a scoped RPC client from a factory function, or key by connection.

---

### M-4. `RemoteAgent.prompt()` drops array content silently

**File:** `pi-de/src/RemoteAgent.ts:95-99`
**Violates:** Clear Abstractions & Contracts, Don't Swallow Errors

```typescript
const text = typeof message === "string" ? message : (message as UserMessage).content;
if (typeof text === "string") {
  this.ws.send(text);
}
```

`UserMessage.content` can be `string | (TextContent | ImageContent)[]`. When it's an array, the `typeof text === "string"` check fails and the message is silently dropped. The user sees their message appear to send, but nothing arrives at the agent.

**Fix:**
```typescript
let text: string;
if (typeof message === "string") {
  text = message;
} else {
  const content = (message as UserMessage).content;
  text = typeof content === "string"
    ? content
    : content.filter((c): c is TextContent => c.type === "text").map(c => c.text).join("\n");
}
if (text) this.ws.send(text);
```

---

### M-5. `useAgent` double-parses every WebSocket message

**File:** `pi-de/src/useAgent.ts:67-72`
**Violates:** DRY

Both `useAgent`'s `ws.onmessage` handler and `RemoteAgent.connect(ws)` add message listeners that call `JSON.parse()` on every message. During LLM streaming, every `delta` event is parsed twice — doubling GC pressure.

**Fix:** Remove the hook's `onmessage` handler. Have `RemoteAgent` expose a callback or event for truncation state.

---

### M-6. Spawned pi process is orphaned — no lifecycle tracking

**File:** `hypivisor/src/spawn.rs:27`
**Violates:** Observability & Testability

```rust
Command::new("pi").current_dir(&canonical).spawn()
    .map_err(|e| format!("Failed to spawn: {}", e))?;
```

The `Child` handle is immediately dropped. There's no way to know if the process started successfully, no PID logging, no lifecycle tracking. The process becomes immediately orphaned.

**Fix:** At minimum log the PID. Ideally retain the handle and check `try_wait()` in the cleanup loop.

---

### M-7. `main.rs` is 540+ lines with 5+ responsibilities — SRP violation

**File:** `hypivisor/src/main.rs`
**Violates:** SRP, Separation of Concerns

`main.rs` contains: CLI argument parsing, TCP listener, HTTP routing, WebSocket upgrade, WebSocket frame reading/writing (`WsWriter`, `ReadResult`, `ws_read()`), registry handler, proxy handler, base64 encoding, and the main function.

**Fix:** Extract:
- `ws.rs` — `WsWriter`, `ReadResult`, `ws_read()`, `upgrade_websocket()`
- `proxy.rs` — `handle_proxy_ws()`, `base64_ws_key()`
- `registry.rs` — `handle_registry_ws()`

This would bring `main.rs` to ~80 lines.

---

### M-8. Proxy doesn't validate agent's WebSocket upgrade response

**File:** `hypivisor/src/main.rs:389-391`
**Violates:** Clear Abstractions

```rust
let _ = agent_stream.read(&mut resp_buf);
// Accept any 101 response — the agent is a local trusted server
```

The response isn't checked for status code 101. If the agent has crashed and another service is on that port, the proxy silently forwards garbage. At minimum check for "101" in the response.

---

### M-9. `catch (e: any)` instead of `unknown` in SpawnModal

**File:** `pi-de/src/SpawnModal.tsx:27,55`
**Violates:** TypeScript best practices, Clear Abstractions

```typescript
} catch (e: any) {
  setError(e.message);
}
```

Should use `unknown` and type-narrow:
```typescript
} catch (e: unknown) {
  setError(e instanceof Error ? e.message : String(e));
}
```

---

### M-10. Flaky integration test: proxy relay agent-to-dashboard

**File:** `integration-tests/src/proxy-relay.test.ts` — "forwards events from agent to dashboard through proxy"
**Violates:** TDD, Observability & Testability

This test fails intermittently (observed during this review) with "Timed out waiting for WS message". The mock agent broadcasts events immediately after the proxy connects, but there's no synchronization guarantee that the proxy has finished relaying the init_state before the broadcast fires. Adding a small delay or waiting for the init_state before broadcasting would fix it.

---

### M-11. Cleanup thread uses `std::thread::sleep` polling

**File:** `hypivisor/src/main.rs:84-88`
**Violates:** Prefer Async Notifications over polling

```rust
std::thread::spawn(move || loop {
    std::thread::sleep(Duration::from_secs(15));
    cleanup::cleanup_stale_nodes(&cx, &cleanup_state);
});
```

Per AGENTS.md: "Prefer Async Notifications when possible over inefficient polling." A timer-based approach would be more idiomatic. Low severity since the 15s interval is reasonable, but it does burn a thread permanently.

---

### M-12. hyper-pi-protocol `RpcRequest.id` is `string` but hypivisor uses `Option<String>`

**File:** `hyper-pi-protocol/src/index.ts` vs `hypivisor/src/rpc.rs`
**Violates:** Clear Abstractions

Protocol package declares `id: string` (required), but the Rust side has `id: Option<String>` (optional, per JSON-RPC spec). The TypeScript type is stricter than what the wire actually accepts. Not a bug, but a leaky abstraction that can confuse contributors.

---

## 4. Low-Severity Issues

### L-1. Missing `boundary()` on `ws.on("close")` in client handler

**File:** `pi-socket/src/index.ts:92-94`

Per AGENTS.md, all Node event-loop callbacks should be wrapped with `boundary()`. If `log.info` throws (unlikely but possible if filesystem is full), the pi process crashes.

### L-2. Token in URL query string is visible in logs/devtools

**File:** System-wide design choice

The auth token `?token=SECRET` appears in tracing output, browser Network tab, and proxy access logs. Acknowledged in design doc as acceptable for local/VPN use.

### L-3. `patchLit.ts` is a maintenance risk with no version guard

**File:** `pi-de/src/patchLit.ts`

Monkey-patches Lit's `ReactiveElement.performUpdate` by walking the prototype chain. Excellent comments explain *why*, but it silently breaks if Lit changes internals. Add a version guard.

### L-4. `handleGoUp` path manipulation assumes Unix paths

**File:** `pi-de/src/SpawnModal.tsx:36`

```typescript
const parts = currentPath.split("/").filter(Boolean);
```

Assumes Unix paths. On Windows, `canonicalize()` returns backslashes.

### L-5. pi-socket AGENTS.md event catalog is stale

**File:** `pi-socket/AGENTS.md`

The event catalog lists decomposed events (`delta`, `thinking_delta`, `toolcall_start`, etc.) but the current implementation forwards native pi events (`message_start`, `message_update`, `message_end`, `tool_execution_start`, `tool_execution_end`). The code changed to pass-through forwarding but the docs weren't updated.

### L-6. Reconnect delay is 3s but spec says 5s

**File:** `pi-de/src/useAgent.ts:80` — `setTimeout(..., 3000)` vs R-UI-30's "retry every 5 seconds."

### L-7. `useAgent` event listener accumulation on agent switching

**File:** `pi-de/src/useAgent.ts`

`RemoteAgent.connect(ws)` adds `addEventListener` to each new WebSocket. The `useMemo` RemoteAgent instance persists across connections but never removes old listeners. Harmless on closed sockets but not clean.

### L-8. Design doc still shows direct agent connection in Architecture diagram

**File:** `specs/design.md` — Architecture diagram shows `Pi-DE → ws://agent:port (direct connection)` but the actual implementation routes through the hypivisor proxy. The textual description is correct but the ASCII diagram is misleading.

### L-9. `cleanup_stale_nodes` broadcasts while holding write lock

**File:** `hypivisor/src/cleanup.rs:33-37`

`state.tx.send()` is called inside the write lock scope. If the broadcast channel blocks (full buffer), all registration attempts stall until the channel drains. Move the broadcast outside the lock.

---

## 5. Architecture Assessment

### What's Done Exceptionally Well

1. **Error architecture is production-quality.** The two-layer pattern (inner known-error handling + outer `boundary()` catch-all + structured JSONL log + hardening skill integration) is a genuinely novel pattern. The documentation is excellent. This should be extracted into a reusable library (as R-NR-20 envisions).

2. **Event forwarding is elegant.** pi-socket forwards native `AgentEvent` objects directly → `RemoteAgent` is a pure pass-through → Pi-DE gets exactly what `AgentInterface` expects. Zero lossy conversion, zero stateful reconstruction. This was a great architectural decision.

3. **Shared protocol package is correct DRY.** `hyper-pi-protocol` is a single source of truth for all wire types. Both pi-socket and pi-de import from it. Re-exports in `types.ts` files preserve backward compatibility.

4. **Multi-agent constraint is first-class.** Eviction keys use only `machine:port`, never `machine:cwd`. Four integration tests verify this exhaustively. `R-HV-20b` is satisfied.

5. **Integration test quality is high.** 21 tests start real hypivisor binaries, simulate agents and dashboards, verify full event flows including auth, reconnection, deregistration, multi-agent, and proxy relay. The `BufferedWs` helper correctly handles async message races. The e2e-live tests verify against real running infrastructure.

6. **Ghost node problem solved comprehensively.** Three-layer defense: prevention (`teardownHypivisor()` + deregister RPC on shutdown), detection (heartbeat pings + `last_seen` timestamp + 3×TTL cleanup), correctness (`machine:port`-only eviction). The TOCTOU defense in cleanup (re-check between read and write locks) is disciplined and tested.

7. **Module decomposition in hypivisor.** `auth.rs`, `cleanup.rs`, `fs_browser.rs`, `spawn.rs`, `rpc.rs`, `state.rs` each have a single clear responsibility with unit tests. The only exception is `main.rs` which still carries too much (M-7).

8. **Resilience patterns are correct.** pi-socket's exponential backoff with cap (5 minutes), `hypivisorUrlValid` flag to avoid retrying invalid URLs, `readyState` guards before `ws.send()`, `shutdownRequested` flag to prevent post-shutdown activity, `disposed` flag in useHypivisor — all correct defensive patterns.

### Architectural Concerns

1. **Thread-per-connection model.** The hypivisor spawns a thread per WebSocket connection (registry + proxy). Each proxy connection spawns 2 additional threads (bidirectional relay). At 500 agents + 50 dashboard clients, that's ~1550 threads. Functional but limits scaling to low thousands. Future: consider an async runtime for the proxy paths.

2. **Read timeout polling in proxy.** The proxy relay uses `set_read_timeout(100ms)` and loops on `WouldBlock`/`TimedOut` errors. This means each proxy connection burns 2 threads that wake 10x/second even when idle. A `select()` or `poll()` syscall would be more efficient.

3. **Missing Inspector pane.** R-UI-1 specifies a 3-pane layout with a right Inspector pane showing tools/skills. The current `App.tsx` has no Inspector pane — it's fully missing from the implementation. Tools from `init_state` are stored in RemoteAgent's state but never displayed.

4. **Missing mobile responsiveness.** R-UI-3 requires mobile layout (< 768px) with single-pane stack, back button, and drawer for Inspector. R-UI-4 requires 44px touch targets. The CSS file wasn't provided for review, but the React components have no mobile breakpoint logic, no back button, no drawer toggle.

### Scalability for "Thousands of Agents"

| Concern | Current State | At 1000 Agents |
|---------|---------------|----------------|
| Registry lookup | O(1) by HashMap | ✅ Fine |
| Eviction scan | O(n) per registration | ⚠️ 1000 iterations per register |
| Broadcast | O(n) per event | ⚠️ 1000 sends per event |
| Threads | 2-3 per connection | ❌ 2000-3000 threads |
| Cleanup | O(n) every 15s | ✅ Fine |
| Pi-DE roster | Linear DOM elements | ⚠️ Needs virtualization |

**Verdict:** Hundreds comfortable. Thousands need thread pooling (proxy) and list virtualization (Pi-DE). No architectural redesign needed.

---

## 6. Spec Adherence

### Requirements Satisfied

| Requirement | Status | Notes |
|-------------|--------|-------|
| R-PS-1 through R-PS-9 | ✅ | WebSocket server, events, history, multi-client |
| R-PS-10 through R-PS-15 | ✅ | Global install, hypivisor registration, auth, standalone |
| R-PS-16 through R-PS-19 | ✅ | Reconnect, stable ID, resilience, shutdown |
| R-PS-20 through R-PS-24 | ✅ | Config, dependencies |
| R-HV-1 through R-HV-6 | ✅ | Protocol, WebSocket-only, JSON-RPC |
| R-HV-7 through R-HV-10 | ✅ | Auth (PSK) |
| R-HV-11 through R-HV-17 | ✅ | Registry, broadcast events |
| R-HV-18 through R-HV-20a | ✅ | Stale cleanup, heartbeat ghosts |
| R-HV-20b, R-HV-20c | ✅ | Multi-agent per directory (with integration tests) |
| R-HV-21 through R-HV-29 | ✅ | Spawn, directory listing, security |
| R-HV-30 through R-HV-33 | ✅ | Rust, clap, thread-safe, broadcast |
| R-CC-1 through R-CC-12 | ✅ | Auth, standalone, multi-machine*, graceful degradation |

### Requirements Not Yet Satisfied

| Requirement | Status | Issue |
|-------------|--------|-------|
| R-CC-7 | ❌ | Proxy hardcodes 127.0.0.1 (C-2) |
| R-UI-1 | ❌ | No Inspector (right) pane |
| R-UI-2 | ❌ | Inspector pane not implemented |
| R-UI-3 | ❌ | No mobile responsive layout |
| R-UI-4 | ❌ | No 44px touch targets |
| R-UI-8 | ⚠️ | Reconnect works but reconnect banner missing |
| R-UI-9 | ❌ | No error screen with troubleshooting hints on initial connection fail |
| R-UI-13 | ⚠️ | Offline nodes disabled but no tooltip |
| R-UI-23 | ⚠️ | Truncation notice present but doesn't show count |
| R-UI-30 | ⚠️ | Reconnect works but uses 3s not 5s per spec |
| R-UI-31, R-UI-32 | ❌ | Inspector pane not implemented |

---

## 7. Test Coverage Analysis

### Current Coverage

| Component | Unit Tests | Integration | Notable Gaps |
|-----------|-----------|-------------|-------------|
| pi-socket | 10 (history) | 3 (smoke) | **No truncation**, no safeSerialize, no index.ts, no log.ts |
| hypivisor | 21 (auth/rpc/cleanup/fs) | 12 (smoke+multi+proxy) | **No proxy/ws_read/WsWriter**, no spawn tests |
| Pi-DE | 14 (RemoteAgent+rpc) | — | **No hooks**, no SpawnModal, no patchLit, no initStorage |
| Protocol | 0 | — | Type-only package, tests not applicable |

**Estimated code path coverage: ~40-45%**

### Critical Missing Tests

1. **History truncation** (C-1/M-2) — The most dangerous code path has zero tests
2. **safeSerialize edge cases** — Both catch branches untested
3. **Proxy relay** — `handle_proxy_ws` is 200 lines with zero unit tests
4. **useHypivisor reconnection** — Reconnect logic untested
5. **SpawnModal navigation** — Double-fetch bug (H-6) untested
6. **patchLit.ts** — No test that the Lit patch works or doesn't regress

---

## 8. Summary Table

| ID | Severity | Component | Issue |
|----|----------|-----------|-------|
| C-1 | **Critical** | pi-socket | O(n³) truncation loop can freeze pi process |
| C-2 | **Critical** | hypivisor | Proxy hardcodes `127.0.0.1` — multi-machine broken |
| C-3 | **Critical** | hypivisor | `deregister` RPC has no authorization |
| H-1 | **High** | pi-socket/Pi-DE | WebSocket errors silently swallowed (3 locations) |
| H-2 | **High** | pi-socket | `fs.appendFileSync` blocks event loop |
| H-3 | **High** | pi-socket | `safeSerialize` swallows failures without logging |
| H-4 | **High** | hypivisor | WebSocket key not random (time-based) |
| H-5 | **High** | hypivisor | Proxy read buffer unbounded |
| H-6 | **High** | Pi-DE | SpawnModal infinite re-fetch loop |
| M-1 | Medium | hypivisor | `NodeInfo.status` is String not enum |
| M-2 | Medium | pi-socket | No test for truncation path |
| M-3 | Medium | Pi-DE | `rpc.ts` global pending map |
| M-4 | Medium | Pi-DE | `RemoteAgent.prompt()` drops array content |
| M-5 | Medium | Pi-DE | Double JSON.parse on every message |
| M-6 | Medium | hypivisor | Spawned process orphaned |
| M-7 | Medium | hypivisor | `main.rs` SRP violation (540+ lines) |
| M-8 | Medium | hypivisor | Proxy doesn't validate 101 response |
| M-9 | Medium | Pi-DE | `catch (e: any)` instead of `unknown` |
| M-10 | Medium | integration | Flaky proxy relay test |
| M-11 | Medium | hypivisor | Cleanup uses sleep polling |
| M-12 | Medium | protocol | RpcRequest.id nullability mismatch |
| L-1 | Low | pi-socket | Missing `boundary()` on ws.close |
| L-2 | Low | system | Token visible in URL |
| L-3 | Low | Pi-DE | `patchLit.ts` no version guard |
| L-4 | Low | Pi-DE | `handleGoUp` assumes Unix paths |
| L-5 | Low | pi-socket | AGENTS.md event catalog stale |
| L-6 | Low | Pi-DE | 3s reconnect vs 5s spec |
| L-7 | Low | Pi-DE | Event listener accumulation |
| L-8 | Low | specs | Design doc diagram shows direct connection |
| L-9 | Low | hypivisor | Broadcast while holding write lock |

---

## 9. Prioritized Recommendations

### P0 — Immediate (before next release)

1. **Fix C-1 + add M-2 test.** Replace O(n³) truncation with single-pass estimator. Add a test with >500KB payload. This is a potential process freeze.
2. **Fix H-1 + H-3.** One sweep to replace all empty error handlers with logging. Directly contradicts AGENTS.md.
3. **Fix C-3.** Add authorization check to deregister — verify caller owns the node.

### P1 — This sprint

4. **Fix C-2.** Use `node.machine` in proxy instead of hardcoded `127.0.0.1`. Unblocks multi-machine.
5. **Fix H-6.** Separate navPath from currentPath in SpawnModal.
6. **Fix M-7.** Extract main.rs into ws.rs + proxy.rs + registry.rs with tests.
7. **Fix M-10.** Add synchronization to flaky proxy relay test.
8. **Fix L-5.** Update pi-socket AGENTS.md event catalog to match current pass-through implementation.

### P2 — This month

9. H-2 (async logger), H-4 (random WS key), H-5 (bounded read buffer)
10. M-1 (NodeStatus enum), M-4 (array content), M-5 (double parse), M-6 (spawn PID)
11. Missing requirements: R-UI-1/2 (Inspector pane), R-UI-9 (error screen)

### P3 — Backlog

12. M-3, M-8, M-9, M-11, M-12
13. L-1 through L-9
14. Mobile responsiveness (R-UI-3, R-UI-4) — significant effort
15. List virtualization for 1000+ agents

---

## 10. Verdict

Hyper-pi demonstrates strong architectural judgment. The component boundaries are clean, the wire protocol is simple and debuggable, the error architecture is genuinely innovative, and the multi-agent constraint is first-class. The event pass-through design (pi-socket → RemoteAgent → AgentInterface) is elegant and correct.

The project has two categories of debt: **(1) known patterns applied inconsistently** — the error-swallowing violations are particularly ironic given the project's explicit "Don't Swallow Errors" principle and excellent `boundary()` pattern that already exists for exactly this purpose; and **(2) missing test coverage for critical paths** — the truncation code, proxy relay, and UI hooks are the riskiest untested code.

**Fix priority: error handling discipline → truncation fix → deregister auth → proxy hardcoding → main.rs decomposition → test coverage → everything else.**

The architecture fundamentally works and scales to the stated use case. No redesign needed — just filling gaps in the existing patterns.