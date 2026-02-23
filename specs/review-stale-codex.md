The complete analysis is written to `specs/review-stale-codex.md`. Here's the key findings:

## 6 Root Causes Found

### 🔴 Root Cause 1 (CRITICAL — the #1 ghost factory)
**pi-socket `session_start` leaks old hypivisor connection.** When pi resets its session, the handler closes the old WSS but does NOT close the old `hypivisorWs` or cancel the pending reconnect timer. The old connection and its `close`→`scheduleReconnect` chain keep running, creating duplicate registrations and orphaned nodes.

### 🔴 Root Cause 3 (HIGH — makes deduplication useless)
**Session ID changes on every restart.** `ctx.sessionManager.getSessionId()` returns a new UUID each time. The hypivisor's machine:port eviction only works when the new process gets the **same port**. If portfinder picks a different port (old one in TIME_WAIT), the old ghost survives — there's nothing to evict it.

### 🟡 Root Cause 2 (HIGH) — SIGKILL leaves ghost for 120-180s
### 🟡 Root Cause 4 (MEDIUM) — Cleanup runs every 60s with 120s TTL = 180s worst case
### 🟡 Root Cause 5 (HIGH) — No ping/pong heartbeat detects half-open TCP
### 🟡 Root Cause 6 (MEDIUM) — `deregister` is fire-and-forget, may not flush before close

## The Two P0 Fixes That Eliminate >90% of Ghosts

1. **pi-socket:** Close old `hypivisorWs` + cancel reconnect timer in `session_start` before creating a new connection
2. **hypivisor:** Add `cwd`-based eviction — when a node registers on the same `machine + cwd`, evict ALL prior registrations for that combo (regardless of port or ID)
om `scheduleReconnect`

### What happens

```
Time 0:  session_start #1 → nodeId="aaa", connectToHypivisor → registers "aaa"
Time 1:  session reset → session_start #2 → nodeId="bbb"
         - old hypivisorWs is still open (or its reconnect timer is pending)
         - connectToHypivisor creates a NEW ws, sets hypivisorWs = newWs
         - newWs.open → registers "bbb" ✅
         - BUT: oldWs is still connected to the hypivisor
         - When oldWs eventually drops, the hypivisor marks "aaa" offline
         - "aaa" was never deregistered → waits 120s in "offline" state
         - If the old reconnect timer fires AFTER nodeId changed to "bbb":
           - scheduleReconnect calls connectToHypivisor(port)
           - open handler sends register with nodeId = "bbb" (current value)
           - This creates a SECOND WebSocket connection registering "bbb"
           - When the first WS for "bbb" closes → marks "bbb" offline
           - But the second WS for "bbb" still shows it active
           - Now there are multiple WS connections tracking the same node
```

The old reconnect timer captures `port` by value but reads `nodeId` by closure — it's a **stale closure** on the port, but a **shared mutable** on the nodeId. This creates an unpredictable mess.

### Even worse: the old hypivisor WS `close` handler fires

When `session_start` #2 calls `connectToHypivisor`, the old `hypivisorWs` reference is overwritten. But the old WebSocket object is still alive and has a `close` event handler that calls `scheduleReconnect(port)`. When the old connection eventually closes (TCP timeout, hypivisor drop, etc.), it triggers yet another reconnect loop — with the *old* port value from when that closure was created.

### The fix

Close the old hypivisor WebSocket and cancel any pending reconnect timer before starting a new connection:

```typescript
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

pi.on("session_start", async (_event, ctx) => {
    nodeId = ctx.sessionManager.getSessionId();

    // Close previous WSS
    if (wss) {
      wss.close();
      wss = null;
    }

    // ── NEW: Close previous hypivisor connection and cancel reconnect ──
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (hypivisorWs) {
      // Remove close handler BEFORE closing to prevent triggering scheduleReconnect
      hypivisorWs.removeAllListeners("close");
      hypivisorWs.close();
      hypivisorWs = null;
    }
    hypivisorConnected = false;
    reconnectDelay = 0;

    const port = wssPort ?? (await portfinder.getPortPromise({ port: startPort }));
    wss = new WebSocketServer({ port });
    wssPort = port;
    // ...
    connectToHypivisor(port);
});
```

And update `scheduleReconnect` to store the timer:

```typescript
function scheduleReconnect(port: number): void {
    reconnectDelay = reconnectDelay === 0
      ? reconnectMs
      : Math.min(reconnectDelay * 2, reconnectMaxMs);
    reconnectTimer = setTimeout(boundary("reconnect", () => {
      reconnectTimer = null;
      connectToHypivisor(port);
    }), reconnectDelay);
}
```

---

## Root Cause 2: pi crash (SIGKILL) — no deregister, no close frame, relies on TCP timeout

**Component:** pi-socket + hypivisor  
**Severity:** HIGH — every killed pi leaves a ghost for 120+ seconds  
**Files:** `pi-socket/src/index.ts:115-127`, `hypivisor/src/main.rs:396-409`

### The bug

When a pi process is killed with `SIGKILL` (or the OOM killer, or a force quit):

1. `session_shutdown` never fires → no `deregister` RPC is sent
2. The OS closes the TCP socket → the hypivisor's `ws_read` returns `Ok(None)` or an error
3. The hypivisor marks the node `"offline"` with `offline_since = now`
4. The cleanup thread checks every 60s and removes nodes offline > 120s

**This part actually works**, but there's a gap: the hypivisor's `read_timeout` is 100ms. When the TCP socket is force-closed by the OS, the `ws_read` loop should detect it promptly. However:

- The stream has `set_read_timeout(Some(Duration::from_millis(100)))`, so `WouldBlock`/`TimedOut` errors are treated as "keep looping" (line 389-392 in main.rs). The actual socket close detection depends on `read()` returning 0 bytes, which triggers `Ok(None)` from `ws_read`. This works.
- **The real issue**: the node sits in `"offline"` state for up to **120 seconds** (default TTL) before cleanup removes it. During that time, Pi-DE shows it as a greyed-out "offline" entry. If the user restarts pi with a different session ID, the old ghost AND the new registration both appear.

### The fix

The 120s TTL is too long for localhost development. The offline-to-removed transition should be much faster, and the machine:port eviction should work across session ID changes.

**Option A** — Reduce default TTL:
```rust
#[arg(short = 't', long, default_value_t = 30)]
node_ttl: u64,
```

**Option B** — Add active health-checking (see Root Cause 5).

**Option C** — Evict offline nodes by `cwd` on new registration (see Root Cause 4).

---

## Root Cause 3: Session ID changes on every restart, defeating same-ID deduplication

**Component:** pi-socket  
**Severity:** HIGH — makes the "same ID overwrites" path useless  
**File:** `pi-socket/src/index.ts:57`

### The bug

```typescript
nodeId = ctx.sessionManager.getSessionId();
```

Pi's session manager generates a new UUID for each session. When the user:
1. Runs `pi` in `/project-A` → registers with `nodeId = "uuid-1"`
2. Closes pi (or it crashes)
3. Runs `pi` again in `/project-A` → registers with `nodeId = "uuid-2"`

The hypivisor now has TWO entries for `/project-A`:
- `"uuid-1"` with `status: "offline"` (from the disconnect)
- `"uuid-2"` with `status: "active"` (from the new registration)

The `handle_register` eviction logic in `rpc.rs:82-89` only evicts by `machine:port`:

```rust
evicted = nodes
    .iter()
    .filter(|(id, n)| {
        *id != &node.id && n.machine == node.machine && n.port == node.port
    })
    .map(|(id, _)| id.clone())
    .collect();
```

If the new pi instance gets a **different port** (because the old port was still in TIME_WAIT, or portfinder picked a different one), the machine:port eviction doesn't match, and the ghost survives.

### Why this is the #1 ghost multiplier

Every time you restart a pi process and it gets a different port, you get a new ghost. Over a development day with frequent restarts, this accumulates rapidly. With 3 active processes and 17 restarts, you get 20 entries.

### The fix

Add `cwd`-based eviction: when a new node registers on the same `machine` + `cwd`, evict all prior registrations for that machine+cwd combination (regardless of port):

```rust
// In handle_register, rpc.rs:
evicted = nodes
    .iter()
    .filter(|(existing_id, n)| {
        *existing_id != &node.id
            && n.machine == node.machine
            && (n.port == node.port || n.cwd == node.cwd)
    })
    .map(|(id, _)| id.clone())
    .collect();
```

**Rationale:** A single `cwd` on a single machine can only have one active pi process. (If you run `pi` twice in the same directory, the second one is a separate session, but the first one is stale.) This is the same reasoning as the machine:port eviction but covers the port-change case.

---

## Root Cause 4: Cleanup only runs every 60s with a 120s TTL — worst case 180s of ghosts

**Component:** hypivisor  
**Severity:** MEDIUM  
**File:** `hypivisor/src/main.rs:84`, `hypivisor/src/cleanup.rs`

### The bug

```rust
std::thread::spawn(move || loop {
    std::thread::sleep(Duration::from_secs(60));   // runs every 60s
    cleanup::cleanup_stale_nodes(&cx, &cleanup_state);
});
```

The cleanup loop sleeps 60s, then checks for nodes offline > 120s (default TTL). Worst case timing:

```
T=0:    node goes offline (offline_since = T=0)
T=59:   cleanup runs, checks: 0 - 59 = 59 < 120 → NOT removed
T=119:  cleanup runs, checks: 0 - 119 = 119 < 120 → NOT removed  
T=179:  cleanup runs, checks: 0 - 179 = 179 > 120 → removed
```

**Worst case: 179 seconds** before a ghost is removed. In a development workflow with frequent restarts, this means 3 minutes of stale entries.

### The fix

Reduce both the interval and TTL for development use:

```rust
// Cleanup every 15 seconds
std::thread::sleep(Duration::from_secs(15));
```

```rust
// Default TTL of 30 seconds
#[arg(short = 't', long, default_value_t = 30)]
node_ttl: u64,
```

With 15s interval and 30s TTL, worst case is 45 seconds — much more reasonable.

---

## Root Cause 5: No active liveness checking — "active" nodes are never verified

**Component:** hypivisor  
**Severity:** HIGH  
**File:** (missing — no liveness check exists)

### The bug

The hypivisor trusts that a node is "active" based solely on:
1. The node sent a `register` RPC at some point
2. The WebSocket connection from that node is still open (for detecting offline)

But there is no mechanism to detect:
- A node whose pi-socket WebSocket connection is open but the pi process is hung
- A node that was registered, then the hypivisor restarted (the in-memory registry is lost, but the node is still running and will reconnect — this is fine). But if the hypivisor did NOT restart and the node's TCP connection silently dies (half-open connection), the hypivisor never detects it.

### Half-open TCP connections

If a network partition occurs or the remote machine crashes without sending a FIN, the hypivisor's read loop sits in `WouldBlock` forever. The stream has a 100ms read timeout, so `ws_read` returns `Err(WouldBlock)` which is treated as "continue" (line 389-392). There's no idle timeout — the loop will spin indefinitely, burning CPU and never marking the node offline.

### The fix — WebSocket ping/pong heartbeat

Add a ping/pong mechanism to detect dead connections:

```rust
// In handle_registry_ws, after the read loop setup:
let ping_writer = writer.clone();
let ping_running = broadcast_running.clone();
let ping_handle = std::thread::spawn(move || {
    loop {
        std::thread::sleep(Duration::from_secs(30));
        if !ping_running.load(std::sync::atomic::Ordering::Relaxed) {
            break;
        }
        let mut w = ping_writer.lock().unwrap();
        if w.send_ping(b"hv".to_vec()).is_err() {
            break;
        }
    }
});
```

And add a `last_pong` timestamp check:

```rust
// Track last activity time
let last_activity = Arc::new(Mutex::new(std::time::Instant::now()));

// In the read loop, on any successful read:
*last_activity.lock().unwrap() = std::time::Instant::now();

// In the ping thread, after sending ping:
let elapsed = last_activity.lock().unwrap().elapsed();
if elapsed > Duration::from_secs(90) {
    warn!("No activity from node in 90s, closing connection");
    break; // This will drop the ping_writer, causing send_text to fail
}
```

This also needs adding `send_ping` to `WsWriter`:

```rust
fn send_ping(&mut self, payload: Vec<u8>) -> io::Result<()> {
    use asupersync::bytes::BytesMut;
    use asupersync::codec::Encoder;
    use io::Write;

    let frame = Frame::ping(payload);
    let mut buf = BytesMut::with_capacity(128);
    self.codec
        .encode(frame, &mut buf)
        .map_err(|e| io::Error::other(format!("WS ping encode: {e}")))?;
    self.stream.write_all(&buf)
}
```

---

## Root Cause 6: `deregister` RPC is fire-and-forget on shutdown — no guarantee of delivery

**Component:** pi-socket  
**Severity:** MEDIUM  
**File:** `pi-socket/src/index.ts:115-127`

### The bug

```typescript
pi.on("session_shutdown", async () => {
    log.info("pi-socket", "shutting down", { nodeId });
    if (hypivisorWs && hypivisorWs.readyState === WebSocket.OPEN) {
      const rpc: RpcRequest = {
        id: "dereg",
        method: "deregister",
        params: { id: nodeId },
      };
      hypivisorWs.send(JSON.stringify(rpc));   // ← fire-and-forget
    }
    if (wss) wss.close();
    if (hypivisorWs) hypivisorWs.close();      // ← immediately closes the WS
});
```

Problems:
1. `hypivisorWs.send()` buffers the data — `hypivisorWs.close()` on the next line may close the socket before the deregister frame is flushed.
2. Even if the send succeeds, the `close()` call happens immediately, so the node_removed event might not propagate to all dashboard clients before the broadcast forwarder thread in the hypivisor shuts down.
3. If `hypivisorWs.readyState` is NOT `OPEN` (e.g., the connection was dropped), no deregister is sent at all. The node becomes a ghost relying on the 120s TTL cleanup.

### The fix

Wait briefly for the deregister to be sent before closing:

```typescript
pi.on("session_shutdown", async () => {
    log.info("pi-socket", "shutting down", { nodeId });
    if (hypivisorWs && hypivisorWs.readyState === WebSocket.OPEN) {
      const rpc: RpcRequest = {
        id: "dereg",
        method: "deregister",
        params: { id: nodeId },
      };
      // Wait for the send buffer to drain before closing
      await new Promise<void>((resolve) => {
        hypivisorWs!.send(JSON.stringify(rpc), () => resolve());
      });
    }
    if (wss) wss.close();
    if (hypivisorWs) hypivisorWs.close();
});
```

The `ws.send(data, callback)` API calls the callback after the data is flushed to the kernel buffer. This ensures the deregister frame is actually sent before we close the connection.

---

## Pi-DE Side: Why duplicates show for the same cwd

**Component:** Pi-DE  
**Severity:** Display issue (not a root cause, but compounds the UX problem)  
**File:** `pi-de/src/useHypivisor.ts:24-29`

### The behavior

The `node_joined` handler filters by `id`:

```typescript
case "node_joined":
    setNodes((prev) => {
      const filtered = prev.filter((n) => n.id !== data.node.id);
      return [...filtered, { ...data.node, status: "active" as const }];
    });
    break;
```

This correctly prevents duplicate entries for the **same node ID**. But if the same `cwd` registers with a different node ID (which happens every time due to Root Cause 3), both entries appear in the sidebar — one "offline" (the old ID) and one "active" (the new ID).

### The fix

This is fundamentally a server-side issue (Root Cause 3). Once the hypivisor evicts by `cwd`, Pi-DE will only see one entry per cwd. However, as a defensive client-side measure:

```typescript
case "node_joined":
    setNodes((prev) => {
      // Remove both same-id duplicates AND same-machine+cwd ghosts
      const filtered = prev.filter(
        (n) => n.id !== data.node.id
          && !(n.machine === data.node.machine && n.cwd === data.node.cwd)
      );
      return [...filtered, { ...data.node, status: "active" as const }];
    });
    break;
```

---

## Summary: All 8 Questions Answered

### 1. What happens when a pi process crashes without calling session_shutdown?

The hypivisor detects the TCP socket close, marks the node "offline", and the cleanup thread removes it after 120s (up to 180s worst case). **Ghost lives for 2-3 minutes.** (Root Causes 2, 4)

### 2. What happens when pi-socket's WebSocket to hypivisor drops unexpectedly?

The `close` handler fires, `scheduleReconnect` starts, and the node reconnects with the same `nodeId` and `port`. The hypivisor marks the node "offline" on disconnect, then "active" again on re-register. **This works correctly** — as long as the session hasn't changed. If the session changed between disconnect and reconnect (Root Cause 1), the reconnect registers with the new nodeId but the old ghost persists.

### 3. What happens on session_start if the same pi process re-registers with a new session ID?

The old hypivisor WebSocket is NOT closed. The old reconnect timer is NOT cancelled. The new session registers with a new nodeId, leaving the old node as a ghost until TTL cleanup. **This is the primary ghost factory.** (Root Cause 1, 3)

### 4. What happens when portfinder picks a new port on restart — does eviction by machine:port still work?

**No.** The machine:port eviction only works when the new process gets the same port as the old one. If the old port is in TIME_WAIT or another process grabbed it, portfinder picks a different port, and the eviction filter `n.port == node.port` doesn't match. **Ghost survives.** (Root Cause 3)

### 5. Is the 60-second cleanup interval with 120-second TTL sufficient?

**No.** Worst case is 179 seconds. For local development with frequent restarts, this means 3+ minutes of stale entries accumulating. (Root Cause 4)

### 6. What happens when the hypivisor restarts — do nodes re-register or become permanent ghosts?

**This actually works.** When the hypivisor restarts, its in-memory registry is empty. All pi-socket instances detect the WebSocket close, reconnect, and re-register. The init event sent to Pi-DE on reconnect contains only the currently-registered nodes. No ghosts from this scenario.

### 7. Are there race conditions between register, deregister, and cleanup?

**Yes.** The TOCTOU race in `cleanup.rs` (read lock → drop → write lock) means a node could be re-registered as active between the read and write, then erroneously removed. However, this is a minor contributor compared to Root Causes 1 and 3. (Also noted in prior codex review as M3.)

### 8. Why does the Pi-DE sidebar show duplicate entries for the same cwd?

Because each pi restart generates a new session UUID (nodeId), and the machine:port eviction fails when the port changes. Pi-DE's `node_joined` handler deduplicates by `id` only, not by `cwd`. So old-id=offline and new-id=active both appear. (Root Causes 3 + Pi-DE display issue)

---

## Prioritized Fix Plan

| Priority | Fix | Root Cause | Component | Effort | Impact |
|----------|-----|------------|-----------|--------|--------|
| **P0** | Close old hypivisor WS + cancel reconnect timer on session_start | RC1 | pi-socket | Small | Eliminates the #1 ghost factory |
| **P0** | Add `cwd`-based eviction on register | RC3 | hypivisor | Small | Handles port-change restarts |
| **P1** | Reduce default TTL to 30s, cleanup interval to 15s | RC4 | hypivisor | Trivial | 45s max ghost lifetime vs 180s |
| **P1** | Wait for deregister send buffer to drain before close | RC6 | pi-socket | Small | Reliable clean shutdown |
| **P2** | Add WebSocket ping/pong heartbeat | RC5 | hypivisor | Medium | Detects half-open connections |
| **P2** | Client-side cwd dedup in node_joined handler | Display | Pi-DE | Small | Defense-in-depth for sidebar |
| **P3** | Fix TOCTOU in cleanup.rs (single write lock) | RC7 | hypivisor | Small | Correctness under concurrent re-registration |

### Implementing P0 fixes alone should eliminate >90% of observed ghost nodes.
