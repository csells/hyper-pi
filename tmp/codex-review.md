# Codex Code Review — Hyper-Pi

**Reviewer:** OpenAI Codex (gpt-5.3-codex)
**Date:** 2026-02-22
**Scope:** Full codebase review against base commit `dd95ae2`

## Test Results

| Component | Tests | Result |
|-----------|-------|--------|
| pi-socket | 20 | ✅ All pass |
| Pi-DE | 14 | ✅ All pass |
| integration-tests | 21 | ✅ All pass |
| hypivisor | 21 | ⚠️ 20 pass, 1 fail (`lists_subdirectories` — sandbox PermissionDenied) |

## Findings

### P1 — Broadcast forwarder thread can hang indefinitely on disconnect

**File:** `hypivisor/src/main.rs:342-344`
**Severity:** Critical

The broadcast forwarder thread blocks on `rx.recv(&cx).await` inside an async loop. When a dashboard client disconnects while no broadcasts are pending, the `broadcast_running` flag is set to `false`, but `recv()` never returns — it's waiting for the next message. The subsequent `broadcast_handle.join()` blocks the connection handler thread indefinitely.

**Impact:** Thread leak. Each dashboard disconnect during idle periods leaks a handler thread permanently. Under sustained use this exhausts OS threads.

**Fix:** Use a cancellable wait mechanism — either:
- `tokio::select!` with a shutdown channel/signal
- Periodic timeout on `recv` to check `broadcast_running`
- Drop the `rx` receiver to force `recv` to return `Err`

---

### P2 — Binary frame proxy writes raw payload without WebSocket framing

**File:** `hypivisor/src/main.rs:525-527`
**Severity:** High

In the `agent → dashboard` proxy path, when a binary frame is received, the code calls `send_raw_bytes(&data)` which writes raw payload bytes directly to the TCP stream — without WebSocket frame headers. This corrupts the WebSocket protocol stream.

**Impact:** Any binary WebSocket frame from the agent will break the proxy connection for that session. While currently pi-socket only sends text frames, this is a latent bug that will surface if binary payloads are ever added (attachments, images, etc.).

**Fix:** Use `send_text` with binary encoding, or add a proper `send_binary` method to `WsWriter` that encodes a Binary opcode frame.

---

### P2 — URL-encoded tokens fail authorization

**File:** `hypivisor/src/auth.rs:13`
**Severity:** High

`extract_token_from_query()` returns the raw query string value without URL-decoding. When clients (like browsers or pi-socket using `encodeURIComponent`) encode the token, the comparison fails:

```
Token: "abc+123"
Query: "?token=abc%2B123"
Extracted: "abc%2B123" ≠ "abc+123" → REJECTED
```

**Impact:** Auth fails for any token containing URL-reserved characters (`+`, `=`, `&`, `%`, spaces, etc.). Since Pi-DE's `useHypivisor.ts` does NOT encode the token (line 56: `${token}`), but `useAgent.ts` DOES (line 67: `encodeURIComponent(token)`), a token with special characters would work for the registry connection but fail for agent proxy connections.

**Fix:** URL-decode the extracted value with `percent_encoding::percent_decode_str` or equivalent before comparison.

---

### P2 — Single TCP read may truncate WebSocket upgrade headers

**File:** `hypivisor/src/main.rs:119-128`
**Severity:** High

The WebSocket upgrade handler reads exactly once (`stream.read(&mut buf)`) and immediately parses the result. TCP does not guarantee that the full HTTP upgrade request arrives in a single read — headers can be split across packets, especially under network congestion, MTU fragmentation, or when using proxies/tunnels.

**Impact:** Legitimate WebSocket connections can be rejected with "Invalid HTTP request" when headers arrive in multiple TCP segments. More likely in production (Tailscale/WireGuard tunnels, remote machines) than localhost.

**Fix:** Read in a loop until the `\r\n\r\n` header terminator is found, or the buffer is full, before parsing.

---

### Additional Observations

| Area | Observation |
|------|-------------|
| **Test flake** | `fs_browser::tests::lists_subdirectories` fails under sandboxed environments (macOS sandbox denies `~/.hypi_test_list` creation). Use `std::env::temp_dir()` as base path instead of `dirs::home_dir()`. |
| **Multi-machine proxy** | `handle_proxy_ws` hardcodes `127.0.0.1` for agent connections (line 438). Per R-CC-5/R-CC-7, agents on remote machines will have their connections proxied to localhost, which will always fail. Should use `node.machine` hostname for cross-machine routing. |
| **Hardcoded `localhost`** | Pi-DE's `useHypivisor.ts:56` hardcodes `ws://localhost:${port}`. Won't work when Pi-DE is served from a different host. Should use `window.location.hostname`. |
| **Token inconsistency** | `useHypivisor.ts` does not URL-encode the token in the query string, but `useAgent.ts` does. Both should be consistent (encode). |
| **`base64_ws_key` weakness** | `hypivisor/src/main.rs:593-622` generates WebSocket keys from `SystemTime::now().as_nanos()` — low entropy, deterministic per-nanosecond. While the key only needs to be unique (not cryptographic), RFC 6455 says "randomly selected". Use `rand` crate or `/dev/urandom`. |
