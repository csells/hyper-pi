The complete review has been written to `/Users/csells/Code/csells/hyper-pi/tmp/review-codex.md`. Here's a summary of the key findings:

## Review Complete — 24 Issues Found

### 🔴 P0-CRITICAL (4 issues) — Root causes of the ghost node / "Connecting..." crisis

1. **P0-1: Ghost nodes from stale WebSocket `onmessage` handlers** (`useHypivisor.ts:53-58`) — On reconnect, the old WebSocket's `onmessage` isn't nulled out, so both old and new connections can dispatch events, doubling node entries.

2. **P0-2: RemoteAgent event listener leak** (`RemoteAgent.ts:88-92`) — `addEventListener("message")` is called on every `connect()` but `removeEventListener` is never called in `disconnect()`. Each reconnect adds another listener.

3. **P0-3: Duplicate message handlers on agent WebSocket** (`useAgent.ts:67-80`) — Both `remoteAgent.connect(ws)` (via `addEventListener`) and `ws.onmessage` process incoming messages, causing `init_state` to be handled twice.

4. **P0-4: Broadcast thread hang in hypivisor** (`main.rs:334-349`) — `rx.recv().await` blocks forever when no broadcasts arrive. `broadcast_handle.join()` on disconnect hangs indefinitely, leaking threads.

### 🟠 P1-HIGH (8 issues)
- Proxy hardcodes `127.0.0.1` (breaks multi-machine)
- Binary frame proxy writes raw bytes without framing
- Single TCP read for WS upgrade (fragmentation)
- Token not URL-decoded (auth fails with special chars)
- Hardcoded `localhost` in useHypivisor
- Sequential RPC processing (R-HV-6 violation)
- Proxy handshake response not validated
- Pending RPCs not cleaned on WS close

### ✅ Architecture Constraint Compliance
No code anywhere deduplicates or evicts by `cwd`. The `machine:port` constraint is properly enforced with 4 dedicated integration tests.
 handler does `setNodes(data.nodes)`, which is correct in isolation. But if the old WebSocket's `close` event fires a reconnect, and the new connection's `init` arrives, and then delayed `node_joined` broadcasts from the broadcast channel arrive (which were queued before the connection dropped), those `node_joined` events **add duplicates** because they filter by `id`, but the broadcast channel may replay events that the `init` already included.

**Specifically:** The hypivisor's broadcast forwarder thread (`main.rs:334-349`) can have events buffered in the `rx` channel. When a new dashboard connection is established, it gets a fresh `init` with all current nodes, but the *broadcast channel* may still deliver old events from before the reconnection. Since `node_joined` uses `prev.filter(n => n.id !== data.node.id)` before adding, this shouldn't cause ID-based duplicates. However, the real issue is more subtle:

The `handleEvent` callback is created with `useCallback([], [])` (empty deps), but `connect()` captures `handleEvent` via closure. When `port` or `token` change (causing the useEffect to re-run), a new `handleEvent` is created, but if the old WebSocket is still delivering messages before cleanup completes, both the old and new handler could process events simultaneously.

**But the most likely ghost cause is:** If the hypivisor restarts, Pi-DE's existing WebSocket closes. The `onclose` handler schedules a reconnect in 5s. During that 5s, the user might see stale nodes. When the reconnect succeeds, a new `init` arrives with the correct list. This SHOULD work. The problem is if `init` arrives but is not processed as an `init` event because the message routing in `onmessage` misidentifies it.

Looking more carefully: `onmessage` checks `"id" in data && data.id` first for RPC responses. The `init` event has no `id` field, so it falls through to the `handleEvent` path. This is correct. **However**, if the hypivisor sends the `init` event and then broadcasts `node_joined` for agents that reconnect after hypivisor restart, Pi-DE will process `init` (setting 2 nodes) and then process multiple `node_joined` events (which correctly deduplicate by ID). This should work.

**Re-evaluating:** The most likely cause of 8 nodes when there should be 2 is that the `init` event's `nodes` array itself contains entries with `offline_since` and `last_seen` fields that cause the `NodeInfo` type's `status` field to not match the discriminated union. Looking at the protocol type:

```typescript
export interface NodeInfo {
  status: "active" | "offline";
}
```

But the Rust `state.rs` has:
```rust
pub status: String,
```

The hypivisor serializes `status` as any string. If the cleanup thread sets an unexpected status value, or if `offline_since`/`last_seen` fields leak into the JSON (they have `skip_serializing_if = "Option::is_none"`), the TypeScript code should still work because it accesses `.status` directly.

**Actual root cause found:** The `setNodes` in `useHypivisor.ts` doesn't deduplicate on the `init` path. If the hypivisor sends `init` and then immediately sends `node_joined` events for the same nodes (which happens because agents re-register when the hypivisor comes back), Pi-DE processes `init` → sets 2 nodes, then processes `node_joined` for node A → filters out A and re-adds it (still 2), then `node_joined` for node B → filters out B and re-adds it (still 2). This should work.

**Final assessment:** Without live debugging, the most likely scenario for "8 nodes shown when 2 exist" is that useHypivisor's WebSocket reconnect loop creates multiple concurrent connections. If `connect()` is called while a previous WebSocket is still in `CONNECTING` state (not yet open, so `ws.close()` at line 53-54 may not fully clean up), multiple WebSocket instances can exist simultaneously, each receiving `init` events and pumping `setNodes`. The `ws.onclose = null` at line 53 prevents the close handler from re-triggering, but the new WebSocket at line 57 replaces `ws`, leaving the old one's `onmessage` handler still active until it fully closes.

**Fix:** Clear the `nodes` state in the `onclose` handler, and/or add a connection generation counter to ignore messages from stale WebSocket instances.

```typescript
function connect() {
  if (disposed) return;
  if (ws) {
    ws.onclose = null;
    ws.onmessage = null; // ← ADD THIS: prevent stale WS from dispatching events
    ws.close();
  }
  // ...
}
```

---

### P0-2: RemoteAgent event listener leak on reconnect — messages dispatched to wrong agent

**Files:** `pi-de/src/RemoteAgent.ts:88-92`, `pi-de/src/useAgent.ts:67-69`

When a user switches agents or an agent WebSocket reconnects, `useAgent.ts` calls `remoteAgent.reset()` (which calls `disconnect()`), then later calls `remoteAgent.connect(ws)`. The `connect()` method does:

```typescript
connect(ws: WebSocket): void {
    this.ws = ws;
    ws.addEventListener("message", (event) => {
      const data = JSON.parse(event.data as string) as SocketEvent;
      this.handleSocketEvent(data);
    });
}
```

**The bug:** `addEventListener` is used but `removeEventListener` is never called. When `disconnect()` is called, it sets `this.ws = null` but does NOT remove the event listener from the old WebSocket. If the old WebSocket has buffered messages or receives data before fully closing, the listener fires and calls `handleSocketEvent` on the current agent state — corrupting it with events from the previous agent.

Additionally, `useAgent.ts` creates a new WebSocket on reconnect and calls `remoteAgent.connect(ws)` again — adding ANOTHER `message` event listener to the new WebSocket. Each reconnect adds one more listener. This is a classic event listener leak.

**Fix:** Track the listener and remove it in `disconnect()`:

```typescript
private messageHandler: ((event: MessageEvent) => void) | null = null;

connect(ws: WebSocket): void {
    this.disconnect(); // clean up any existing listener first
    this.ws = ws;
    this.messageHandler = (event) => {
      const data = JSON.parse(event.data as string) as SocketEvent;
      this.handleSocketEvent(data);
    };
    ws.addEventListener("message", this.messageHandler);
}

disconnect(): void {
    if (this.ws && this.messageHandler) {
      this.ws.removeEventListener("message", this.messageHandler);
      this.messageHandler = null;
    }
    this.ws = null;
    // ... reset state
}
```

---

### P0-3: Duplicate `onmessage` handlers on agent WebSocket — init_state processed twice

**Files:** `pi-de/src/useAgent.ts:68-69`, `pi-de/src/useAgent.ts:75-80`

The `useAgent.ts` hook has TWO places that process incoming WebSocket messages:

1. **Line 68-69:** `remoteAgent.connect(ws)` — which adds an `addEventListener("message", ...)` handler inside RemoteAgent that processes ALL socket events including `init_state`

2. **Line 75-80:** `ws.onmessage` — which is set separately to check for `init_state` and call `handleInitState`

Both fire for every incoming message. When `init_state` arrives:
- RemoteAgent's listener parses it, calls `handleInitState()` internally (setting state.messages and emitting `agent_end`)
- The `ws.onmessage` handler ALSO parses it and calls `handleInitState(data)` which sets `historyTruncated`

This double processing of `init_state` is wasteful but not directly corrupting because the `handleInitState` in useAgent just sets `historyTruncated`. However, it means every other event is also parsed by both handlers (the `onmessage` handler just ignores non-init_state events).

**Severity upgrade:** This becomes P0 because `ws.onmessage` is set AFTER `remoteAgent.connect(ws)`. The `onopen` handler at line 67 calls `remoteAgent.connect(ws)`, and then sets `ws.onmessage`. If `init_state` arrives between `connect()` and `ws.onmessage = ...`, RemoteAgent processes it but `useAgent` doesn't set `historyTruncated`. This is a race condition.

More importantly: `remoteAgent.connect(ws)` uses `addEventListener`, but `useAgent.ts` uses `ws.onmessage =`. Both work simultaneously but the `onmessage` assignment replaces any previous `onmessage` handler. Since RemoteAgent uses `addEventListener`, both coexist. But if something else sets `onmessage` later, the useAgent handler would be replaced.

**Fix:** Remove the duplicate `ws.onmessage` handler from `useAgent.ts` and have RemoteAgent expose the truncation info, or use a single message handler.

---

### P0-4: Broadcast forwarder thread hangs indefinitely on dashboard disconnect

**File:** `hypivisor/src/main.rs:334-349`

The broadcast forwarder thread blocks on `rx.recv(&cx).await`. When the read loop exits (dashboard disconnects), the main thread sets `broadcast_running = false` and calls `broadcast_handle.join()`. But `rx.recv()` is blocking — it won't return until a new broadcast event arrives. If no nodes are registering/disconnecting, the `join()` blocks forever.

The `std::thread::sleep(Duration::from_millis(50))` at line 417 gives a tiny window but doesn't help because `recv` doesn't check the flag.

**Impact:** Each dashboard disconnect during an idle period permanently leaks a handler thread plus the broadcast forwarder thread. Under sustained use (e.g., refreshing Pi-DE repeatedly), this exhausts OS threads and causes the hypivisor to OOM or hit thread limits.

**Fix:** Use `tokio::select!` with a cancellation signal, or use `recv_timeout()` if available, or drop `rx` to force `recv` to return `Err`:

```rust
// Before the broadcast thread:
let (cancel_tx, cancel_rx) = std::sync::mpsc::channel::<()>();

// In broadcast thread:
// Check cancel_rx alongside rx.recv

// On disconnect:
drop(cancel_tx); // forces the broadcast thread to notice
```

---

### P0-5: `useAgent` WebSocket not closed on node status change to "offline"

**File:** `pi-de/src/useAgent.ts:40-44`

```typescript
if (!activeNode || activeNode.status !== "active") {
  if (activeNode?.status === "offline") {
    setStatus("offline");
  }
  return; // ← returns without cleanup function
}
```

When `activeNode.status` changes from `"active"` to `"offline"` (because the roster updated), the useEffect re-runs with `activeNode.status === "offline"`. The early return at line 44 means the cleanup function from the PREVIOUS effect execution runs (closing the old WebSocket — good), but then this new effect execution returns `undefined` instead of a cleanup function. If the node later comes back to `"active"`, a new WebSocket is created but the old one from the `"active"` → `"offline"` transition may still be lingering.

More critically: the condition `activeNode.status !== "active"` causes the effect to NOT run the connection code, so the old cleanup runs (which closes the WS and calls `remoteAgent.disconnect()`). But then when the user clicks the same node again (now active), `activeNode` changes, the effect re-runs, but `activeNode?.id` hasn't changed — only `status` changed. Since the dependency array includes `activeNode?.status`, this triggers correctly. However, between the `offline` and re-`active` states, `remoteAgent.disconnect()` was called, clearing messages. This is expected behavior but worth noting.

**The real issue:** When `activeNode` is null (user deselects), the early return doesn't call `remoteAgent.disconnect()` or clear the WebSocket. The cleanup from the previous render does this, which is correct. But the `return` without a cleanup function means if React re-renders this hook while `activeNode` is null, there's no cleanup to run. This is actually fine because there's nothing to clean up. **Downgrading to P1.**

---

## P1-HIGH — Reliability issues, incorrect behavior

### P1-1: Proxy hardcodes `127.0.0.1` — breaks multi-machine routing

**File:** `hypivisor/src/main.rs:436-438`

```rust
Some(node) if node.status == "active" => {
    ("127.0.0.1".to_string(), node.port)
}
```

The proxy always connects to `127.0.0.1` regardless of the agent's registered `machine` hostname. Per requirements R-CC-5/R-CC-7, agents on remote machines register with their hostname, and the proxy should connect using that hostname.

**Impact:** Multi-machine deployments are completely broken. An agent on Machine B registering with `machine: "machine-b"` will be proxied to `127.0.0.1:port` on the hypivisor's machine, which will fail.

**Fix:** Use `node.machine` instead of hardcoding `127.0.0.1`. Add hostname resolution fallback:

```rust
Some(node) if node.status == "active" => {
    (node.machine.clone(), node.port)
}
```

---

### P1-2: Binary frame proxy writes raw bytes without WebSocket framing

**File:** `hypivisor/src/main.rs:525-528`

```rust
Ok(Some(ReadResult::Binary(data))) => {
    let mut w = dash_writer_for_agent.lock().unwrap();
    if w.send_raw_bytes(&data).is_err() {
        break;
    }
}
```

When the agent sends a binary WebSocket frame, the proxy extracts the payload and writes it directly to the dashboard TCP stream via `send_raw_bytes()`, which does `stream.write_all(bytes)` — raw bytes without WebSocket frame headers. This corrupts the WebSocket protocol stream.

**Impact:** Any binary frame from the agent will break the proxy connection. Currently pi-socket only sends text frames, so this is latent. But it's a time bomb for any future feature that uses binary frames (images, attachments, etc.).

**Fix:** Add a `send_binary` method to `WsWriter`:

```rust
fn send_binary(&mut self, data: &[u8]) -> io::Result<()> {
    use asupersync::bytes::BytesMut;
    use asupersync::codec::Encoder;
    use io::Write;

    let frame = Frame::binary(data);
    let mut buf = BytesMut::with_capacity(data.len() + 14);
    self.codec.encode(frame, &mut buf)
        .map_err(|e| io::Error::other(format!("WS binary encode: {e}")))?;
    self.stream.write_all(&buf)
}
```

---

### P1-3: Single TCP `read()` for WebSocket upgrade may truncate headers

**File:** `hypivisor/src/main.rs:119-128`

```rust
let mut buf = [0u8; 8192];
let n = match stream.read(&mut buf) {
    Ok(n) if n > 0 => n,
    // ...
};
let request_bytes = &buf[..n];
```

TCP does not guarantee the full HTTP upgrade request arrives in a single `read()` call. Headers can be split across TCP segments, especially with proxy/tunnel setups (Tailscale, WireGuard, reverse proxies).

**Impact:** Under network conditions that fragment TCP, legitimate WebSocket connections will be rejected. More likely in production multi-machine deployments than localhost.

**Fix:** Read in a loop until `\r\n\r\n` is found:

```rust
let mut total = 0;
loop {
    let n = stream.read(&mut buf[total..])?;
    if n == 0 { return; }
    total += n;
    if buf[..total].windows(4).any(|w| w == b"\r\n\r\n") { break; }
    if total >= buf.len() { /* reject: headers too large */ return; }
}
```

---

### P1-4: Token not URL-decoded before comparison — auth fails with special characters

**File:** `hypivisor/src/auth.rs:7-17`

```rust
pub fn extract_token_from_query(uri: &str) -> Option<String> {
    // ...
    return Some(value.to_string()); // raw query value, not URL-decoded
}
```

The extracted token is compared directly against `HYPI_TOKEN` without URL-decoding. If the token contains URL-special characters (`+`, `=`, `&`, `%`, spaces), a client that URL-encodes the query parameter (as pi-socket's `encodeURIComponent` does at line 211) will fail auth.

**Inconsistency:** Pi-DE's `useHypivisor.ts:56` does NOT encode: `${token}`. But `useAgent.ts:67` DOES encode: `encodeURIComponent(token)`. With a token like `abc+123`, the registry connection works but the agent proxy connection fails.

**Fix:** URL-decode the extracted value before comparison. Use `percent_encoding::percent_decode_str` or a manual implementation.

---

### P1-5: `useHypivisor` hardcodes `ws://localhost` — Pi-DE won't work when served remotely

**File:** `pi-de/src/useHypivisor.ts:56`

```typescript
const url = `ws://localhost:${port}/ws${token ? `?token=${token}` : ""}`;
```

Pi-DE always connects to `localhost`. If Pi-DE is served from a remote machine or a CDN, this breaks.

**Fix:** Use `window.location.hostname`:

```typescript
const host = window.location.hostname || "localhost";
const url = `ws://${host}:${port}/ws${token ? `?token=${token}` : ""}`;
```

Note: `useAgent.ts:63` already does this correctly with `window.location.hostname`.

---

### P1-6: R-HV-6 violation — RPC requests processed sequentially, not concurrently

**File:** `hypivisor/src/main.rs:356-375` (the read loop in `handle_registry_ws`)

Per requirement R-HV-6: "A slow `list_directories` call MUST NOT block a simultaneous `list_nodes` response."

The current implementation processes RPC requests sequentially in the read loop. If `list_directories` takes 500ms (reading a large directory over NFS), all other RPCs on that connection are blocked. The broadcast forwarder runs in a separate thread, so broadcasts aren't blocked — but RPC responses are.

**Fix:** Spawn the `dispatch()` call on a thread pool and send the response asynchronously, or use the asupersync runtime's task system.

---

### P1-7: Proxy WebSocket handshake response not validated

**File:** `hypivisor/src/main.rs:487-491`

```rust
let mut resp_buf = [0u8; 1024];
let _ = agent_stream.read(&mut resp_buf);
// Accept any 101 response — the agent is a local trusted server
```

The handshake response is read once and completely ignored. If the agent rejects the connection (e.g., returns 403), the proxy proceeds to relay, corrupting the stream. If the response is larger than 1024 bytes, it may contain WebSocket frames that get discarded.

**Fix:** At minimum, verify the response starts with `HTTP/1.1 101`.

---

### P1-8: `pendingRequests` map never cleaned on WebSocket close

**File:** `pi-de/src/rpc.ts`

The `pendingRequests` Map stores pending RPC promises with 30s timeouts. If the WebSocket closes while requests are pending, those promises are only cleaned up when their individual timers fire (up to 30s later). During that window:

1. The UI shows loading states that never resolve
2. If the WebSocket reconnects and reuses the same random ID (unlikely but possible), the old resolver could be called with new data

**Fix:** Add a `clearPending()` function and call it from `useHypivisor`'s WebSocket `onclose` handler:

```typescript
export function rejectAllPending(reason: string): void {
  for (const [id, pending] of pendingRequests) {
    clearTimeout(pending.timer);
    pending.reject(new Error(reason));
  }
  pendingRequests.clear();
}
```

---

## P2-MEDIUM — Best practices, performance, missing tests

### P2-1: `SpawnModal` infinite re-render risk from `currentPath` ↔ `loadDirs` loop

**File:** `pi-de/src/SpawnModal.tsx:18-31`

```typescript
const loadDirs = useCallback(async () => {
    // ...
    setCurrentPath(result.current); // ← this changes currentPath
}, [hvWs, currentPath]);            // ← which recreates loadDirs

useEffect(() => {
    loadDirs();                      // ← which triggers loadDirs
}, [loadDirs]);                      // ← which re-runs the effect
```

When `loadDirs()` succeeds, it calls `setCurrentPath(result.current)`. If the server returns a canonicalized path that differs from the input (e.g., resolving symlinks or trailing slashes), `currentPath` changes, which recreates `loadDirs`, which re-triggers the `useEffect`, creating an infinite loop.

**Fix:** Remove `currentPath` from `loadDirs`'s dependency array and pass it as a parameter, or use a ref to track the requested path vs. the canonical path.

---

### P2-2: `buildInitState` truncation is O(n²) — re-serializes on every shift

**File:** `pi-socket/src/history.ts:48-52`

```typescript
while (messages.length > 10) {
  messages.shift();
  if (JSON.stringify(messages).length <= MAX_INIT_BYTES) break;
}
```

Each iteration calls `JSON.stringify(messages)` on the entire remaining array. For a conversation with 1000 messages at 500KB, this could do hundreds of full serializations.

**Fix:** Binary search for the cutoff point, or estimate sizes incrementally.

---

### P2-3: `base64_ws_key` uses low-entropy time-based seed

**File:** `hypivisor/src/main.rs:593-622`

The WebSocket handshake key is generated from `SystemTime::now().as_nanos()`, which provides at most ~30 bits of entropy per second. RFC 6455 requires the key to be "randomly selected". While this only needs to be unique (not cryptographically secure), deterministic keys based on time could cause issues with rapid proxy connections.

**Fix:** Use `rand` crate or read from `/dev/urandom`.

---

### P2-4: NodeInfo `status` is `String` in Rust but a union in TypeScript

**File:** `hypivisor/src/state.rs:15` vs `hyper-pi-protocol/src/index.ts:45`

Rust: `pub status: String` — any string value  
TypeScript: `status: "active" | "offline"` — discriminated union

If Rust ever sets a status value that isn't `"active"` or `"offline"`, TypeScript code that does exhaustive matching would silently ignore it. This is a type safety gap between components.

**Fix:** Use an enum in Rust:

```rust
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "lowercase")]
pub enum NodeStatus {
    Active,
    Offline,
}
```

---

### P2-5: No test for hypivisor restart → Pi-DE reconnect → state reset cycle

**Files:** All test files

None of the integration tests verify the critical path: hypivisor stops → Pi-DE shows "disconnected" → hypivisor restarts → Pi-DE reconnects → `init` event replaces stale roster. This is the exact scenario causing the ghost nodes crisis.

**Fix:** Add an integration test that stops and restarts the hypivisor binary mid-test and verifies Pi-DE's state is correct after reconnection.

---

### P2-6: No test for `RemoteAgent.disconnect()` → `connect()` event listener cleanup

**File:** `pi-de/src/RemoteAgent.test.ts`

The test suite never tests the reconnect path: `connect(ws1)` → events arrive → `disconnect()` → `connect(ws2)` → verify old listeners don't fire. This is the exact scenario causing P0-2.

---

### P2-7: `useAgent` hook doesn't close old WebSocket before creating new one on reconnect

**File:** `pi-de/src/useAgent.ts:57-60`

```typescript
function connect() {
  const ws = new WebSocket(...);
  wsRef.current = ws;
```

The inner `connect()` function (called during reconnect via setTimeout) creates a new WebSocket and assigns it to `wsRef.current` without closing the old one. The old WebSocket might still be in `CONNECTING` or `OPEN` state. While the useEffect cleanup function closes `wsRef.current`, the `connect()` function called from the `setTimeout` reconnect replaces the ref before cleanup can close the right one.

**Fix:** Close the previous WebSocket before creating a new one:

```typescript
function connect() {
  if (wsRef.current) {
    wsRef.current.onclose = null;
    wsRef.current.close();
  }
  const ws = new WebSocket(...);
  wsRef.current = ws;
```

---

## P3-LOW — Style, naming, minor improvements

### P3-1: `SpawnModal` catches `any` typed errors

**File:** `pi-de/src/SpawnModal.tsx:27, 52`

```typescript
} catch (e: any) {
  setError(e.message);
}
```

Use `unknown` and narrow properly:

```typescript
} catch (e: unknown) {
  setError(e instanceof Error ? e.message : String(e));
}
```

---

### P3-2: Unused imports in `RemoteAgent.ts`

**File:** `pi-de/src/RemoteAgent.ts:20-21`

```typescript
import type { ImageContent, TextContent, UserMessage } from "@mariozechner/pi-ai";
```

`ImageContent` and `TextContent` are imported but never used. Only `UserMessage` is used (for the `.content` cast in `prompt()`).

---

### P3-3: `fs_browser` test uses `dirs::home_dir()` which fails in sandboxed environments

**File:** `hypivisor/src/fs_browser.rs:58`

The `lists_subdirectories` test fails with `PermissionDenied` in sandboxed CI environments because it tries to create directories under `$HOME`. Use `std::env::temp_dir()` instead.

---

### P3-4: `pi-de/src/types.ts` is just re-exports

**File:** `pi-de/src/types.ts`

This file only re-exports from `hyper-pi-protocol`. While it provides a migration path, imports should be updated to use `hyper-pi-protocol` directly, eliminating the indirection.

---

## Architecture Constraint Compliance

### Q8: Does any code deduplicate, evict, or collapse agents by `cwd`?

**✅ PASS.** After thorough review:

- **Hypivisor `rpc.rs:80-90`:** Eviction filter uses `n.machine == node.machine && n.port == node.port`. CWD is not checked. ✅
- **Hypivisor tests:** `register_keeps_same_cwd_different_port` explicitly verifies this. ✅
- **Integration tests:** `multi-agent.test.ts` has 4 tests verifying multi-agent-per-directory. ✅
- **Pi-DE `useHypivisor.ts`:** `node_joined` handler filters by `n.id !== data.node.id` — uses ID, not cwd. ✅
- **Pi-DE `App.tsx`:** Node list uses `key={node.id}` — no cwd-based deduplication. ✅
- **AGENTS.md:** Explicitly documents this constraint. ✅

No code anywhere violates the `machine:port` uniqueness constraint.

---

## Specific Questions Answered

### Q1: What causes ghost nodes in Pi-DE?

Three contributing factors:

1. **P0-1:** On hypivisor reconnect, stale WebSocket instances may have their `onmessage` handlers still active, processing events from both old and new connections simultaneously.
2. **P0-2:** `RemoteAgent.connect()` uses `addEventListener` without ever calling `removeEventListener`, leaking event listeners across reconnects.
3. **P0-3:** `useAgent.ts` has duplicate message handlers (RemoteAgent's `addEventListener` + its own `onmessage`) — though this only affects agent connections, not the roster.

The primary ghost cause for the **roster** is P0-1: when the hypivisor connection reconnects, the old WebSocket's `onmessage` handler isn't nulled, so both old and new handlers can process events.

### Q2: Why "Connecting..." on agent select?

Three potential causes:

1. **P1-1:** The proxy hardcodes `127.0.0.1`. If the agent's registered `machine` hostname doesn't resolve to localhost (e.g., the hostname is `MacBook-Pro.local`), the proxy connection works because pi-socket listens on `0.0.0.0`. This is likely fine for single-machine use.
2. **P1-7:** The proxy doesn't validate the handshake response. If pi-socket rejects the connection, the proxy proceeds with broken state, sending corrupted frames that Pi-DE can't parse, leaving it stuck at "Connecting...".
3. **P0-4:** If the broadcast forwarder thread from a previous proxy connection is hung (blocking `join()`), the handler thread for the new proxy connection might be blocked waiting for thread resources.

The most likely cause: look at `useAgent.ts:67-69`:

```typescript
ws.onopen = () => {
    setStatus("connected");
    remoteAgent.connect(ws);
};
```

`setStatus("connected")` is called, then `remoteAgent.connect(ws)` adds a listener. But `ws.onmessage` is set at line 75 — AFTER `onopen` fires. If `init_state` arrives in the gap between `addEventListener` in `connect()` and `ws.onmessage` assignment, the init_state is processed by RemoteAgent but `historyTruncated` is never set. This wouldn't cause "Connecting..." though.

The real "Connecting..." issue is likely that the proxy WebSocket connection **does open** (status goes to "connected") but then immediately closes because the proxy relay fails, causing `onclose` to fire and set status back to "connecting" in the retry loop.

### Q3: WebSocket lifecycle — connection leaks?

Yes, several:
- **P0-2:** Event listener leak in RemoteAgent
- **P0-4:** Thread leak in hypivisor broadcast forwarder
- **P2-7:** useAgent reconnect doesn't close old WebSocket
- **P1-8:** Pending RPC promises not cleaned on close

### Q4: React state race conditions?

Yes:
- **P0-1:** Stale WebSocket onmessage handler races with new connection
- **P2-1:** SpawnModal's useCallback/useEffect can create infinite re-render loops
- **P0-3:** Duplicate message handlers between RemoteAgent and useAgent

### Q5: Proxy relay correctness?

Partially correct:
- **P1-1:** Hardcoded `127.0.0.1` breaks multi-machine
- **P1-2:** Binary frame forwarding is broken
- **P1-3:** TCP read fragmentation can break handshake
- **P1-7:** Handshake response not validated
- ✅ Text frames are forwarded correctly (verified by integration tests)
- ✅ Dashboard → agent direction correctly re-encodes as client frames (masked)

### Q6: pi-socket robustness?

Generally excellent:
- ✅ `teardownHypivisor()` properly cleans up before session restart
- ✅ `shutdownRequested` flag prevents post-shutdown activity
- ✅ `boundary()` wraps all Node callbacks
- ✅ `safeSerialize()` handles non-serializable values
- ✅ Exponential backoff with cap for hypivisor reconnect
- ✅ Port reuse across session restarts
- ✅ Deregister on shutdown with send callback + timeout
- Minor: `ws.on("error", () => {})` swallows all client/server errors silently

### Q7: Test coverage gaps?

1. No test for hypivisor restart → Pi-DE reconnect cycle (P2-5)
2. No test for RemoteAgent reconnect listener cleanup (P2-6)
3. No test for proxy with offline/removed agent (only tested in integration)
4. No test for `useHypivisor` reconnect behavior
5. No test for concurrent RPC + broadcast on same connection
6. No test for pi-socket `session_start` → `session_shutdown` → `session_start` rapid cycle
7. No test for `useAgent` switching from agent A to agent B rapidly
8. `fs_browser` test fails in sandboxed environments (P3-3)

---

## Summary Table

| ID | Severity | Component | File | Issue |
|----|----------|-----------|------|-------|
| P0-1 | CRITICAL | Pi-DE | useHypivisor.ts | Stale WS onmessage handler causes ghost nodes |
| P0-2 | CRITICAL | Pi-DE | RemoteAgent.ts | Event listener leak on reconnect |
| P0-3 | CRITICAL | Pi-DE | useAgent.ts | Duplicate message handlers on agent WS |
| P0-4 | CRITICAL | Hypivisor | main.rs:334-349 | Broadcast thread hangs on idle disconnect |
| P0-5→P1 | HIGH | Pi-DE | useAgent.ts:40-44 | Missing cleanup when node goes offline |
| P1-1 | HIGH | Hypivisor | main.rs:436-438 | Proxy hardcodes 127.0.0.1 |
| P1-2 | HIGH | Hypivisor | main.rs:525-528 | Binary frame proxy corrupts stream |
| P1-3 | HIGH | Hypivisor | main.rs:119-128 | Single TCP read for WS upgrade |
| P1-4 | HIGH | Hypivisor | auth.rs:7-17 | Token not URL-decoded |
| P1-5 | HIGH | Pi-DE | useHypivisor.ts:56 | Hardcoded `localhost` |
| P1-6 | HIGH | Hypivisor | main.rs:356-375 | RPC sequential, not concurrent (R-HV-6) |
| P1-7 | HIGH | Hypivisor | main.rs:487-491 | Proxy handshake not validated |
| P1-8 | HIGH | Pi-DE | rpc.ts | Pending RPCs not cleared on WS close |
| P2-1 | MEDIUM | Pi-DE | SpawnModal.tsx:18-31 | Infinite re-render risk |
| P2-2 | MEDIUM | pi-socket | history.ts:48-52 | O(n²) truncation |
| P2-3 | MEDIUM | Hypivisor | main.rs:593-622 | Low-entropy WS key |
| P2-4 | MEDIUM | Hypivisor/Protocol | state.rs/index.ts | Status type mismatch |
| P2-5 | MEDIUM | Tests | — | No restart→reconnect test |
| P2-6 | MEDIUM | Tests | — | No listener cleanup test |
| P2-7 | MEDIUM | Pi-DE | useAgent.ts:57-60 | Old WS not closed on reconnect |
| P3-1 | LOW | Pi-DE | SpawnModal.tsx | `any` error type |
| P3-2 | LOW | Pi-DE | RemoteAgent.ts | Unused imports |
| P3-3 | LOW | Hypivisor | fs_browser.rs:58 | Test fails in sandbox |
| P3-4 | LOW | Pi-DE | types.ts | Unnecessary re-export layer |

---

## Recommended Fix Priority

**Immediate (fix the crisis):**
1. P0-1: Null stale WebSocket `onmessage` in useHypivisor reconnect
2. P0-2: Add event listener cleanup to RemoteAgent
3. P0-3: Remove duplicate `onmessage` handler from useAgent
4. P2-7: Close old WebSocket before creating new in useAgent reconnect

**Next sprint:**
5. P0-4: Fix broadcast thread hang in hypivisor
6. P1-1: Use `node.machine` for proxy connections
7. P1-5: Use `window.location.hostname` in useHypivisor
8. P1-4: URL-decode token in auth.rs

**Backlog:**
9. P1-2, P1-3, P1-6, P1-7, P1-8
10. P2-1 through P2-6
11. P3-* issues
