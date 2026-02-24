# PID field across protocol, pi-socket, and hypivisor

Add the system PID (`process.pid`) to the node registration flow across all three backend components so it flows through the wire protocol to Pi-DE.

**Files to modify:**
- `hyper-pi-protocol/src/index.ts` — Add `pid?: number` to the `NodeInfo` interface (optional for backward compat)
- `pi-socket/src/index.ts` — Add `pid: process.pid` to the `register` RPC params object inside `connectToHypivisor()` (~line 179)
- `hypivisor/src/state.rs` — Add `pub pid: Option<u32>` to the `NodeInfo` struct with `#[serde(skip_serializing_if = "Option::is_none")]` (follows existing pattern for `offline_since` and `last_seen`)
- Update `hypivisor/src/handlers.rs` test helper `make_node()` to include `pid: None`

**Exported symbols:**
- `hyper-pi-protocol`: `NodeInfo.pid?: number` (TypeScript interface field)
- `hypivisor/src/state.rs`: `NodeInfo.pid: Option<u32>` (Rust struct field)

**Acceptance criteria:**
- `cd hyper-pi-protocol && npm run build` succeeds
- `cd pi-socket && npm run build && npm test` — all tests pass
- `cd hypivisor && cargo test && cargo build` — all tests pass (update test helpers for `pid: None`)
- PID field is optional: old pi-socket versions without PID still register without error
- PID field serializes to JSON when present, omitted when None/undefined
