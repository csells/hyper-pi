# Hyper-Pi Code Review (Codex Reviewer)

**Date:** 2026-02-22  
**Reviewer:** OpenAI Codex (via pi agent)  
**Codebase:** 4,282 lines across 27 source files + 3 spec files  
**Components:** pi-socket, hypivisor, Pi-DE, hyper-pi-protocol, integration-tests

---

## Overall Assessment

This is an impressively well-designed system for its scope. The shared protocol package, two-layer error architecture, pass-through event forwarding, and stale-node eviction logic demonstrate experienced systems thinking. Since the prior review, significant improvements have been made: tests exist across all components, modules are properly split, custom hooks extracted, and structured logging is in place.

**18 issues found** — 3 Critical, 5 High, 7 Medium, 3 Low.

---

## CRITICAL

### C1. `buildInitState` truncation is O(n²)

**File:** `pi-socket/src/history.ts:49-54`  
**Violates:** KISS, Write for Maintainability, Scalability

```typescript
while (messages.length > 10) {
  messages.shift();
  if (JSON.stringify(messages).length <= MAX_INIT_BYTES) break;
}
```

Every iteration re-serializes the entire remaining array. For conversations near the 500KB limit with hundreds of messages, this performs hundreds of full `JSON.stringify` passes — each O(n). Total: O(n² × avg_msg_size). A long session could freeze the pi process for hundreds of milliseconds on every new client connection.

**Fix — estimate drop count, then verify once:**
```typescript
if (serialized.length > MAX_INIT_BYTES) {
  const totalMessages = messages.length;
  const avgSize = serialized.length / messages.length;
  const excess = serialized.length - MAX_INIT_BYTES;
  const dropEstimate = Math.min(
    messages.length - 10,
    Math.ceil(excess / avgSize) + 5
  );
  messages.splice(0, dropEstimate);
  // Single verification — drop 10% more if still over
  while (JSON.stringify(messages).length > MAX_INIT_BYTES && messages.length > 10) {
    messages.splice(0, Math.ceil(messages.length * 0.1));
  }
  return { type: "init_state", messages, tools: tools ?? [], truncated: true, totalMessages };
}
```

### C2. Proxy WebSocket handshake response is never validated

**File:** `hypivisor/src/main.rs:466-468`  
**Violates:** Don't Swallow Errors

```rust
let mut resp_buf = [0u8; 1024];
let _ = agent_stream.read(&mut resp_buf);
// Accept any 101 response — the agent is a local trusted server
```

The read result is discarded. If the agent's WS server is down, returned an HTTP error, or is still starting up, the proxy proceeds to relay garbage bytes — producing corrupt data on the dashboard with zero error feedback.

**Fix:**
```rust
let mut resp_buf = [0u8; 1024];
let n = agent_stream.read(&mut resp_buf)
    .map_err(|e| format!("Agent handshake read: {e}"))?;
let resp_str = String::from_utf8_lossy(&resp_buf[..n]);
if !resp_str.starts_with("HTTP/1.1 101") {
    let mut w = WsWriter::new(stream);
    let err = serde_json::json!({ "error": "Agent WebSocket handshake failed" }).to_string();
    let _ = w.send_text(&err);
    return;
}
```

### C3. SpawnModal has a double-fetch cycle on mount

**File:** `pi-de/src/SpawnModal.tsx:17-28`  
**Violates:** Eliminate Race Conditions, KISS

```typescript
const loadDirs = useCallback(async () => {
  // ...
  const result = await rpcCall(hvWs, "list_directories", currentPath ? { path: currentPath } : {});
  setCurrentPath(result.current);  // ← triggers re-render
  setDirs(result.directories);
}, [hvWs, currentPath]);            // ← currentPath in deps

useEffect(() => {
  loadDirs();
}, [loadDirs]);                      // ← loadDirs changes when currentPath changes
```

On mount, `currentPath` is `""`. The RPC returns `result.current` as `"/Users/csells"`. `setCurrentPath` causes `loadDirs` to be recreated (new dep), re-triggering the effect. This always fires the RPC **twice** on every mount and navigation.

**Fix — separate navigation intent from display state:**
```typescript
const [navigationPath, setNavigationPath] = useState<string | null>(null);
const [currentPath, setCurrentPath] = useState("");

useEffect(() => {
  setError(null);
  rpcCall(hvWs, "list_directories", navigationPath ? { path: navigationPath } : {})
    .then(result => { setCurrentPath(result.current); setDirs(result.directories); })
    .catch(e => setError(e.message));
}, [hvWs, navigationPath]);

const handleNavigate = (dir: string) => setNavigationPath(currentPath + "/" + dir);
```

---

## HIGH

### H1. `NodeInfo.status` is a raw `String` in Rust

**File:** `hypivisor/src/state.rs:8`  
**Violates:** Clear Abstractions & Contracts, Prefer Non-Nullable

```rust
pub status: String,
```

Status is compared against string literals (`"active"`, `"offline"`) across `cleanup.rs`, `rpc.rs`, and `main.rs`. A single typo silently breaks logic with no compiler error.

**Fix:**
```rust
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum NodeStatus { Active, Offline }
```

### H2. Spawned `pi` process inherits stdio and is not detached

**File:** `hypivisor/src/spawn.rs:22-25`  
**Violates:** Write for Maintainability

```rust
Command::new("pi")
    .current_dir(&canonical)
    .spawn()
```

The child inherits the hypivisor's stdin/stdout/stderr. If the hypivisor exits, orphaned children may be killed or write to closed pipes.

**Fix:**
```rust
use std::process::Stdio;
Command::new("pi")
    .current_dir(&canonical)
    .stdin(Stdio::null())
    .stdout(Stdio::null())
    .stderr(Stdio::null())
    .spawn()
```

### H3. `pendingRequests` never cleaned up on WebSocket disconnect

**File:** `pi-de/src/rpc.ts:9`  
**Violates:** Eliminate Race Conditions, Don't Swallow Errors

```typescript
export const pendingRequests = new Map<string, PendingRequest>();
```

When a WebSocket closes, all pending promises stay in the map until the 30-second timeout. Users see a 30-second hang instead of an immediate error on network drops.

**Fix — add `rejectAllPending()` and call from `useHypivisor.ts` `ws.onclose`:**
```typescript
export function rejectAllPending(reason: string): void {
  for (const [id, { reject, timer }] of pendingRequests) {
    clearTimeout(timer);
    reject(new Error(reason));
  }
  pendingRequests.clear();
}
```

### H4. `safeSerialize` drops events silently without logging

**File:** `pi-socket/src/index.ts:176-180`  
**Violates:** Don't Swallow Errors, Observability

```typescript
} catch {
  return '{"type":"error","message":"non-serializable event"}';
}
```

When both serialize attempts fail, no log entry is created. The harden skill never sees this failure.

**Fix:**
```typescript
} catch (e2) {
  log.error("safeSerialize", e2, { note: "both serialize attempts failed" });
  return '{"type":"error","message":"non-serializable event"}';
}
```

### H5. `patchLit.ts` is an unguarded runtime monkey-patch

**File:** `pi-de/src/patchLit.ts` (entire file)  
**Violates:** Clear Abstractions & Contracts, Write for Maintainability

This walks Lit's prototype chain and replaces `ReactiveElement.performUpdate`. It depends on Lit internal APIs (`elementProperties`, `performUpdate` method name, exact class hierarchy). Any Lit version bump could silently break rendering with no error.

**Fix — add defensive guards and version documentation:**
```typescript
try {
  const Ctor = customElements.get("agent-interface");
  if (!Ctor) throw new Error("agent-interface not registered");
  // ... existing patch logic ...
  console.debug("[patchLit] Patched ReactiveElement.performUpdate");
} catch (e) {
  console.error("[patchLit] FAILED — Lit workaround inactive:", e);
}
```

Also add a comment with the specific Lit version targeted and upstream issue link.

---

## MEDIUM

### M1. No `protocol_version` check on Pi-DE side

**File:** `pi-de/src/useHypivisor.ts:19`  
**Violates:** Clear Abstractions & Contracts  
**Requirement:** R-HV-5

The hypivisor sends `"protocol_version": "1"` in the `init` event. Pi-DE ignores it. A breaking protocol change would cause silent failures.

**Fix:**
```typescript
case "init":
  if (data.protocol_version !== "1") {
    console.warn(`[Pi-DE] Unknown hypivisor protocol: ${data.protocol_version}`);
  }
  setNodes(data.nodes);
  break;
```

### M2. `useHypivisor` hardcodes `ws://localhost`

**File:** `pi-de/src/useHypivisor.ts:50`  
**Violates:** Write for Maintainability, Scalability  
**Requirement:** R-CC-7

```typescript
const url = `ws://localhost:${port}/ws${token ? `?token=${token}` : ""}`;
```

If Pi-DE is served from a different machine, this always connects back to the browser's localhost. `useAgent` correctly uses `window.location.hostname`, but `useHypivisor` does not.

**Fix:**
```typescript
const host = window.location.hostname || "localhost";
const url = `ws://${host}:${port}/ws${token ? `?token=${token}` : ""}`;
```

### M3. TOCTOU race in `cleanup.rs` between read lock and write lock

**File:** `hypivisor/src/cleanup.rs:8-25`  
**Violates:** Eliminate Race Conditions

```rust
{
    let nodes = state.nodes.read().expect("...");  // read lock
    for (id, node) in nodes.iter() { /* collect to_remove */ }
}                                                   // read lock dropped
// ← another thread could re-register a node as active here
if !to_remove.is_empty() {
    let mut nodes = state.nodes.write().expect("...");  // write lock
    for id in &to_remove { nodes.remove(id); }   // ← might remove just-reactivated node
}
```

**Fix — single write lock:**
```rust
let mut nodes = state.nodes.write().expect("lock");
let now = Utc::now().timestamp();
let to_remove: Vec<String> = nodes.iter()
    .filter(|(_, n)| n.status == "offline"
        && n.offline_since.map(|t| now - t > ttl).unwrap_or(false))
    .map(|(id, _)| id.clone())
    .collect();
for id in &to_remove { nodes.remove(id); }
```

### M4. `RwLock`/`Mutex` `.expect()` panics throughout hypivisor

**Files:** `main.rs`, `rpc.rs`, `cleanup.rs` — 10+ call sites  
**Violates:** Don't Swallow Errors (cascading panics)

Every lock acquisition uses `.expect("lock poisoned")`. If any thread panics while holding a lock, every subsequent lock access across all connections will cascade-crash the daemon.

**Fix — use `parking_lot::RwLock` (no poisoning), or recover:**
```rust
let nodes = state.nodes.read().unwrap_or_else(|p| p.into_inner());
```

### M5. `base64_ws_key()` uses time-based deterministic "random" bytes

**File:** `hypivisor/src/main.rs:580-600`  
**Violates:** Eliminate Race Conditions

```rust
let seed = SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).unwrap().as_nanos();
```

Two proxy connections in the same nanosecond produce identical keys. Also a custom base64 impl when `base64` or `data-encoding` crates exist.

**Fix:**
```rust
use getrandom::fill;
let mut bytes = [0u8; 16];
fill(&mut bytes).expect("getrandom");
data_encoding::BASE64.encode(&bytes)
```

### M6. Hardcoded provider list in `initStorage.ts`

**File:** `pi-de/src/initStorage.ts:93-95`  
**Violates:** DRY, Write for Maintainability

```typescript
for (const provider of ["anthropic", "openai", "google", "mistral", "groq", "xai", "openrouter", "lmstudio", "bedrock"]) {
```

If `pi-web-ui` adds a new provider, Pi-DE fails the API key guard silently.

**Fix — use a Proxy that returns a truthy key for any lookup:**
```typescript
const origGet = providerKeys.get.bind(providerKeys);
providerKeys.get = async (key: string) => (await origGet(key)) ?? "remote-agent-key";
```

### M7. Missing Inspector pane vs. spec

**File:** `pi-de/src/App.tsx`  
**Violates:** Requirements R-UI-31, R-UI-32

The spec calls for a 3-column layout with an Inspector pane showing tools/skills. App.tsx renders only 2 columns. The tools data flows through `RemoteAgent` → `init_state` → `state.tools` but is never displayed.

---

## LOW

### L1. Unused imports in `RemoteAgent.ts`

**File:** `pi-de/src/RemoteAgent.ts:12`  
**Violates:** Write for Maintainability

```typescript
import type { ImageContent, TextContent, UserMessage } from "@mariozechner/pi-ai";
```

`ImageContent` and `TextContent` are imported but never used.

### L2. Bare error handlers suppress diagnostic info

**File:** `pi-socket/src/index.ts:92,94` and `pi-de/src/useAgent.ts:85`, `pi-de/src/useHypivisor.ts:64`  
**Violates:** Observability & Testability

```typescript
ws.on("error", () => {});
// and
ws.onerror = () => {};
```

WebSocket errors contain useful diagnostic info (ECONNREFUSED, ECONNRESET). Log at warn level:
```typescript
ws.on("error", (err) => log.warn("pi-socket", "ws error", { error: String(err) }));
```

### L3. `any` type usage in SpawnModal

**File:** `pi-de/src/SpawnModal.tsx:29,68`  
**Violates:** Clear Abstractions & Contracts

```typescript
} catch (e: any) {
  setError(e.message);
```

Use `unknown` with type narrowing:
```typescript
} catch (e: unknown) {
  setError(e instanceof Error ? e.message : String(e));
}
```

---

## What Works Well

1. **Shared `hyper-pi-protocol` package** — Single source of truth for wire types, clean re-exports. Textbook DRY.

2. **Two-layer error architecture** — `boundary()` wrapper + `needsHardening` log pattern is production-grade. The explicit rule that `pi.on()` handlers don't need wrapping shows deep understanding of the host runtime.

3. **Pass-through event forwarding** — Forwarding native `AgentEvent` objects instead of decomposing/reconstructing eliminates an entire class of deserialization bugs and keeps pi-socket in automatic sync with upstream pi changes.

4. **Stale node eviction with machine:port dedup** — The `handle_register` logic that evicts prior registrations on the same machine:port is a smart defense against port reuse after session restarts.

5. **Test coverage** — `history.test.ts` covers 10 edge cases; `rpc.rs` tests cover register, deregister, eviction, port conflicts (8 tests); `auth.rs` covers all 4 auth permutations; `RemoteAgent.test.ts` covers the full event lifecycle with realistic data; `rpc.test.ts` covers happy path, errors, and unknowns. Integration tests exercise the real binary.

6. **Exponential backoff with cap** — pi-socket's `scheduleReconnect` doubles the delay up to 5 minutes, with reset on success. Better than fixed-interval polling.

7. **Clean module boundaries** — Hypivisor is split into `auth.rs`, `cleanup.rs`, `fs_browser.rs`, `rpc.rs`, `spawn.rs`, `state.rs`. React hooks (`useHypivisor`, `useAgent`) are properly extracted from `App.tsx`. Each module has a single clear responsibility.

8. **Structured JSONL logging** — pi-socket logs to `~/.pi/logs/pi-socket.jsonl` with levels, components, and `needsHardening` flags. Integrates with the harden skill.

9. **Deregister on shutdown** — pi-socket sends a `deregister` RPC before closing, giving the hypivisor immediate cleanup instead of waiting for TTL.

10. **RemoteAgent state machine** — Clean immutable state updates with proper `pendingToolCalls` tracking. The `queueMicrotask` in `subscribe()` for late joiners prevents synchronous re-entrant emits.

---

## Compliance Matrix (Current State)

| Practice | Status | Notes |
|----------|--------|-------|
| **TDD** | ⚠️ | Tests exist but coverage is incomplete (no useHypivisor, useAgent, SpawnModal, patchLit tests) |
| **DRY** | ✅ | Shared protocol package; re-exports; extracted hooks |
| **Separation of Concerns** | ✅ | Clean component boundaries, extracted modules |
| **SRP** | ✅ | Each file has one responsibility |
| **Clear Abstractions** | ⚠️ | Raw status strings in Rust; `any` types in SpawnModal |
| **Low Coupling** | ✅ | Components communicate only via WebSocket |
| **Scalability** | ⚠️ | In-memory registry (by design); O(n²) truncation |
| **Observability** | ✅ | Structured JSONL in pi-socket; tracing in hypivisor |
| **KISS** | ✅ | Clean, straightforward architecture throughout |
| **YAGNI** | ✅ | No speculative features |
| **Don't Swallow Errors** | ⚠️ | Bare ws error handlers; silent serialize failures |
| **No Placeholder Code** | ✅ | All production code |
| **Layered Architecture** | ✅ | Extension → Daemon → UI layering |
| **Non-Nullable** | ⚠️ | Some nullable React state could use discriminated unions |
| **Async Notifications** | ✅ | WebSocket push throughout |
| **Race Conditions** | ⚠️ | TOCTOU in cleanup; double-fetch in SpawnModal |
| **Maintainability** | ✅ | Well-documented; clear module structure |
| **Idiomatic Arrangement** | ✅ | Standard layouts for Rust/React/TypeScript |

**Scorecard:** 11 ✅ / 7 ⚠️ / 0 ❌

---

## Summary Table

| # | Severity | Component | Issue | Fix Effort |
|---|----------|-----------|-------|------------|
| C1 | Critical | pi-socket | O(n²) truncation in `buildInitState` | Small |
| C2 | Critical | hypivisor | Proxy handshake never validated | Small |
| C3 | Critical | Pi-DE | SpawnModal double-fetch on mount | Small |
| H1 | High | hypivisor | `NodeInfo.status` is raw String | Medium |
| H2 | High | hypivisor | Spawned process not detached | Small |
| H3 | High | Pi-DE | `pendingRequests` not cleaned on disconnect | Small |
| H4 | High | pi-socket | `safeSerialize` drops events silently | Small |
| H5 | High | Pi-DE | `patchLit.ts` unguarded monkey-patch | Small |
| M1 | Medium | Pi-DE | No protocol_version check | Small |
| M2 | Medium | Pi-DE | `useHypivisor` hardcodes localhost | Small |
| M3 | Medium | hypivisor | TOCTOU race in cleanup | Small |
| M4 | Medium | hypivisor | Lock poisoning cascades | Medium |
| M5 | Medium | hypivisor | Time-based WS key generation | Small |
| M6 | Medium | Pi-DE | Hardcoded provider list | Small |
| M7 | Medium | Pi-DE | Missing Inspector pane vs spec | Medium |
| L1 | Low | Pi-DE | Unused imports | Trivial |
| L2 | Low | pi-socket/Pi-DE | Bare error handlers | Small |
| L3 | Low | Pi-DE | `any` type in SpawnModal catches | Trivial |

---

## Priority Recommendations

### Priority 1: Fix Now (causes bugs)
1. Fix O(n²) truncation in `buildInitState` (C1)
2. Validate proxy handshake response (C2)
3. Fix SpawnModal double-fetch (C3)
4. Log `safeSerialize` failures (H4)

### Priority 2: Harden (prevents future bugs)
5. Make `NodeInfo.status` an enum (H1)
6. Detach spawned `pi` processes (H2)
7. Clean up `pendingRequests` on disconnect (H3)
8. Guard `patchLit.ts` with try/catch (H5)
9. Fix TOCTOU in cleanup (M3)

### Priority 3: Polish
10. Add protocol version check (M1)
11. Fix localhost hardcoding (M2)
12. Add tests for `useHypivisor`, `useAgent`, `SpawnModal`
13. Replace lock `.expect()` calls (M4)
14. Use proper RNG for WS key (M5)

---

## Progress Since Prior Review

The codebase has improved significantly since the initial best-practices review:

| Area | Before | After |
|------|--------|-------|
| Tests | ❌ Zero | ✅ Unit + integration across all components |
| Module structure | ⚠️ Monoliths | ✅ Split into focused modules |
| React hooks | ⚠️ Inline in App.tsx | ✅ Extracted `useHypivisor`, `useAgent` |
| Observability | ❌ None | ✅ Structured JSONL logging, tracing |
| Shared types | ⚠️ Duplicated | ✅ `hyper-pi-protocol` package |
| Error handling | ❌ Silent catches | ⚠️ Mostly handled, some gaps remain |
| Linting | ❌ None | ✅ ESLint + TypeScript strict configured |

The architecture is sound and well-executed. The remaining issues are refinements — not fundamental design flaws.
