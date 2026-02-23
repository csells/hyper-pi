# Hyper-Pi Best Practices Review — Gemini Reviewer

**Date:** 2026-02-22  
**Scope:** Full codebase — pi-socket, hypivisor, pi-de, hyper-pi-protocol, integration-tests  
**Methodology:** Line-by-line review of all source files against the project's AGENTS.md architectural principles

---

## Executive Summary

The hyper-pi project demonstrates strong architectural fundamentals: clean separation across four components, a well-defined shared protocol package, a disciplined two-layer error architecture in pi-socket, and comprehensive integration tests. The codebase follows its own documented principles with high fidelity.

That said, there are meaningful improvement opportunities across security, type safety, race condition resilience, and DRY compliance. The findings below are ordered by severity within each category.

---

## Findings

### 1. Security — Token in WebSocket Query String

- **Category:** Security  
- **Severity:** High  
- **Files:** `pi-socket/src/index.ts`, `pi-de/src/useHypivisor.ts`, `pi-de/src/useAgent.ts`, `hypivisor/src/auth.rs`  
- **Description:** The auth token (`HYPI_TOKEN`) is passed as a URL query parameter (`?token=...`). Query strings are logged by proxies, appear in browser history, and are visible in network inspector tabs. The `is_authorized` function uses a simple string equality check with no constant-time comparison, making it theoretically vulnerable to timing attacks.
- **Recommendation:**  
  - Pass the token as a WebSocket subprotocol header or in the first message after connection.  
  - Use constant-time comparison for token validation:
    ```rust
    // auth.rs
    use subtle::ConstantTimeEq;
    pub fn is_authorized(token: Option<&str>, secret: &str) -> bool {
        if secret.is_empty() { return true; }
        match token {
            Some(t) => t.as_bytes().ct_eq(secret.as_bytes()).into(),
            None => false,
        }
    }
    ```

---

### 2. Race Conditions — WebSocket Reconnect State Machine

- **Category:** Race Conditions & Concurrency  
- **Severity:** High  
- **Files:** `pi-de/src/useAgent.ts`  
- **Description:** The `useAgent` hook has a potential race where a stale `connect()` closure fires after the effect cleanup has run. The `closed` flag mitigates this for `onclose`, but `onopen` and `onmessage` handlers can still fire after cleanup if the WebSocket was mid-handshake. When a user rapidly switches between agents, multiple WebSocket connections can overlap — `remoteAgent.connect(ws)` on the new WS may be called while events from the old WS still arrive on the RemoteAgent's listener because `disconnect()` only sets `this.ws = null` but doesn't remove the `addEventListener` from the old WS.
- **Recommendation:**  
  - In `RemoteAgent.connect()`, store the ws reference and in the message listener, check `if (ws !== this.ws) return;` to reject events from stale connections.
  - Alternatively, use `AbortController` for the addEventListener:
    ```typescript
    // RemoteAgent.ts
    private abortController: AbortController | null = null;

    connect(ws: WebSocket): void {
      this.disconnect(); // clean up previous
      this.ws = ws;
      this.abortController = new AbortController();
      ws.addEventListener("message", (event) => {
        const data = JSON.parse(event.data as string) as SocketEvent;
        this.handleSocketEvent(data);
      }, { signal: this.abortController.signal });
    }

    disconnect(): void {
      this.abortController?.abort();
      this.abortController = null;
      this.ws = null;
      // ...reset state
    }
    ```

---

### 3. Security — Spawn Agent Path Traversal

- **Category:** Security  
- **Severity:** High  
- **Files:** `hypivisor/src/spawn.rs`  
- **Description:** The `spawn_agent` function enforces `canonical.starts_with(home_dir)`, but `new_folder` is not sanitized for path traversal before being appended. A crafted `new_folder` like `../../etc` would be caught by `canonicalize()` + `starts_with()`, but the `create_dir_all()` call happens _before_ the canonicalize check, meaning directories could be created outside the home directory before the check rejects the path.
- **Recommendation:**  
  - Validate `new_folder` contains no path separators and no `..` components before calling `create_dir_all`:
    ```rust
    if !new_folder.is_empty() {
        if new_folder.contains('/') || new_folder.contains('\\') || new_folder.contains("..") {
            return Err("Invalid folder name".into());
        }
        target.push(new_folder);
    }
    ```
  - Move the `canonicalize` + `starts_with` check before `create_dir_all`.

---

### 4. Type Safety — `any` Usage in SpawnModal

- **Category:** Type Safety  
- **Severity:** Medium  
- **Files:** `pi-de/src/SpawnModal.tsx`  
- **Description:** Two `catch (e: any)` patterns use `any` for the caught error, and `rpcCall` returns an untyped result (`const result = await rpcCall(...)`) that is accessed with `.current` and `.directories` without type validation.
- **Recommendation:**  
  - Define a response type and use it:
    ```typescript
    interface ListDirsResult { current: string; directories: string[] }
    const result = await rpcCall<ListDirsResult>(hvWs, "list_directories", ...);
    ```
  - Replace `catch (e: any)` with `catch (e: unknown)` and use `e instanceof Error ? e.message : String(e)`.

---

### 5. Architecture — `main.rs` God Module

- **Category:** Architecture & Separation of Concerns  
- **Severity:** Medium  
- **Files:** `hypivisor/src/main.rs`  
- **Description:** `main.rs` is 440+ lines and combines multiple responsibilities: TCP listener, HTTP parsing, WebSocket upgrade, registry WS handler, proxy WS handler, bidirectional relay, WsWriter struct, ReadResult enum, ws_read function, and base64 key generation. The file handles 6+ distinct concerns.
- **Recommendation:**  
  - Extract `WsWriter`, `ReadResult`, and `ws_read` into `ws.rs` (or `transport.rs`).
  - Extract `handle_proxy_ws` and `base64_ws_key` into `proxy.rs`.
  - Extract `handle_registry_ws` into its own module or combine with `rpc.rs`.
  - Keep `main.rs` as just startup + routing:
    ```
    main.rs       → CLI parsing, TcpListener, route to handler
    ws.rs         → WsWriter, ReadResult, ws_read
    registry.rs   → handle_registry_ws
    proxy.rs      → handle_proxy_ws, base64_ws_key
    ```

---

### 6. Error Handling — Swallowed WebSocket Errors

- **Category:** Error Handling  
- **Severity:** Medium  
- **Files:** `pi-socket/src/index.ts` (lines with `ws.on("error", () => {})`)  
- **Description:** Three WebSocket `error` event handlers are empty no-ops: on the WSS server, on client connections, and on the hypivisor WS. While the AGENTS.md documents that pi-socket catches errors in `boundary()`, these are _inner layer_ errors that should be logged for observability, not silently swallowed.
- **Recommendation:**  
  ```typescript
  // pi-socket/src/index.ts
  ws.on("error", (err) => {
    log.warn("ws-client", "WebSocket error", { error: String(err) });
  });
  
  wss.on("error", (err) => {
    log.warn("wss", "WebSocket server error", { error: String(err) });
  });
  ```
  These are known/expected errors, so `log.warn` (not `log.error`) is appropriate per the two-layer architecture.

---

### 7. DRY — Duplicated WebSocket URL Construction

- **Category:** DRY Violations  
- **Severity:** Medium  
- **Files:** `pi-de/src/useHypivisor.ts`, `pi-de/src/useAgent.ts`  
- **Description:** Both hooks independently construct WebSocket URLs with token query parameters and hypivisor port. `useAgent.ts` reads `VITE_HYPIVISOR_PORT` and `VITE_HYPI_TOKEN` from `import.meta.env` directly, duplicating the same logic from `App.tsx` / `useHypivisor.ts`.
- **Recommendation:**  
  - Extract a shared config module:
    ```typescript
    // config.ts
    export const HYPI_TOKEN = import.meta.env.VITE_HYPI_TOKEN || "";
    export const HYPIVISOR_PORT = parseInt(import.meta.env.VITE_HYPIVISOR_PORT || "31415", 10);
    export const HYPIVISOR_HOST = window.location.hostname;
    
    export function hypivisorWsUrl(path: string = "/ws"): string {
      const base = `ws://${HYPIVISOR_HOST}:${HYPIVISOR_PORT}${path}`;
      return HYPI_TOKEN ? `${base}?token=${encodeURIComponent(HYPI_TOKEN)}` : base;
    }
    ```

---

### 8. Race Conditions — Hypivisor Proxy Handshake Validation

- **Category:** Race Conditions & Concurrency  
- **Severity:** Medium  
- **Files:** `hypivisor/src/main.rs` (handle_proxy_ws)  
- **Description:** The agent-side WebSocket handshake response is read but never validated — the comment says "Accept any 101 response." If the agent's WSS is down or returns an HTTP error, the proxy proceeds anyway with a non-WebSocket stream, silently corrupting all subsequent frames.
- **Recommendation:**  
  ```rust
  let n = agent_stream.read(&mut resp_buf)
      .map_err(|e| format!("Agent handshake read failed: {e}"))?;
  let response = String::from_utf8_lossy(&resp_buf[..n]);
  if !response.contains("101") {
      // Send error to dashboard and return
      let mut w = WsWriter::new(stream);
      let _ = w.send_text(&serde_json::json!({"error": "Agent WebSocket handshake failed"}).to_string());
      return;
  }
  ```

---

### 9. Rust Idioms — String Status Instead of Enum

- **Category:** Rust Idioms  
- **Severity:** Medium  
- **Files:** `hypivisor/src/state.rs`  
- **Description:** `NodeInfo.status` is `String` rather than an enum. Throughout the codebase, it's compared against string literals like `"active"`, `"offline"`. This loses compile-time safety — a typo like `"actve"` would silently mismatch.
- **Recommendation:**  
  ```rust
  #[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
  #[serde(rename_all = "lowercase")]
  pub enum NodeStatus {
      Active,
      Offline,
  }
  
  pub struct NodeInfo {
      // ...
      pub status: NodeStatus,
  }
  ```

---

### 10. Testing — No Unit Tests for `useHypivisor` and `useAgent`

- **Category:** Testing  
- **Severity:** Medium  
- **Files:** `pi-de/src/useHypivisor.ts`, `pi-de/src/useAgent.ts`  
- **Description:** The two core hooks that manage all WebSocket state have zero unit tests. The integration tests cover the full flow but don't test edge cases like: rapid node switching, reconnection behavior, status transitions, or stale event rejection.
- **Recommendation:**  
  - Write hook tests using `@testing-library/react-hooks` (or `renderHook` from `@testing-library/react`) with mocked WebSockets.
  - Test: connect → disconnect → reconnect cycle, stale events from previous connections, node switching mid-stream.

---

### 11. Configuration — Hardcoded Reconnect Delays

- **Category:** Configuration  
- **Severity:** Low  
- **Files:** `pi-de/src/useHypivisor.ts` (5000ms), `pi-de/src/useAgent.ts` (3000ms)  
- **Description:** Reconnection delays are hardcoded magic numbers without exponential backoff. If the hypivisor is down for an extended period, clients hammer it every 3-5 seconds indefinitely.
- **Recommendation:**  
  - Implement exponential backoff with jitter matching pi-socket's pattern:
    ```typescript
    const RECONNECT_BASE_MS = 3000;
    const RECONNECT_MAX_MS = 60_000;
    let delay = RECONNECT_BASE_MS;
    // on disconnect:
    delay = Math.min(delay * 2, RECONNECT_MAX_MS);
    // on successful connect:
    delay = RECONNECT_BASE_MS;
    ```

---

### 12. Type Safety — `NodeInfo.status` String vs Union in Protocol

- **Category:** Type Safety  
- **Severity:** Low  
- **Files:** `hyper-pi-protocol/src/index.ts`, `hypivisor/src/state.rs`  
- **Description:** The protocol defines `NodeInfo.status` as `"active" | "offline"` (a union type), but the Rust `NodeInfo` uses `String`. If the Rust side ever sends a different value (e.g., `"error"`), TypeScript consumers would accept it at runtime but the type says they shouldn't. There's no runtime validation on either side.
- **Recommendation:**  
  - This is low severity because the Rust code only ever sets `"active"` or `"offline"`, but making the Rust side use an enum (Finding #9) would make both sides agree at the type level.

---

### 13. Observability — No Client-Side Error Logging

- **Category:** Observability  
- **Severity:** Low  
- **Files:** `pi-de/src/useHypivisor.ts`, `pi-de/src/useAgent.ts`, `pi-de/src/RemoteAgent.ts`  
- **Description:** WebSocket errors are silently swallowed (`ws.onerror = () => {}`). JSON parse errors would throw unhandled. There's no structured logging on the client side — failures are invisible unless the user happens to have DevTools open.
- **Recommendation:**  
  - Add a lightweight client-side logger:
    ```typescript
    ws.onerror = (event) => {
      console.warn("[pi-de] WebSocket error:", event);
    };
    ```
  - Wrap JSON.parse calls in RemoteAgent.connect:
    ```typescript
    ws.addEventListener("message", (event) => {
      try {
        const data = JSON.parse(event.data as string) as SocketEvent;
        this.handleSocketEvent(data);
      } catch (err) {
        console.warn("[pi-de] Failed to parse socket event:", err);
      }
    });
    ```

---

### 14. Rust Idioms — Manual Base64 and WebSocket Key Generation

- **Category:** Rust Idioms / Security  
- **Severity:** Low  
- **Files:** `hypivisor/src/main.rs` (`base64_ws_key`)  
- **Description:** The `base64_ws_key` function uses a timestamp-derived seed to generate the WebSocket key. While WebSocket keys don't need cryptographic randomness (they're just for handshake verification), the manual base64 encoder is fragile and the "seed" is highly predictable. The `asupersync` crate or a `base64` crate would be more idiomatic.
- **Recommendation:**  
  - If a `base64` crate is acceptable:
    ```rust
    fn base64_ws_key() -> String {
        use std::time::SystemTime;
        let seed = SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).unwrap().as_nanos();
        base64::engine::general_purpose::STANDARD.encode(seed.to_le_bytes())
    }
    ```
  - At minimum, add a comment explaining why cryptographic randomness isn't needed here.

---

### 15. Architecture — `patchLit.ts` Fragility

- **Category:** Architecture & Separation of Concerns  
- **Severity:** Low  
- **Files:** `pi-de/src/patchLit.ts`  
- **Description:** The Lit monkey-patch walks prototype chains and deletes own properties to fix class-field-shadowing. This is a workaround for a Lit/ES2022 incompatibility. It's well-documented but extremely fragile — any Lit version update could break it silently.
- **Recommendation:**  
  - Add a version assertion at the top to fail loudly if pi-web-ui's Lit version changes:
    ```typescript
    const litVersion = (window as any).litElementVersions?.[0];
    if (litVersion && litVersion !== "4.x.x") {
      console.warn(`[patchLit] Untested Lit version: ${litVersion}. Patch may be unnecessary or broken.`);
    }
    ```
  - Track upstream Lit issue and remove the patch when the fix lands.

---

### 16. Testing — Truncation Path in `buildInitState` Not Covered

- **Category:** Testing  
- **Severity:** Low  
- **Files:** `pi-socket/src/history.test.ts`, `pi-socket/src/history.ts`  
- **Description:** The `MAX_INIT_BYTES = 500KB` truncation logic has no test. The test file covers empty, single, multi-message, and defensive cases, but never exercises the code path where `serialized.length > MAX_INIT_BYTES` and messages are shifted.
- **Recommendation:**  
  ```typescript
  it("truncates when messages exceed MAX_INIT_BYTES", () => {
    const bigMessage = {
      type: "message",
      message: {
        role: "user",
        content: "x".repeat(100_000),
        timestamp: 1000,
      },
    };
    // 6 messages × 100KB each > 500KB limit
    const entries = Array.from({ length: 6 }, (_, i) => ({
      ...bigMessage,
      message: { ...bigMessage.message, timestamp: i * 1000 },
    }));
    const result = buildInitState(entries, []);
    expect(result.truncated).toBe(true);
    expect(result.totalMessages).toBe(6);
    expect(result.messages.length).toBeLessThan(6);
  });
  ```

---

### 17. DRY — `rpcCall` Return Type Not Constrained

- **Category:** Type Safety  
- **Severity:** Low  
- **Files:** `pi-de/src/rpc.ts`  
- **Description:** `rpcCall<TResult>` allows any type parameter but performs no runtime validation. Callers like SpawnModal use the result without checking structure. This is standard TypeScript practice (trust the server), but the generic is never constrained, making it easy to misuse.
- **Recommendation:**  
  - This is acceptable for the current codebase size, but consider adding a Zod schema or runtime validator if the RPC surface grows.

---

### 18. YAGNI — `connectRawWs` Helper

- **Category:** YAGNI  
- **Severity:** Low  
- **Files:** `integration-tests/src/helpers.ts`  
- **Description:** `connectRawWs` is exported but never used anywhere in the test suite. The auth tests use `connectWs` which already throws on connection failure.
- **Recommendation:**  
  - Remove `connectRawWs` or add a test that uses it. Dead code obscures intent.

---

### 19. Observability — Truncation Loop Performance

- **Category:** Observability  
- **Severity:** Low  
- **Files:** `pi-socket/src/history.ts`  
- **Description:** The truncation loop re-serializes the entire messages array on every iteration (`JSON.stringify(messages)`) until it fits under `MAX_INIT_BYTES`. For a large conversation (e.g., 500 messages), this is O(n²) serialization work.
- **Recommendation:**  
  ```typescript
  // Binary-search-style: estimate bytes per message and skip ahead
  const avgBytes = serialized.length / messages.length;
  const targetCount = Math.floor(MAX_INIT_BYTES / avgBytes);
  if (targetCount < messages.length) {
    messages.splice(0, messages.length - Math.max(targetCount, 10));
    // One final check
    while (messages.length > 10 && JSON.stringify(messages).length > MAX_INIT_BYTES) {
      messages.shift();
    }
  }
  ```

---

### 20. Configuration — Missing `.env.example`

- **Category:** Configuration  
- **Severity:** Low  
- **Files:** Project root  
- **Description:** The project uses several environment variables (`HYPI_TOKEN`, `PI_SOCKET_PORT`, `PI_SOCKET_RECONNECT_MS`, `HYPIVISOR_WS`, `VITE_HYPI_TOKEN`, `VITE_HYPIVISOR_PORT`, `RUST_LOG`) but there's no `.env.example` documenting them.
- **Recommendation:**  
  - Add `.env.example` to project root:
    ```env
    # Shared auth token (must match across all components)
    HYPI_TOKEN=
    
    # pi-socket
    PI_SOCKET_PORT=8080
    PI_SOCKET_RECONNECT_MS=5000
    HYPIVISOR_WS=ws://localhost:31415/ws
    
    # pi-de (Vite)
    VITE_HYPI_TOKEN=
    VITE_HYPIVISOR_PORT=31415
    
    # hypivisor
    RUST_LOG=hypivisor=info
    ```

---

## Summary Table

| # | Category | Severity | Finding |
|---|----------|----------|---------|
| 1 | Security | High | Token in query string, no constant-time comparison |
| 2 | Race Conditions | High | Stale WebSocket events reach RemoteAgent after disconnect |
| 3 | Security | High | Spawn path traversal: mkdir before canonicalize check |
| 4 | Type Safety | Medium | `any` usage and untyped RPC results in SpawnModal |
| 5 | Architecture | Medium | main.rs is a 440-line god module |
| 6 | Error Handling | Medium | Swallowed WebSocket errors without logging |
| 7 | DRY | Medium | Duplicated WS URL/token construction across hooks |
| 8 | Race Conditions | Medium | Proxy accepts non-101 handshake responses |
| 9 | Rust Idioms | Medium | String status instead of enum |
| 10 | Testing | Medium | No unit tests for useHypivisor/useAgent hooks |
| 11 | Configuration | Low | Hardcoded reconnect delays, no backoff in pi-de |
| 12 | Type Safety | Low | Protocol union vs Rust String mismatch |
| 13 | Observability | Low | No client-side error logging |
| 14 | Rust Idioms | Low | Manual base64 encoder |
| 15 | Architecture | Low | patchLit fragility, no version guard |
| 16 | Testing | Low | Truncation path untested |
| 17 | Type Safety | Low | Unconstrained rpcCall generic |
| 18 | YAGNI | Low | Unused connectRawWs helper |
| 19 | Observability | Low | O(n²) truncation serialization |
| 20 | Configuration | Low | Missing .env.example |

---

## Positive Observations

1. **Shared protocol package** (`hyper-pi-protocol`) is well-executed — single source of truth for wire types, re-exported cleanly by both consumers.
2. **Two-layer error architecture** in pi-socket is consistently applied — `boundary()` wraps all Node event-loop callbacks, `pi.on()` handlers correctly rely on pi's built-in error catching.
3. **Integration tests** are excellent — real binary, real WebSocket connections, comprehensive scenarios including auth, fan-out, reconnection, and deregistration.
4. **Defensive coding** in `buildInitState` handles null, non-array, missing role, and missing message fields.
5. **Structured logging** in pi-socket is well-designed with `needsHardening` markers for the hardening skill.
6. **Event forwarding pass-through** design (no stateful reconstruction) is an elegant architectural choice that keeps RemoteAgent thin and reliable.
7. **Stale node eviction** (same machine:port) in the hypivisor prevents ghost registrations.
