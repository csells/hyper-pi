Written to `specs/review-stale-claude.md`. Here's the summary:

---

## 7 Root Causes Found

The ghost node problem isn't one bug — it's **7 compounding bugs** across pi-socket and hypivisor:

### Critical
**RC-1: Reconnect after shutdown re-registers the node** (pi-socket)
`session_shutdown` sends deregister, then closes the WS. The `close` handler calls `scheduleReconnect()`, which fires a timer that creates a **new** WS and **re-registers** the node — after it was just deregistered. This creates "active" ghosts that cleanup never touches (it only removes "offline" nodes).

### High
**RC-2: session_start doesn't close old hypivisor WS** (pi-socket)
On session switch, `connectToHypivisor` overwrites `hypivisorWs` without closing the old one. The leaked connection's eventual `close` handler triggers an orphan reconnect loop.

**RC-3: No shutdown flag prevents reconnection** (pi-socket)
`scheduleReconnect()` has zero guards — it fires during shutdown, during session switch, always.

**RC-4: Eviction only matches machine:port, not machine:cwd** (hypivisor)
When portfinder picks a different port on restart (old port in TIME_WAIT), the eviction misses. Adding `machine:cwd` matching catches the most common restart scenario.

### Medium
**RC-5: Deregister is fire-and-forget** (pi-socket) — `ws.close()` called immediately after `ws.send()`, may flush before delivery.

**RC-6: 120s TTL too long** (hypivisor) — Offline ghosts visible for 2-3 minutes during active development. Reducing to 30s TTL / 15s sweep = max 45s.

**RC-7: Cleanup TOCTOU race** (hypivisor) — Cleanup reads stale nodes, drops the lock, re-acquires write lock to remove. A `register` call between the two locks can reactivate a node that then gets deleted.
on to the hypivisor and **re-registers** the node — after it was just deregistered.

**Code path:**

```
session_shutdown
  → hypivisorWs.send(deregister)        // node removed from registry ✓
  → hypivisorWs.close()                 // triggers close handler ↓
    → ws.on("close") fires
      → scheduleReconnect(port)          // setTimeout(connectToHypivisor, delay)
        → [delay passes]
        → connectToHypivisor(port)       // creates NEW WebSocket
          → ws.on("open")
            → sends register RPC         // NODE RE-REGISTERED! ✗
```

**pi-socket/src/index.ts lines 115–127 (shutdown):**

```typescript
pi.on("session_shutdown", async () => {
    // ...
    if (hypivisorWs && hypivisorWs.readyState === WebSocket.OPEN) {
      hypivisorWs.send(JSON.stringify(rpc)); // deregister
    }
    if (wss) wss.close();
    if (hypivisorWs) hypivisorWs.close();  // ← triggers close → reconnect!
});
```

**pi-socket/src/index.ts lines 178–184 (close handler):**

```typescript
ws.on("close", () => {
    const wasConnected = hypivisorConnected;
    hypivisorConnected = false;
    if (wasConnected) {
        log.warn("hypivisor", "disconnected, will reconnect");
    }
    scheduleReconnect(port);  // ← ALWAYS schedules reconnect, even during shutdown
});
```

**Why this creates permanent ghosts:** The re-registered node has `status: "active"`. The cleanup thread only removes `"offline"` nodes. The eviction-by-machine:port only fires when another `register` call arrives — but the pi process is shutting down, so no new registration ever comes. The re-registered node persists as "active" in the hypivisor registry until:
- The reconnect-created WS connection drops (when the pi process finally exits)
- Which marks it offline
- Which starts the 120s TTL countdown

But if Node.js keeps the event loop alive for the reconnect timer (it does — `setTimeout` keeps the process alive unless `unref()`'d), the process may not exit promptly. And if the new WS connects, its own `close` handler will schedule **another** reconnect, creating an infinite loop that keeps the process alive.

**Fix (pi-socket):**

```typescript
let shutdownRequested = false;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

pi.on("session_shutdown", async () => {
    shutdownRequested = true;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    // ... rest of shutdown
});

function scheduleReconnect(port: number): void {
    if (shutdownRequested) return;  // ← guard
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

## Root Cause 2: session_start doesn't close old hypivisor WS

**Severity:** HIGH — creates leaked connections and orphan reconnect loops

**The bug:** When `session_start` fires again (e.g., session switch, `/reload`), pi-socket gets a new `nodeId`, closes the old WSS, and calls `connectToHypivisor(port)`. But `connectToHypivisor` does `hypivisorWs = ws` — overwriting the reference to the old hypivisor WebSocket **without closing it**.

The old WebSocket connection stays alive (Node's `ws` library keeps it alive via internal socket references). On the hypivisor side, there are now **two** connections from the same pi process:
1. Old connection: `registered_node_id = Some("old-session-id")`
2. New connection: `registered_node_id = Some("new-session-id")`

The new registration evicts the old node (same machine:port). But when the old connection eventually closes (GC, process exit), its `close` handler:
1. Marks old-session-id as offline — but it was already evicted (harmless)
2. Calls `scheduleReconnect(port)` — creates **another** new WS, which re-registers with the **current** `nodeId`

This can cause spurious re-registrations and connection storms.

**Code path:**

```
session_start (second time)
  → nodeId = "new-session-id"
  → connectToHypivisor(port)
    → hypivisorWs = newWs           // old WS reference lost, NOT closed
    → old WS stays alive
      → [eventually closes]
        → old ws.on("close") fires
          → scheduleReconnect(port)  // orphan reconnect!
```

**Fix (pi-socket):** Close the old hypivisor WS before creating a new one:

```typescript
pi.on("session_start", async (_event, ctx) => {
    nodeId = ctx.sessionManager.getSessionId();

    if (wss) { wss.close(); wss = null; }

    // Close old hypivisor connection before creating new one
    if (hypivisorWs) {
      const oldWs = hypivisorWs;
      hypivisorWs = null;
      oldWs.removeAllListeners(); // prevent close → reconnect
      oldWs.close();
    }
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    // ... rest of startup
});
```

---

## Root Cause 3: No shutdown flag prevents reconnection

**Severity:** HIGH — amplifies Root Causes 1 and 2

This is the systemic issue underlying both RC-1 and RC-2. The `scheduleReconnect` function has **no guard** — it always schedules a reconnect, regardless of whether the agent is shutting down or a new session has started.

**The fix** is the `shutdownRequested` guard shown in RC-1, plus clearing the timer in `session_start` as shown in RC-2.

---

## Root Cause 4: Eviction only matches machine:port, not machine:cwd

**Severity:** HIGH — misses the most common ghost-creating scenario

**The bug:** When a pi process restarts in the same directory, `portfinder` may pick a **different port** (the old port may be in TCP `TIME_WAIT` or grabbed by another process). The new registration has a different port than the old one, so the eviction-by-machine:port doesn't match.

**hypivisor/src/rpc.rs, handle_register:**

```rust
evicted = nodes
    .iter()
    .filter(|(id, n)| {
        *id != &node.id && n.machine == node.machine && n.port == node.port
    })
    .map(|(id, _)| id.clone())
    .collect();
```

**Example scenario:**
1. pi starts in `/Users/csells/Code/my-project`, gets port 8080, registers as `session-A`
2. pi exits (Ctrl-C) → `session-A` marked offline (or deregistered)
3. User runs pi again in same directory → new `session-B`
4. portfinder gets port 8081 (8080 in TIME_WAIT)
5. Registration: `{ id: "session-B", machine: "host", cwd: "/Users/.../my-project", port: 8081 }`
6. Eviction check: no node with machine="host" AND port=8081 → nothing evicted
7. `session-A` (offline, port 8080) remains as a ghost for 120s

For the common case of restarting pi in the same directory, eviction by `machine:cwd` would catch this.

**Fix (hypivisor/src/rpc.rs):** Add machine:cwd eviction in addition to machine:port:

```rust
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

**Caveat:** This means you can only have one pi instance per directory per machine. If you legitimately want two pi instances in the same directory, this eviction would kill the first one. However, this is the expected behavior — running two pi instances in the same directory is almost always a mistake.

---

## Root Cause 5: Deregister on shutdown is fire-and-forget

**Severity:** MEDIUM — the deregister may never arrive

**The bug:** In `session_shutdown`, the `deregister` RPC is sent and then the WebSocket is immediately closed. There is no `await` on the response. If the send buffer hasn't flushed before `close()` is called, the deregister message may be lost.

**pi-socket/src/index.ts lines 115–127:**

```typescript
pi.on("session_shutdown", async () => {
    if (hypivisorWs && hypivisorWs.readyState === WebSocket.OPEN) {
      hypivisorWs.send(JSON.stringify(rpc));  // fire and forget
    }
    if (wss) wss.close();
    if (hypivisorWs) hypivisorWs.close();    // may close before send completes
});
```

When the deregister is lost, the node isn't removed from the registry. The WebSocket close is detected by the hypivisor, which marks the node as `"offline"`. Then it sits for 120s (TTL) before cleanup removes it.

**Fix (pi-socket):** Flush the send and add a brief delay, or listen for the drain event:

```typescript
pi.on("session_shutdown", async () => {
    shutdownRequested = true;
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }

    if (hypivisorWs && hypivisorWs.readyState === WebSocket.OPEN) {
      const ws = hypivisorWs;
      ws.removeAllListeners("close"); // prevent close → reconnect
      const rpc: RpcRequest = { id: "dereg", method: "deregister", params: { id: nodeId } };
      ws.send(JSON.stringify(rpc), () => {
        // Callback fires after data is flushed to the kernel buffer
        ws.close();
      });
    } else {
      if (hypivisorWs) hypivisorWs.close();
    }
    if (wss) wss.close();
});
```

The `ws.send(data, callback)` callback fires after the data is written to the OS send buffer, not after the server receives it. But it's sufficient — the data will be delivered as long as the TCP connection completes its close handshake, which `ws.close()` handles gracefully (sends a Close frame and waits for the peer's Close response).

---

## Root Cause 6: 120s TTL is too long for development workflows

**Severity:** MEDIUM — offline ghosts are visible for 2-3 minutes

**The defaults:** `--node-ttl 120` (120 seconds) with cleanup running every 60 seconds. An offline node can persist for up to 180 seconds (120s TTL + up to 60s before the next cleanup sweep).

During active development, a user might restart pi 5-10 times in a few minutes. Each restart leaves an offline ghost. With 180s worst-case persistence, ghosts from the last 3 minutes are all visible simultaneously.

**Fix (hypivisor):**

1. Reduce default TTL to 30 seconds:

```rust
#[arg(short = 't', long, default_value_t = 30)]
node_ttl: u64,
```

2. Reduce cleanup interval to 15 seconds:

```rust
std::thread::spawn(move || loop {
    std::thread::sleep(Duration::from_secs(15));
    let cx = ephemeral_cx();
    cleanup::cleanup_stale_nodes(&cx, &cleanup_state);
});
```

With these values, an offline ghost persists for at most 45 seconds (30s TTL + up to 15s before sweep). Combined with machine:cwd eviction (RC-4), most ghosts are immediately evicted on re-registration, and the few that slip through are cleaned up within a minute.

---

## Root Cause 7: Cleanup has TOCTOU race

**Severity:** LOW — narrow window, but can delete an active node

**The bug:** `cleanup_stale_nodes` reads the node registry (identifying stale nodes), drops the read lock, then acquires a write lock to remove them. Between those two operations, a `register` RPC could reactivate a stale node:

```
cleanup reads: node X is offline, offline_since > TTL → marked for removal
    [lock released]
register RPC: node X re-registered, status = "active", offline_since = None
    [lock released]
cleanup writes: removes node X → REMOVES AN ACTIVE NODE
```

**hypivisor/src/cleanup.rs:**

```rust
pub fn cleanup_stale_nodes(cx: &Cx, state: &Registry) {
    // Phase 1: read lock
    let to_remove = { /* ... collect stale IDs ... */ };

    // Gap: no lock held — register can fire here

    // Phase 2: write lock
    if !to_remove.is_empty() {
        let mut nodes = state.nodes.write().unwrap();
        for id in &to_remove {
            nodes.remove(id);  // might remove freshly-reactivated node!
        }
    }
}
```

**Fix (hypivisor/src/cleanup.rs):** Re-check node status under the write lock before removing:

```rust
if !to_remove.is_empty() {
    let mut nodes = state.nodes.write().expect("nodes lock poisoned in cleanup");
    for id in &to_remove {
        let dominated = nodes.get(id).is_some_and(|n| {
            n.status == "offline"
                && n.offline_since
                    .is_some_and(|since| now - since > ttl)
        });
        if dominated {
            nodes.remove(id);
            info!(node_id = %id, "Stale node removed");
            let event = serde_json::json!({ "event": "node_removed", "id": id }).to_string();
            if state.tx.send(cx, event).is_err() {
                warn!("No receivers for node_removed broadcast");
            }
        }
    }
}
```

---

## Answering Each Investigation Question

### 1. What happens when a pi process crashes without calling session_shutdown?

The OS closes the TCP socket. The hypivisor detects the close in `handle_registry_ws`, marks the node `"offline"` with `offline_since = now()`. Cleanup removes it after TTL (120s default). **Ghost persists for up to 180s.** This is handled correctly but slowly (RC-6).

### 2. What happens when pi-socket's WebSocket to hypivisor drops unexpectedly?

pi-socket's `ws.on("close")` fires → `scheduleReconnect(port)`. Reconnects and re-registers with the same `nodeId` and `port`. On the hypivisor, the disconnect marks the node offline, then the reconnect overwrites it back to active. **No ghost. This path works correctly.**

### 3. What happens on session_start if the same pi process re-registers with a new session ID?

pi-socket gets a new `nodeId` from `ctx.sessionManager.getSessionId()`. It reuses the same port (`wssPort` is remembered). The new registration evicts the old node by machine:port. **No ghost from the registration itself.** BUT: the old hypivisor WS is not closed (RC-2), creating a connection leak. And when the old WS eventually closes, its reconnect handler may create spurious re-registrations.

### 4. What happens when portfinder picks a new port on restart — does eviction by machine:port still work?

**No.** If the port changes, eviction by machine:port doesn't match. The old node becomes an offline ghost that persists until TTL cleanup (RC-4). This is the most common scenario during development — pi exits, port enters TIME_WAIT, new instance gets a different port.

### 5. Is the 60-second cleanup interval with 120-second TTL sufficient?

**No.** Worst-case ghost persistence is 180s. During active development with frequent restarts, this creates a backlog of visible offline entries (RC-6). Combined with the eviction-by-port miss (RC-4), ghosts accumulate faster than cleanup removes them.

### 6. What happens when the hypivisor restarts — do nodes re-register or become permanent ghosts?

**The hypivisor restart is clean.** The in-memory registry is wiped. All WebSocket connections drop. pi-socket detects the drop, reconnects, and re-registers fresh. Pi-DE also reconnects and gets a fresh `init` event with the current (rebuilding) node list. No persistent ghosts from hypivisor restarts.

### 7. Are there race conditions between register, deregister, and cleanup?

**Yes.** The TOCTOU race in cleanup (RC-7) can remove a freshly-reactivated node. Also, the deregister-then-close-then-reconnect sequence in shutdown (RC-1) races between removing and re-adding the node. Both are fixable.

### 8. Why does the Pi-DE sidebar show duplicate entries for the same cwd?

Two causes:
1. **Different session IDs, same directory:** Each pi session gets a unique `nodeId` from `ctx.sessionManager.getSessionId()`. If a new session starts before the old one's ghost is cleaned up, both appear. Machine:cwd eviction (RC-4 fix) would eliminate this.
2. **Legitimate multiple instances:** A user could intentionally run two pi instances in the same directory (rare). The current code treats them as distinct nodes. The machine:cwd eviction fix would prevent this — acceptable tradeoff since it's almost always unintentional.

---

## Consolidated Fix

The fixes span two components. Here's the complete change set:

### pi-socket/src/index.ts — Full rewrite of lifecycle management

```typescript
export default function piSocket(pi: ExtensionAPI) {
  let nodeId = process.pid.toString();
  let wss: WebSocketServer | null = null;
  let hypivisorWs: WebSocket | null = null;
  let hypivisorUrlValid = true;
  let hypivisorConnected = false;
  let reconnectDelay = 0;
  let shutdownRequested = false;                    // NEW: RC-1, RC-3
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null; // NEW: RC-1, RC-3

  // ... config vars unchanged ...

  let wssPort: number | null = null;

  pi.on("session_start", async (_event, ctx) => {
    nodeId = ctx.sessionManager.getSessionId();

    if (wss) { wss.close(); wss = null; }

    // NEW: Close old hypivisor WS cleanly before creating new one (RC-2)
    closeHypivisorWs();

    const port = wssPort ?? (await portfinder.getPortPromise({ port: startPort }));
    wss = new WebSocketServer({ port });
    wssPort = port;
    // ... rest unchanged ...
    connectToHypivisor(port);
  });

  // ... event forwarding unchanged ...

  pi.on("session_shutdown", async () => {
    shutdownRequested = true;                       // NEW: RC-1, RC-3

    // NEW: Cancel any pending reconnect (RC-1)
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    // NEW: Deregister with flush callback (RC-5)
    if (hypivisorWs && hypivisorWs.readyState === WebSocket.OPEN) {
      const ws = hypivisorWs;
      hypivisorWs = null;
      ws.removeAllListeners("close");               // prevent close → reconnect
      const rpc: RpcRequest = { id: "dereg", method: "deregister", params: { id: nodeId } };
      ws.send(JSON.stringify(rpc), () => ws.close());
    } else {
      if (hypivisorWs) {
        hypivisorWs.removeAllListeners("close");
        hypivisorWs.close();
        hypivisorWs = null;
      }
    }
    if (wss) wss.close();
  });

  // ... broadcast unchanged ...

  // NEW: Helper to cleanly close hypivisor WS without triggering reconnect (RC-2)
  function closeHypivisorWs(): void {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (hypivisorWs) {
      const oldWs = hypivisorWs;
      hypivisorWs = null;
      oldWs.removeAllListeners();
      oldWs.close();
    }
    reconnectDelay = 0;
  }

  function connectToHypivisor(port: number): void {
    if (!hypivisorUrlValid || shutdownRequested) return; // NEW: RC-3 guard
    // ... rest unchanged ...
  }

  function scheduleReconnect(port: number): void {
    if (shutdownRequested) return;                  // NEW: RC-1, RC-3 guard
    reconnectDelay = reconnectDelay === 0
      ? reconnectMs
      : Math.min(reconnectDelay * 2, reconnectMaxMs);
    reconnectTimer = setTimeout(boundary("reconnect", () => {
      reconnectTimer = null;
      connectToHypivisor(port);
    }), reconnectDelay);
  }
}
```

### hypivisor/src/rpc.rs — Evict by machine:cwd in addition to machine:port

```rust
fn handle_register(/* ... */) -> RpcResponse {
    // ...
    let evicted: Vec<String>;
    {
        let mut nodes = state.nodes.write().expect("nodes lock poisoned in register");
        // Evict stale nodes on the same machine:port OR same machine:cwd.
        // machine:port catches port reuse within the same machine.
        // machine:cwd catches restart-in-same-directory with different port.
        evicted = nodes
            .iter()
            .filter(|(id, n)| {
                *id != &node.id
                    && n.machine == node.machine
                    && (n.port == node.port || n.cwd == node.cwd)
            })
            .map(|(id, _)| id.clone())
            .collect();
        for id in &evicted {
            nodes.remove(id);
        }
        nodes.insert(node.id.clone(), node.clone());
    }
    // ... broadcast unchanged ...
}
```

### hypivisor/src/cleanup.rs — Re-check under write lock + shorter defaults

```rust
pub fn cleanup_stale_nodes(cx: &Cx, state: &Registry) {
    let now = Utc::now().timestamp();
    let ttl = state.node_ttl as i64;
    let mut to_remove = vec![];

    {
        let nodes = state.nodes.read().expect("nodes lock poisoned in cleanup");
        for (id, node) in nodes.iter() {
            if node.status == "offline" {
                if let Some(offline_since) = node.offline_since {
                    if now - offline_since > ttl {
                        to_remove.push(id.clone());
                    }
                }
            }
        }
    }

    if !to_remove.is_empty() {
        let mut nodes = state.nodes.write().expect("nodes lock poisoned in cleanup");
        for id in &to_remove {
            // Re-check: node may have been reactivated between read and write (RC-7)
            let still_stale = nodes.get(id).is_some_and(|n| {
                n.status == "offline"
                    && n.offline_since.is_some_and(|since| now - since > ttl)
            });
            if still_stale {
                nodes.remove(id);
                info!(node_id = %id, "Stale node removed");
                let event = serde_json::json!({ "event": "node_removed", "id": id }).to_string();
                if state.tx.send(cx, event).is_err() {
                    warn!("No receivers for node_removed broadcast");
                }
            }
        }
    }
}
```

### hypivisor/src/main.rs — Shorter defaults

```rust
#[derive(Parser, Debug)]
struct Args {
    #[arg(short, long, default_value_t = 31415)]
    port: u16,

    #[arg(short = 't', long, default_value_t = 30)]  // was 120
    node_ttl: u64,
}

// In main():
std::thread::spawn(move || loop {
    std::thread::sleep(Duration::from_secs(15));  // was 60
    let cx = ephemeral_cx();
    cleanup::cleanup_stale_nodes(&cx, &cleanup_state);
});
```

---

## Expected Impact

With all fixes applied:

| Scenario | Before | After |
|----------|--------|-------|
| pi exits cleanly (Ctrl-C) | Ghost persists 0-180s | Node immediately removed (deregister flushes) |
| pi crashes (SIGKILL) | Ghost persists 120-180s | Ghost persists 30-45s (shorter TTL) |
| pi restarts in same dir, different port | Ghost persists 120-180s | Old node immediately evicted (machine:cwd match) |
| pi session switch (/reload) | Old WS leaks, possible re-registration | Old WS closed cleanly, no leak |
| Shutdown + reconnect race | Node re-registered after deregister | Reconnect blocked by shutdown flag |
| Cleanup vs register race | Can delete active node | Re-checks status under write lock |

**Net effect:** A user with 3 active pi processes should see exactly 3 nodes in Pi-DE, with at most 1-2 briefly-visible offline entries during restarts.
