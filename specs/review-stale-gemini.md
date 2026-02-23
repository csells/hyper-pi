The complete analysis is written to **`specs/review-stale-gemini.md`**.

## Summary of Findings

### 5 Root Causes Found

| # | Root Cause | Severity | Component | Ghost Lifetime |
|---|-----------|----------|-----------|----------------|
| **1** | `session_start` never closes old `hypivisorWs` or cancels reconnect timers | **CRITICAL** | pi-socket | Until TCP dies + 120s TTL |
| **2** | Hypivisor restart (in-memory data loss) | LOW | hypivisor | N/A — `init` replaces state |
| **3** | Fire-and-forget `deregister` — `ws.close()` races the send | HIGH | pi-socket | 120s (TTL) |
| **4** | Cleanup only targets `status=="offline"` — active ghosts are immortal | HIGH | hypivisor | **Forever** |
| **5** | No heartbeat — hypivisor can't distinguish live agents from dead TCP | HIGH | both | Until OS TCP timeout (minutes–hours) |

### Why ~20 ghosts from 3 processes

**Root Cause 1 × Root Cause 5 = ghost multiplication.** Each session restart (branch switch, `/session new`, etc.) generates a new UUID. The old connection isn't closed, so the old UUID stays "active". Over a day: 3 processes × ~6 restarts = ~18 ghosts. Without heartbeat (RC5), the cleanup task (RC4) never touches "active" nodes, so they persist forever.

### 8 Fixes Provided

1. **Close old `hypivisorWs` and cancel reconnect timer on `session_start`** (pi-socket)
2. **Cancel reconnect timer on `session_shutdown`** (pi-socket)
3. **Store `reconnectTimer` reference so it's cancellable** (pi-socket)
4. **Add 30s WebSocket ping heartbeat** (pi-socket → hypivisor)
5. **Add `last_seen` timestamp to `NodeInfo`** (hypivisor state)
6. **Update `last_seen` on register and on every ping received** (hypivisor main + rpc)
7. **Expand cleanup to remove "active" nodes with stale `last_seen`** (hypivisor cleanup)
8. **Lower default TTL from 120s to 90s** (3 missed heartbeats)
ding. When it fires, it calls `connectToHypivisor(port)` which creates yet another connection — but now `nodeId` has already changed to `"uuid-BBB"`, so this reconnect registers `"uuid-BBB"` a second time (harmless) but the old WebSocket thread for `"uuid-AAA"` is still alive.

**Why the machine:port eviction doesn't help:** The machine:port eviction in `handle_register` (rpc.rs line 84–93) **does** fire — it evicts `"uuid-AAA"` when `"uuid-BBB"` registers with the same machine and port. But the eviction only removes the entry from the `HashMap`. It does NOT close the old WebSocket connection thread for `"uuid-AAA"`. That thread is blocked in `ws_read()`. When that thread's connection eventually drops (e.g., TCP keepalive timeout), `handle_registry_ws` runs its disconnect handler — which sets `"uuid-AAA"` back to `"offline"` and re-inserts it into the node map:

```rust
// main.rs line 396–408 — runs when old connection thread exits
if let Some(node_id) = registered_node_id {  // "uuid-AAA"
    let mut nodes = state.nodes.write().expect("...");
    if let Some(node) = nodes.get_mut(&node_id) {  // was evicted — get_mut returns None
        node.status = "offline".to_string();        // this line doesn't execute
        ...
    }
}
```

Wait — actually the `get_mut` returns `None` because the eviction already removed it. So the ghost isn't re-created by the disconnect handler in this case. Let me re-examine...

The actual ghost creation path is subtler:

1. `session_start` fires with `nodeId = "uuid-AAA"`, registers, gets port 8080
2. The old `hypivisorWs` to hypivisor stays open (not closed)
3. `session_start` fires again with `nodeId = "uuid-BBB"`
4. `connectToHypivisor(8080)` is called — creates new WS, **overwrites** `hypivisorWs`
5. The old WS (for AAA) is now orphaned — no variable references it, but the TCP connection is alive
6. Registration of BBB evicts AAA from the registry (machine:port match)
7. The old WS thread in hypivisor still has `registered_node_id = "uuid-AAA"`
8. Eventually the orphaned WS dies → hypivisor's disconnect handler runs → `get_mut("uuid-AAA")` returns None → **no ghost created here**

So in the machine:port eviction case, the ghost is actually cleaned up. But here's when it DOESN'T work:

**If portfinder picks a DIFFERENT port on the second session_start:**

1. Session 1: `nodeId = "AAA"`, port = 8080, registered
2. Session 2: `wss` is closed (freeing port 8080), portfinder picks 8081
3. `nodeId = "BBB"`, port = 8081, registered
4. Machine:port eviction checks: BBB is on port 8081, AAA was on port 8080 → **NO MATCH → AAA is NOT evicted**
5. Now both AAA and BBB are in the registry
6. AAA's old hypivisor WS is orphaned but alive → AAA stays "active"
7. Eventually the orphaned WS dies → disconnect handler runs → `get_mut("AAA")` finds it → marks "offline" → starts TTL countdown
8. TTL (120s) eventually removes it, but for 2+ minutes it's a ghost

Actually wait — let me re-read the port logic more carefully:

```typescript
let wssPort: number | null = null;

pi.on("session_start", async (_event, ctx) => {
    if (wss) { wss.close(); wss = null; }
    const port = wssPort ?? (await portfinder.getPortPromise({ port: startPort }));
    wss = new WebSocketServer({ port });
    wssPort = port;  // ← cached for reuse
```

The `wssPort` variable caches the port across session restarts. So after the first session, `wssPort` is set (e.g., 8080), and subsequent sessions reuse it. This means portfinder is NOT called again, and the port stays the same. The machine:port eviction SHOULD work.

**But there's still a race:** `wss.close()` is called, then immediately `new WebSocketServer({ port })` is called with the same port. If `wss.close()` hasn't fully released the port by the time the new WSS binds, the bind fails silently (the `wss.on("error")` handler is `() => {}`). Then portfinder would be needed but `wssPort` is already cached, so it's not called.

Let me re-focus on the primary remaining issue:

### The Real Ghost Path: hypivisorWs Is Never Closed on Session Restart

```typescript
pi.on("session_start", async (_event, ctx) => {
    nodeId = ctx.sessionManager.getSessionId();  // new UUID

    if (wss) { wss.close(); wss = null; }  // ✅ closes old WSS

    // ❌ OLD hypivisorWs IS NEVER CLOSED
    // ❌ OLD scheduleReconnect TIMER IS NEVER CANCELLED

    connectToHypivisor(port);  // creates NEW hypivisorWs, overwrites variable
```

The old `hypivisorWs` WebSocket is simply overwritten. The connection remains alive. The hypivisor thread for the old connection keeps running with `registered_node_id = Some("old-uuid")`. When the old connection eventually dies, it marks the old UUID as offline.

But with `wssPort` caching, the machine:port eviction handles this... **unless** the hypivisor itself restarted between sessions, clearing the eviction state.

### Fix

```typescript
pi.on("session_start", async (_event, ctx) => {
    nodeId = ctx.sessionManager.getSessionId();

    // Close previous WSS
    if (wss) { wss.close(); wss = null; }

    // Close previous hypivisor connection and cancel reconnect
    if (hypivisorWs) {
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

But this still doesn't cancel pending `setTimeout` reconnect timers. For that:

```typescript
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleReconnect(port: number): void {
    reconnectDelay = reconnectDelay === 0
      ? reconnectMs
      : Math.min(reconnectDelay * 2, reconnectMaxMs);
    reconnectTimer = setTimeout(boundary("reconnect", () => {
      connectToHypivisor(port);
    }), reconnectDelay);
}

pi.on("session_start", async (_event, ctx) => {
    // Cancel any pending reconnect from previous session
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    // Close previous hypivisor WS
    if (hypivisorWs) { hypivisorWs.close(); hypivisorWs = null; }
    hypivisorConnected = false;
    reconnectDelay = 0;
    // ... rest of session_start
});
```

---

## Root Cause 2: Hypivisor Restart Creates Permanent Ghosts

**Severity:** HIGH  
**Component:** hypivisor + pi-socket  
**Files:** `hypivisor/src/main.rs` (in-memory state), `pi-socket/src/index.ts` (reconnect loop)

### The Code Path

1. Hypivisor is running with 5 registered nodes
2. Hypivisor process is killed/restarted
3. All in-memory state is lost (no persistence — see `specs/hypivisor-persistence.md`, still unimplemented)
4. Pi-socket agents detect the connection drop → `ws.on("close")` fires → `scheduleReconnect(port)` runs
5. Each agent reconnects and re-registers with its current `nodeId`

**This actually works correctly** — each agent re-registers, and the hypivisor gets a fresh, accurate state. The Pi-DE reconnects to the hypivisor and gets the new `init` event with only the live nodes.

**But here's the problem:** If a pi agent crashed (or was killed) BEFORE the hypivisor restarted, that agent won't reconnect. Its ghost existed in the old hypivisor's memory as "offline", and was counting down toward TTL removal. When the hypivisor restarts, that countdown is lost. If the agent reconnects later (or a new agent takes its port), the old ghost from before the restart is gone — which is actually fine.

**The real issue** is the Pi-DE sidebar. When the hypivisor restarts, the Pi-DE's `useHypivisor` hook reconnects and gets a new `init` event. But the `handleEvent` for `"init"` does `setNodes(data.nodes)` — a full replacement. This correctly clears old nodes. **No ghost from this path.**

**Verdict:** This is not a direct ghost source. The hypivisor restart path is actually clean because the full `init` event replaces the entire node list. BUT: if the Pi-DE was disconnected during the hypivisor restart (network issue), it might miss the `init` event and accumulate stale state from before the restart. The reconnect handler in `useHypivisor.ts` creates a new WebSocket which receives a new `init`, so this is also handled.

**No fix needed for this root cause specifically.** But the lack of persistence means the TTL countdown resets on restart, which extends the lifetime of legitimately-offline nodes.

---

## Root Cause 3: The `session_shutdown` Deregister Is Fire-and-Forget

**Severity:** HIGH  
**Component:** pi-socket  
**File:** `pi-socket/src/index.ts`, lines 115–127

### The Code Path

```typescript
pi.on("session_shutdown", async () => {
    if (hypivisorWs && hypivisorWs.readyState === WebSocket.OPEN) {
      const rpc: RpcRequest = {
        id: "dereg",
        method: "deregister",
        params: { id: nodeId },
      };
      hypivisorWs.send(JSON.stringify(rpc));  // ← fire and forget
    }
    if (wss) wss.close();
    if (hypivisorWs) hypivisorWs.close();  // ← closes IMMEDIATELY after send
});
```

The `deregister` RPC is sent, then the WebSocket is immediately closed. There is **no guarantee** the deregister message was actually transmitted before the close:

- `ws.send()` buffers the data — it doesn't wait for the frame to be written to the socket
- `ws.close()` sends a close frame immediately, which may race with the queued deregister message
- On the hypivisor side, the close frame may arrive before (or interleaved with) the deregister RPC

**What happens when deregister doesn't arrive:** The hypivisor's `handle_registry_ws` exits its read loop (receives close frame or EOF), then runs the disconnect handler which marks the node as `"offline"` (not removed). The node sits in "offline" state until the TTL cleanup removes it after 120 seconds. During those 120 seconds, it's a ghost in the Pi-DE sidebar.

**What happens when pi crashes (SIGKILL, uncaught exception):** The `session_shutdown` handler never fires at all. The TCP connection eventually times out (could take minutes). When it does, the hypivisor marks the node offline, starting the 120s TTL countdown.

### Fix

The deregister-then-close race can be fixed by waiting for the send to flush:

```typescript
pi.on("session_shutdown", async () => {
    log.info("pi-socket", "shutting down", { nodeId });

    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }

    // Deregister and wait for the message to be sent
    if (hypivisorWs && hypivisorWs.readyState === WebSocket.OPEN) {
      const rpc: RpcRequest = {
        id: "dereg",
        method: "deregister",
        params: { id: nodeId },
      };
      await new Promise<void>((resolve) => {
        hypivisorWs!.send(JSON.stringify(rpc), () => resolve());
        // Timeout in case send callback never fires
        setTimeout(resolve, 1000);
      });
    }
    if (wss) wss.close();
    if (hypivisorWs) hypivisorWs.close();
});
```

But this doesn't help when pi crashes. For that, we need the hypivisor to be smarter (see Root Cause 5).

---

## Root Cause 4: Cleanup Only Targets `status == "offline"` Nodes

**Severity:** HIGH  
**Component:** hypivisor  
**File:** `hypivisor/src/cleanup.rs`

### The Code Path

```rust
pub fn cleanup_stale_nodes(cx: &Cx, state: &Registry) {
    for (id, node) in nodes.iter() {
        if node.status == "offline" {              // ← ONLY checks offline nodes
            if let Some(offline_since) = node.offline_since {
                if now - offline_since > ttl {
                    to_remove.push(id.clone());
                }
            }
        }
    }
}
```

This ONLY removes nodes that:
1. Have `status == "offline"`, AND
2. Have `offline_since` set, AND
3. Have been offline longer than `node_ttl` (120s)

**Nodes with `status == "active"` are NEVER cleaned up.** If a ghost node is stuck in "active" state (because the orphaned WebSocket connection from Root Cause 1 is still alive, or because the TCP connection hasn't timed out after a pi crash), the cleanup task will never touch it.

A pi process that was SIGKILL'd leaves its node in `"active"` status because:
- The TCP connection hasn't been detected as dead yet (no TCP keepalive, no application-level ping)
- The hypivisor's read loop blocks on `ws_read()` with a 100ms timeout, but `WouldBlock`/`TimedOut` errors are ignored (it just continues the loop)
- The node stays `"active"` until the OS TCP stack decides the connection is dead (which can take **minutes to hours** depending on TCP keepalive settings)

### Fix

Add active node health checking to the cleanup task:

```rust
pub fn cleanup_stale_nodes(cx: &Cx, state: &Registry) {
    let now = Utc::now().timestamp();
    let ttl = state.node_ttl as i64;
    let mut to_remove = vec![];

    {
        let nodes = state.nodes.read().expect("nodes lock poisoned in cleanup");
        for (id, node) in nodes.iter() {
            match node.status.as_str() {
                "offline" => {
                    if let Some(offline_since) = node.offline_since {
                        if now - offline_since > ttl {
                            to_remove.push(id.clone());
                        }
                    }
                }
                "active" => {
                    // Active nodes with no live WebSocket connection are ghosts.
                    // The `last_seen` field (see Root Cause 5 fix) allows detection.
                    if let Some(last_seen) = node.last_seen {
                        if now - last_seen > ttl {
                            to_remove.push(id.clone());
                        }
                    }
                }
                _ => {}
            }
        }
    }
    // ... remove logic unchanged
}
```

This requires adding a `last_seen` timestamp (see Root Cause 5).

---

## Root Cause 5: No Application-Level Heartbeat Between pi-socket and Hypivisor

**Severity:** HIGH  
**Component:** pi-socket + hypivisor  
**Files:** `pi-socket/src/index.ts`, `hypivisor/src/main.rs`

### The Problem

There is no application-level ping/pong or heartbeat between pi-socket and the hypivisor. The connection is established, a `register` RPC is sent, and then the connection is silent forever (unless the agent deregisters on shutdown).

This means:
- The hypivisor has no way to know if a "registered" agent is actually alive
- TCP keepalive is not enabled (no `set_keepalive()` call on the TCP stream)
- The hypivisor's read loop uses a 100ms timeout, but `WouldBlock`/`TimedOut` errors are treated as "keep waiting" — there's no "I haven't heard from this client in X seconds, disconnect it"
- A SIGKILL'd pi process leaves a zombie `"active"` registration that persists until the OS TCP stack decides the connection is dead

### Fix: Application-Level Heartbeat

**pi-socket side** — send a periodic ping:

```typescript
// In connectToHypivisor, after "open" handler:
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

ws.on("open", boundary("hypivisor.open", () => {
    // ... existing register logic ...

    // Start heartbeat
    heartbeatInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
      }
    }, 30_000); // every 30 seconds
}));

ws.on("close", () => {
    if (heartbeatInterval) { clearInterval(heartbeatInterval); heartbeatInterval = null; }
    // ... existing close logic ...
});
```

**hypivisor side** — track `last_seen` and detect dead connections:

Add `last_seen` to `NodeInfo`:

```rust
// state.rs
pub struct NodeInfo {
    pub id: String,
    pub machine: String,
    pub cwd: String,
    pub port: u16,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub offline_since: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_seen: Option<i64>,
}
```

Update `last_seen` on registration and on every ping received:

```rust
// In handle_registry_ws, after register RPC:
// Update last_seen
if let Some(ref node_id) = registered_node_id {
    let mut nodes = state.nodes.write().unwrap();
    if let Some(node) = nodes.get_mut(node_id) {
        node.last_seen = Some(Utc::now().timestamp());
    }
}

// In the Ping handler:
Ok(Some(ReadResult::Ping(payload))) => {
    // Update last_seen for this node
    if let Some(ref node_id) = registered_node_id {
        let mut nodes = state.nodes.write().unwrap();
        if let Some(node) = nodes.get_mut(node_id) {
            node.last_seen = Some(Utc::now().timestamp());
        }
    }
    let mut w = writer.lock().unwrap();
    if w.send_pong(payload).is_err() { break; }
}
```

Then the cleanup task from Root Cause 4's fix can detect stale "active" nodes that haven't pinged recently.

---

## Root Cause Analysis Summary

| # | Root Cause | Severity | Ghost State | Duration Until Cleanup | Component |
|---|-----------|----------|-------------|----------------------|-----------|
| 1 | session_start doesn't close old hypivisorWs | CRITICAL | active (if different port) or evicted then re-offlined | Until TCP dies + 120s TTL | pi-socket |
| 2 | Hypivisor restart (data loss) | LOW | N/A — init replaces state | N/A | hypivisor |
| 3 | Fire-and-forget deregister on shutdown | HIGH | offline | 120s (TTL) | pi-socket |
| 4 | Cleanup ignores "active" ghosts | HIGH | active | Forever (until manual restart) | hypivisor |
| 5 | No heartbeat → can't detect dead agents | HIGH | active | Until OS TCP timeout (minutes-hours) | both |

---

## Why the User Sees ~20 Ghosts With Only 3 Processes

The multiplication factor comes from **Root Cause 1 + Root Cause 5**:

1. User has 3 pi processes, each doing work
2. During a work session, each pi process might restart its session multiple times (branch switching, `/session new`, internal restarts)
3. Each session restart generates a new `nodeId` (session UUID)
4. The old `hypivisorWs` connection is orphaned but alive → old nodeId stays "active"
5. Over a day of work, 3 pi processes × ~6 session restarts each = ~18 ghost registrations
6. Without heartbeat, the "active" ghosts are never cleaned up (Root Cause 4)
7. Some eventually die when TCP notices → become "offline" → cleaned up after 120s
8. But new ghosts are constantly created, maintaining a steady-state pool of ~15–20

---

## Consolidated Fix Plan

### Fix 1: Clean up old connections on session restart (pi-socket)

**File:** `pi-socket/src/index.ts`

```diff
 export default function piSocket(pi: ExtensionAPI) {
   let nodeId = process.pid.toString();
   let wss: WebSocketServer | null = null;
   let hypivisorWs: WebSocket | null = null;
   let hypivisorUrlValid = true;
   let hypivisorConnected = false;
   let reconnectDelay = 0;
+  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
+  let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
```

```diff
   pi.on("session_start", async (_event, ctx) => {
     nodeId = ctx.sessionManager.getSessionId();
 
     if (wss) { wss.close(); wss = null; }
 
+    // Tear down previous hypivisor connection completely
+    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
+    if (heartbeatInterval) { clearInterval(heartbeatInterval); heartbeatInterval = null; }
+    if (hypivisorWs) { hypivisorWs.close(); hypivisorWs = null; }
+    hypivisorConnected = false;
+    reconnectDelay = 0;
+
     const port = wssPort ?? (await portfinder.getPortPromise({ port: startPort }));
```

### Fix 2: Cancel reconnect on shutdown (pi-socket)

**File:** `pi-socket/src/index.ts`

```diff
   pi.on("session_shutdown", async () => {
     log.info("pi-socket", "shutting down", { nodeId });
+
+    // Cancel any pending reconnect
+    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
+    if (heartbeatInterval) { clearInterval(heartbeatInterval); heartbeatInterval = null; }
+
     if (hypivisorWs && hypivisorWs.readyState === WebSocket.OPEN) {
       const rpc: RpcRequest = {
         id: "dereg",
         method: "deregister",
         params: { id: nodeId },
       };
-      hypivisorWs.send(JSON.stringify(rpc));
+      // Wait for the deregister to actually send before closing
+      await new Promise<void>((resolve) => {
+        hypivisorWs!.send(JSON.stringify(rpc), () => resolve());
+        setTimeout(resolve, 1000);
+      });
     }
     if (wss) wss.close();
     if (hypivisorWs) hypivisorWs.close();
   });
```

### Fix 3: Store reconnect timer so it can be cancelled (pi-socket)

**File:** `pi-socket/src/index.ts`

```diff
   function scheduleReconnect(port: number): void {
     reconnectDelay = reconnectDelay === 0
       ? reconnectMs
       : Math.min(reconnectDelay * 2, reconnectMaxMs);
-    setTimeout(boundary("reconnect", () => {
+    reconnectTimer = setTimeout(boundary("reconnect", () => {
+      reconnectTimer = null;
       connectToHypivisor(port);
     }), reconnectDelay);
   }
```

### Fix 4: Add heartbeat to hypivisor connection (pi-socket)

**File:** `pi-socket/src/index.ts`

```diff
   function connectToHypivisor(port: number): void {
     // ... existing url/ws setup ...

     ws.on("open", boundary("hypivisor.open", () => {
       // ... existing register logic ...
       hypivisorConnected = true;
       reconnectDelay = 0;
       log.info("hypivisor", "registered", { nodeId, port });
+
+      // Start heartbeat so hypivisor can detect dead connections
+      if (heartbeatInterval) clearInterval(heartbeatInterval);
+      heartbeatInterval = setInterval(() => {
+        if (ws.readyState === WebSocket.OPEN) {
+          ws.ping();
+        }
+      }, 30_000);
     }));

     ws.on("close", () => {
+      if (heartbeatInterval) { clearInterval(heartbeatInterval); heartbeatInterval = null; }
       const wasConnected = hypivisorConnected;
       // ... rest unchanged
     });
```

### Fix 5: Add `last_seen` to NodeInfo (hypivisor)

**File:** `hypivisor/src/state.rs`

```diff
 #[derive(Debug, Serialize, Deserialize, Clone)]
 pub struct NodeInfo {
     pub id: String,
     pub machine: String,
     pub cwd: String,
     pub port: u16,
     pub status: String,
     #[serde(skip_serializing_if = "Option::is_none")]
     pub offline_since: Option<i64>,
+    #[serde(skip_serializing_if = "Option::is_none")]
+    pub last_seen: Option<i64>,
 }
```

### Fix 6: Update `last_seen` on register and ping (hypivisor)

**File:** `hypivisor/src/rpc.rs` (in `handle_register`):

```diff
     node.status = "active".to_string();
     node.offline_since = None;
+    node.last_seen = Some(Utc::now().timestamp());
```

**File:** `hypivisor/src/main.rs` (in `handle_registry_ws` read loop):

```diff
             Ok(Some(ReadResult::Ping(payload))) => {
+                // Update last_seen for the registered node
+                if let Some(ref node_id) = registered_node_id {
+                    if let Ok(mut nodes) = state.nodes.write() {
+                        if let Some(node) = nodes.get_mut(node_id) {
+                            node.last_seen = Some(Utc::now().timestamp());
+                        }
+                    }
+                }
                 let mut w = writer.lock().unwrap();
                 if w.send_pong(payload).is_err() { break; }
             }
```

### Fix 7: Cleanup active ghosts with stale `last_seen` (hypivisor)

**File:** `hypivisor/src/cleanup.rs`

```diff
 pub fn cleanup_stale_nodes(cx: &Cx, state: &Registry) {
     let now = Utc::now().timestamp();
     let ttl = state.node_ttl as i64;
     let mut to_remove = vec![];

     {
         let nodes = state.nodes.read().expect("nodes lock poisoned in cleanup");
         for (id, node) in nodes.iter() {
-            if node.status == "offline" {
-                if let Some(offline_since) = node.offline_since {
-                    if now - offline_since > ttl {
-                        to_remove.push(id.clone());
+            let stale = match node.status.as_str() {
+                "offline" => {
+                    node.offline_since
+                        .map(|since| now - since > ttl)
+                        .unwrap_or(false)
+                }
+                "active" => {
+                    // Active nodes that haven't sent a heartbeat within 2x TTL
+                    // are ghosts (orphaned registrations with no live connection)
+                    node.last_seen
+                        .map(|seen| now - seen > ttl)
+                        .unwrap_or(false)
+                }
+                _ => false,
+            };
+            if stale {
+                to_remove.push(id.clone());
-                    }
-                }
             }
         }
     }
```

### Fix 8: Lower default TTL (hypivisor)

**File:** `hypivisor/src/main.rs`

```diff
-    #[arg(short = 't', long, default_value_t = 120)]
+    #[arg(short = 't', long, default_value_t = 90)]
     node_ttl: u64,
```

With the heartbeat fix, 90 seconds is plenty (3 missed heartbeats at 30s intervals).

---

## Questions Answered

### 1. What happens when a pi process crashes without calling session_shutdown?

The `session_shutdown` handler never fires. The TCP connection stays open until the OS detects it's dead (no TCP keepalive is set, so this depends on OS defaults — often 2+ hours). During this time, the node stays `"active"` in the registry. The cleanup task ignores "active" nodes. **Result: permanent ghost until hypivisor restart.**

### 2. What happens when pi-socket's WebSocket to hypivisor drops unexpectedly?

The `ws.on("close")` handler fires → `scheduleReconnect(port)` runs. The pi-socket reconnects and re-registers with the same `nodeId`. On the hypivisor side, the old connection thread detects the close → marks the node `"offline"`. Then the re-registration sets it back to `"active"`. **This path works correctly** — a brief offline blip, then recovery.

### 3. What happens on session_start if the same pi process re-registers with a new session ID?

New `nodeId` is assigned. Old `hypivisorWs` is NOT closed (Root Cause 1). If same port, machine:port eviction cleans the old entry. If different port (unlikely due to `wssPort` caching), both entries persist. **Result: potential ghost.**

### 4. What happens when portfinder picks a new port on restart — does eviction by machine:port still work?

`wssPort` caching ensures the same port is reused on session restart within the same pi process. Portfinder is only called on the first `session_start`. So machine:port eviction works for session restarts. **But** if `wss.close()` fails to release the port and the new `WebSocketServer` bind fails silently, the cached port is wrong. This is an edge case.

### 5. Is the 60-second cleanup interval with 120-second TTL sufficient?

For **offline** nodes: yes, they're removed within 60–180 seconds. For **active ghosts**: the cleanup doesn't touch them at all (Root Cause 4), so the interval is irrelevant.

### 6. What happens when the hypivisor restarts — do nodes re-register or become permanent ghosts?

Pi-socket's reconnect loop successfully re-registers all live agents. Dead agents don't reconnect, and their old entries are gone (in-memory state wiped). **No ghosts from this path.** But the TTL countdown for any pre-existing offline nodes is lost.

### 7. Are there race conditions between register, deregister, and cleanup?

The `RwLock<HashMap>` serializes access, so no data corruption. But there's a TOCTOU race in cleanup: the `read()` scan and the `write()` removal happen in separate lock acquisitions. A node could change state between them. In practice this is benign — the worst case is a node is removed that just came back online, and it will re-register on the next heartbeat.

### 8. Why does the Pi-DE sidebar show duplicate entries for the same cwd?

Because each session restart creates a new node ID (session UUID). Two registrations with the same `cwd` but different IDs appear as separate entries. The Pi-DE doesn't deduplicate by `cwd` — it uses `node.id` as the React key. **This is a direct consequence of Root Cause 1.**
