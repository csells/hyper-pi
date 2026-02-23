# Hyper-Pi: Code Review (Claude)

Reviewed: pi-socket (TypeScript), hypivisor (Rust), Pi-DE (React), hyper-pi-protocol (TypeScript), integration-tests

Evaluated against: AGENTS.md best practices (TDD, DRY, SRP, KISS, Don't Swallow Errors, Eliminate Race Conditions, etc.)

Codebase snapshot: ~4,200 LOC across 32 source files

---

## Executive Summary

The architecture is clean and well-separated. The three components have clear boundaries, the wire protocol is simple, and the design correctly avoids modifying pi itself. The pi-socket error architecture (inner/outer layers with `boundary()`) is a genuinely good pattern. The hypivisor's module decomposition (auth, cleanup, fs_browser, spawn, rpc, state) is idiomatic Rust with solid test coverage. The shared `hyper-pi-protocol` package eliminates type duplication across the TypeScript components.

**3 critical bugs**, **5 high-severity brittleness issues**, and a collection of medium/low concerns remain.

---

## Critical (causes bugs in normal use)

### C-1. Hypivisor proxy hardcodes `127.0.0.1` — multi-machine broken

**File:** `hypivisor/src/main.rs`, `handle_proxy_ws()` line 430
**Violates:** Clear Abstractions & Contracts, Write for Maintainability

```rust
Some(node) if node.status == "active" => {
    ("127.0.0.1".to_string(), node.port)
}
```

The proxy always connects to `127.0.0.1`, ignoring the node's `machine` field entirely. The vision doc and design doc explicitly describe multi-machine topologies. A Pi-DE user connecting to an agent on Machine B gets routed to a random local port on the hypivisor's machine instead.

**Fix:** Use the registered machine hostname for remote nodes, localhost for same-machine:

```rust
Some(node) if node.status == "active" => {
    let local_hostname = hostname::get()
        .map(|h| h.to_string_lossy().to_string())
        .unwrap_or_default();
    let host = if node.machine == local_hostname {
        "127.0.0.1".to_string()
    } else {
        node.machine.clone()
    };
    (host, node.port)
}
```

---

### C-2. History truncation is O(n²) — can freeze the pi process

**File:** `pi-socket/src/history.ts`, `buildInitState()`
**Violates:** KISS, Write for Maintainability

```typescript
while (messages.length > 10) {
    messages.shift();
    if (JSON.stringify(messages).length <= MAX_INIT_BYTES) break;
}
```

Each iteration calls `JSON.stringify()` on the entire remaining array. For a 500KB history with 200 messages, this is ~200 iterations × ~400KB serialization = ~80MB of string allocation in a tight loop. `messages.shift()` is also O(n), making this O(n³) worst case. This runs synchronously on Node's event loop inside pi's process — it blocks the TUI, LLM streaming, and all other extensions.

**No test exists for this path** — `history.test.ts` only checks `truncated` is `undefined` on normal payloads.

**Fix:** Estimate message size and slice from the end:

```typescript
if (serialized.length > MAX_INIT_BYTES) {
    const totalMessages = messages.length;
    const avgSize = serialized.length / messages.length;
    const keepCount = Math.max(10, Math.floor(MAX_INIT_BYTES / avgSize));
    const trimmed = messages.slice(messages.length - keepCount);
    return {
        type: "init_state",
        messages: trimmed as InitStateEvent["messages"],
        tools: tools ?? [],
        truncated: true,
        totalMessages,
    };
}
```

And add a test:

```typescript
it("truncates when serialized messages exceed 500KB", () => {
    const entries = Array.from({ length: 60 }, (_, i) => ({
        type: "message",
        message: {
            role: "assistant",
            content: [{ type: "text", text: "x".repeat(10_000) }],
            timestamp: i,
        },
    }));
    const result = buildInitState(entries, []);
    expect(result.truncated).toBe(true);
    expect(result.messages.length).toBeLessThan(60);
    expect(JSON.stringify(result.messages).length).toBeLessThanOrEqual(500 * 1024);
});
```

---

### C-3. SpawnModal has wasteful double-fetching on navigation

**File:** `pi-de/src/SpawnModal.tsx`
**Violates:** Eliminate Race Conditions, KISS

```typescript
const loadDirs = useCallback(async () => {
    setCurrentPath(result.current); // ← triggers re-render
}, [hvWs, currentPath]); // ← depends on currentPath

useEffect(() => {
    loadDirs();
}, [loadDirs]);
```

When the modal opens or the user navigates, `loadDirs` fetches directories and sets `currentPath` to the server's canonicalized path. If the canonical path differs from the navigation path (e.g., empty string → `/Users/csells`), `currentPath` changes → `loadDirs` is recreated → the effect re-fires → double fetch. Stabilizes after 2 iterations but causes visible flicker on slow networks.

**Fix:** Separate navigation intent from display path:

```typescript
const [navPath, setNavPath] = useState<string | null>(null);

const loadDirs = useCallback(async (path: string | null) => {
    const result = await rpcCall(hvWs, "list_directories", path ? { path } : {});
    setCurrentPath(result.current);
    setDirs(result.directories);
}, [hvWs]);

useEffect(() => { loadDirs(navPath); }, [loadDirs, navPath]);

const handleNavigate = (dir: string) => {
    setNavPath(currentPath.replace(/\/$/, "") + "/" + dir);
};
```

---

## High (causes brittleness under real conditions)

### H-1. WebSocket errors silently swallowed

**File:** `pi-socket/src/index.ts`, lines 95 and 187
**Violates:** Don't Swallow Errors (explicitly called out in AGENTS.md)

```typescript
ws.on("error", () => {});
wss.on("error", () => {});
```

The AGENTS.md states: *"Don't Swallow Errors — catching exceptions, silently filling in required but missing values... All of those are exceptions that should be thrown so that the errors can be seen."* The `boundary()` pattern exists exactly for this purpose but isn't used here.

**Fix:**

```typescript
ws.on("error", (err) => {
    log.warn("ws.client", "client error", { error: String(err) });
});
wss.on("error", (err) => {
    log.error("wss", err);
});
```

---

### H-2. Synchronous file I/O in logger blocks the event loop

**File:** `pi-socket/src/log.ts`, `write()` using `fs.appendFileSync`
**Violates:** Write for Maintainability, Scalability

`fs.appendFileSync` blocks the Node event loop. This is called on every `log.info` — every connection, every broadcast event. Under load, this creates back-pressure that slows WebSocket delivery.

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
            flushScheduled = false;
            const batch = buffer.join("");
            buffer = [];
            fs.appendFile(LOG_FILE, batch, () => {});
        });
    }
}
```

---

### H-3. WebSocket key generation is not random

**File:** `hypivisor/src/main.rs`, `base64_ws_key()`
**Violates:** Clear Abstractions & Contracts

```rust
let seed = SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).unwrap().as_nanos();
```

The WebSocket RFC 6455 §4.1 requires a "randomly selected" 16-byte value. This uses nanosecond timestamp with low entropy (`>> (i * 4)` shift pattern). Two proxy connections in the same nanosecond produce identical keys. Also includes a hand-rolled base64 encoder.

**Fix:** Use `getrandom` + `base64` crates, or at minimum mix in PID and a counter.

---

### H-4. `safeSerialize` swallows serialization failures without logging

**File:** `pi-socket/src/index.ts`, `safeSerialize()`
**Violates:** Don't Swallow Errors, Observability & Testability

```typescript
} catch {
    return '{"type":"error","message":"non-serializable event"}';
}
```

When serialization fails completely, no log entry, no `needsHardening` flag. The hardening system can never detect this class of failure.

**Fix:** Add `log.error("safeSerialize", err)` in the final catch.

---

### H-5. Proxy read buffer has no size limit

**File:** `hypivisor/src/main.rs`, `ws_read()`
**Violates:** Eliminate Race Conditions, Scalability

```rust
read_buf.extend_from_slice(&tmp[..n]);
```

`read_buf` grows without bound. A client sending an incomplete frame indefinitely causes unbounded memory growth per connection thread.

**Fix:** Add `const MAX_READ_BUF: usize = 16 * 1024 * 1024;` and check `read_buf.len()`.

---

## Medium (tech debt / maintainability)

### M-1. `NodeInfo.status` is a String, not an enum

**File:** `hypivisor/src/state.rs`
**Violates:** Prefer Non-Nullable Variables, Clear Abstractions

```rust
pub status: String,
```

Status is compared with string literals (`"active"`, `"offline"`) throughout. A typo compiles silently.

**Fix:**

```rust
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum NodeStatus { Active, Offline }
```

---

### M-2. No test for history truncation path

**File:** `pi-socket/src/history.test.ts`
**Violates:** TDD, Observability & Testability

The 500KB truncation code path in `buildInitState` is completely untested. The only mention of `truncated` in the test file asserts it's `undefined`. A test would have caught the O(n²) bug in C-2.

---

### M-3. `rpc.ts` pendingRequests is a module-level global singleton

**File:** `pi-de/src/rpc.ts`
**Violates:** Low Coupling, Separation of Concerns

```typescript
export const pendingRequests = new Map<string, PendingRequest>();
```

If reused across multiple WebSocket connections, responses could be routed to wrong promises. The `export` signals reuse intent.

**Fix:** Return a scoped client from a factory function.

---

### M-4. `RemoteAgent.prompt()` drops array content silently

**File:** `pi-de/src/RemoteAgent.ts`, `prompt()`
**Violates:** Clear Abstractions & Contracts

```typescript
const text = typeof message === "string" ? message : (message as UserMessage).content;
if (typeof text === "string") {
    this.ws.send(text);
}
```

`UserMessage.content` can be `string | (TextContent | ImageContent)[]`. When it's an array, `typeof text === "string"` is false and the message is silently dropped. The user sees their message appear to send, but nothing arrives at the agent.

**Fix:** Extract text from array content:

```typescript
if (Array.isArray(content)) {
    text = content.filter((c): c is TextContent => c.type === "text")
        .map(c => c.text).join("\n");
}
```

---

### M-5. `useHypivisor` reconnect timer can fire multiple times

**File:** `pi-de/src/useHypivisor.ts`
**Violates:** Eliminate Race Conditions

```typescript
ws.onclose = () => {
    setStatus("disconnected");
    reconnectTimer = setTimeout(connect, 5000);
};
```

If `onclose` fires multiple times during error cascades, each call creates a new timer but only the last reference is stored. Earlier timers fire, creating duplicate connections.

**Fix:** Add `clearTimeout(reconnectTimer)` before the `setTimeout`.

---

### M-6. `useAgent` double-parses every WebSocket message

**File:** `pi-de/src/useAgent.ts`
**Violates:** DRY

Both `useAgent`'s `ws.onmessage` and `RemoteAgent.connect(ws)` add message listeners that `JSON.parse` every message. During LLM streaming, every `delta` event is parsed twice — doubling GC pressure.

**Fix:** Remove the hook's `onmessage` handler. Have RemoteAgent expose a callback for `init_state` truncation state.

---

### M-7. Spawned pi process is orphaned (no lifecycle tracking)

**File:** `hypivisor/src/spawn.rs`
**Violates:** Observability & Testability

```rust
Command::new("pi").current_dir(&canonical).spawn().map_err(...)?;
```

The `Child` handle is immediately dropped. No way to know if the process started successfully. At minimum, log the PID. Ideally, retain the handle and check `try_wait()` in the cleanup loop.

---

### M-8. `main.rs` is 616 lines — SRP violation

**File:** `hypivisor/src/main.rs`
**Violates:** SRP, Separation of Concerns

`main.rs` contains: CLI argument parsing, TCP listener, HTTP parsing, WebSocket upgrade, WebSocket frame reading, WsWriter struct, registry handler, proxy handler, base64 encoding, and the main function. That's at least 5 distinct responsibilities.

**Fix:** Extract into modules:
- `ws.rs` — `WsWriter`, `ReadResult`, `ws_read()`, `upgrade_websocket()`
- `proxy.rs` — `handle_proxy_ws()`, `base64_ws_key()`
- `registry.rs` — `handle_registry_ws()`

This would bring `main.rs` down to ~80 lines (CLI + listener + routing).

---

### M-9. `handle_proxy_ws` doesn't validate WebSocket upgrade response

**File:** `hypivisor/src/main.rs`, proxy handshake to agent

```rust
let _ = agent_stream.read(&mut resp_buf);
// Accept any 101 response — the agent is a local trusted server
```

The comment acknowledges this, but the response isn't even checked for status code 101. If the agent process has crashed and another service is on that port, the proxy silently forwards garbage. At minimum check for "101" in the response.

---

### M-10. `catch (e: any)` in SpawnModal

**File:** `pi-de/src/SpawnModal.tsx`, lines 27 and 55
**Violates:** Clear Abstractions, TypeScript best practices

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

## Low (style / minor improvements)

### L-1. Missing `boundary()` on `ws.on("close")` in client handler

**File:** `pi-socket/src/index.ts`
**Violates:** Self-Hardening Architecture

```typescript
ws.on("close", () => {
    log.info("pi-socket", "client disconnected");
});
```

Per the AGENTS.md, all Node event-loop callbacks should be wrapped with `boundary()`. If `log.info` throws (unlikely but possible if fs is broken), the pi process crashes.

---

### L-2. Token in URL query string is visible in logs/devtools

**File:** System-wide design choice
**Violates:** Observability (token leaks)

The auth token `?token=SECRET` appears in tracing output, browser Network tab, and proxy access logs. Acknowledged in the design doc as acceptable for local/VPN use, but worth noting for future improvement (WebSocket subprotocol or first-message auth).

---

### L-3. `patchLit.ts` is a maintenance risk

**File:** `pi-de/src/patchLit.ts`
**Violates:** KISS, Write for Maintainability

This monkey-patches Lit's `ReactiveElement.performUpdate` by walking the prototype chain. Works today but silently breaks if Lit changes internals. Has excellent comments explaining *why*.

**Fix:** Add a version guard:

```typescript
const version = (Base as any).version;
if (version && !version.startsWith("3.")) {
    console.warn("[patchLit] Unexpected Lit version:", version);
}
```

---

### L-4. `handleGoUp` path manipulation assumes Unix paths

**File:** `pi-de/src/SpawnModal.tsx`

```typescript
const parts = currentPath.split("/").filter(Boolean);
```

Assumes Unix paths. On Windows, `canonicalize()` returns `C:\Users\...` with backslashes.

---

### L-5. Cleanup thread uses `std::thread::sleep` polling

**File:** `hypivisor/src/main.rs`

```rust
std::thread::spawn(move || loop {
    std::thread::sleep(Duration::from_secs(60));
    cleanup::cleanup_stale_nodes(&cx, &cleanup_state);
});
```

Per AGENTS.md: "Prefer Async Notifications when possible over inefficient polling." A timer-based approach using asupersync's runtime would be more idiomatic. Low priority since the 60s interval is reasonable.

---

### L-6. `pi-socket/AGENTS.md` event catalog is stale

**File:** `pi-socket/AGENTS.md`

The event catalog still lists decomposed events (`delta`, `thinking_delta`, `toolcall_start`, etc.) but the current implementation forwards native pi events (`message_start`, `message_update`, `message_end`, `tool_execution_start`, `tool_execution_end`). The code changed in commit `7a4e090` but the docs weren't updated.

---

### L-7. `hyper-pi-protocol` `RpcRequest.id` is `string` but hypivisor uses `Option<String>`

**File:** `hyper-pi-protocol/src/index.ts` vs `hypivisor/src/rpc.rs`

Protocol package declares `id: string` (required), but the Rust side has `id: Option<String>` (optional, per JSON-RPC spec). This mismatch means the TypeScript type is stricter than the wire format — not a bug, but a leaky abstraction.

---

## Summary Table

| ID | Severity | Component | Issue |
|----|----------|-----------|-------|
| C-1 | **Critical** | hypivisor | Proxy hardcodes `127.0.0.1` — multi-machine broken |
| C-2 | **Critical** | pi-socket | O(n²) truncation loop can freeze pi process |
| C-3 | **Critical** | Pi-DE | SpawnModal double-fetching on navigation |
| H-1 | **High** | pi-socket | WebSocket errors silently swallowed |
| H-2 | **High** | pi-socket | Sync file I/O in logger blocks event loop |
| H-3 | **High** | hypivisor | WebSocket key not random (time-based) |
| H-4 | **High** | pi-socket | `safeSerialize` swallows failures without logging |
| H-5 | **High** | hypivisor | Proxy read buffer has no size limit |
| M-1 | Medium | hypivisor | `NodeInfo.status` is String, not enum |
| M-2 | Medium | pi-socket | No test for truncation path |
| M-3 | Medium | Pi-DE | `rpc.ts` global pending map |
| M-4 | Medium | Pi-DE | `RemoteAgent.prompt()` drops array content |
| M-5 | Medium | Pi-DE | Reconnect timer can leak |
| M-6 | Medium | Pi-DE | Double JSON.parse on every WebSocket message |
| M-7 | Medium | hypivisor | Spawned process has no lifecycle tracking |
| M-8 | Medium | hypivisor | `main.rs` is 616 lines — multiple responsibilities |
| M-9 | Medium | hypivisor | Proxy doesn't validate agent's 101 response |
| M-10 | Medium | Pi-DE | `catch (e: any)` instead of `unknown` |
| L-1 | Low | pi-socket | Missing `boundary()` on `ws.on("close")` |
| L-2 | Low | system | Token visible in URL query string |
| L-3 | Low | Pi-DE | `patchLit.ts` fragile to Lit version changes |
| L-4 | Low | Pi-DE | `handleGoUp` assumes Unix paths |
| L-5 | Low | hypivisor | Cleanup thread uses polling instead of async timer |
| L-6 | Low | pi-socket | AGENTS.md event catalog is stale |
| L-7 | Low | protocol | `RpcRequest.id` nullability mismatch TS vs Rust |

---

## What's Done Well

1. **Error architecture** — The two-layer pattern (inner known-error handling + outer `boundary()` catch-all with `needsHardening` flags) is production-quality. The structured JSONL log with hardening skill integration is a genuinely good idea.

2. **Module decomposition** — Both the Rust hypivisor (auth, cleanup, fs_browser, spawn, rpc, state) and the TypeScript projects have clean separation of concerns. Each file has a single responsibility.

3. **Shared protocol package** — `hyper-pi-protocol` is a proper single source of truth for wire types. Both pi-socket and pi-de import from it instead of maintaining duplicates. This is DRY done right.

4. **RemoteAgent duck-typing** — Making `RemoteAgent` satisfy pi-web-ui's `Agent` interface by forwarding native pi events directly (no reconstruction) is elegant and correct. The test coverage for event state transitions is thorough.

5. **Integration test quality** — The `integration-tests/` suite starts a real hypivisor binary, simulates agents and dashboards, and verifies the full event flow end-to-end. The `BufferedWs` helper handles the async race condition correctly. The proxy relay tests cover bidirectional forwarding.

6. **Stale node eviction** — The logic that evicts prior registrations with the same `machine:port` handles session switches correctly. The TTL-based cleanup with configurable `--node-ttl` flag is well-designed.

7. **Wire protocol simplicity** — Simplified JSON-RPC + plain text user messages keeps the protocol debuggable with `wscat` or browser dev tools.

8. **Resilience by design** — pi-socket's reconnection with exponential backoff (capped at 5 minutes), the `hypivisorUrlValid` flag to avoid retrying invalid URLs, and the `readyState` guards before `ws.send()` are all correct defensive patterns.
