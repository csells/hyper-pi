# hypivisor

Rust daemon using asupersync (structured concurrency runtime) serving as the Hyper-Pi central registry. WebSocket endpoints at `/ws` (registry) and `/ws/agent/{nodeId}` (proxy). Default port 31415.

## Commands

```bash
cargo build            # Debug build
cargo build --release  # Release build
cargo run              # Run (default port 31415)
cargo run -- -p 9000   # Custom port
cargo test             # Run all tests (89 unit + 18 integration)
cargo clippy           # Lint
cargo tarpaulin --exclude-files src/main.rs --out stdout  # Coverage (81%)
```

## Environment

- `HYPI_TOKEN` — pre-shared key for authentication (optional)
- `RUST_LOG` — logging filter (default: `hypivisor=info`)

## Source modules

The server code lives in `lib.rs` (library crate) so integration tests can start the server in-process and tarpaulin can measure coverage. `main.rs` is a thin CLI wrapper.

| File | Purpose |
|------|---------|
| `src/main.rs` | CLI entry point (44 lines). Parses args, calls into `lib.rs`. |
| `src/lib.rs` | Server core: TCP accept loop, WebSocket upgrade, registry handler, proxy relay, `WsWriter`, `ws_read`. |
| `src/handlers.rs` | Pure logic extracted from the server: routing (`match_route`), init events, proxy lookup, node lifecycle, base64 WebSocket key, handshake building/validation. |
| `src/state.rs` | `AppState`, `NodeInfo`, `NodeStatus`, `Registry` types |
| `src/rpc.rs` | JSON-RPC dispatch (register, deregister, list_nodes, list_directories, spawn_agent, ping) |
| `src/auth.rs` | Token-based authentication |
| `src/fs_browser.rs` | Directory listing for spawn UI |
| `src/spawn.rs` | Agent process spawning with path validation |
| `src/cleanup.rs` | Stale node removal (offline TTL + active ghost detection) |

## Test files

| File | Tests | What's covered |
|------|-------|----------------|
| `src/handlers.rs` (inline) | 33 | Route matching, init event building, proxy lookup, node lifecycle, base64, handshake validation |
| `src/rpc.rs` (inline) | 22 | All RPC methods including error branches (missing params, invalid node, unauthorized deregister) |
| `src/auth.rs` (inline) | 7 | Token matching, URL-encoded tokens, empty secret |
| `src/cleanup.rs` (inline) | 6 | Offline TTL, active ghost detection, reactivation |
| `src/fs_browser.rs` (inline) | 8 | Directory listing, hidden entries, symlink safety, sorting |
| `src/spawn.rs` (inline) | 9 | Path validation, new folder creation, traversal protection |
| `src/lib.rs` (inline) | 4 | `create_state`, `bind`, `ephemeral_cx` |
| `tests/server_integration.rs` | 18 | In-process server: WS connect, init events, register/deregister, broadcasts, auth (401), routing (404/400), proxy errors (offline/missing/unreachable), node offline on disconnect, relay through mock echo agent |

## WebSocket routes

- `/ws` — Registry. pi-socket agents connect here to register and receive broadcast events.
- `/ws/agent/{nodeId}` — Proxy. Pi-DE connects here; hypivisor relays bidirectionally to the agent's local WebSocket port.

## Architecture: lib.rs / main.rs split

The server was split into a library crate (`lib.rs`) and a binary entry point (`main.rs`) for testability:

- **`lib.rs`** exposes `ServerConfig`, `create_state()`, `bind()`, `start_cleanup_thread()`, and `serve()`. Integration tests call these directly to start an in-process server on a random port, which lets tarpaulin instrument all the I/O code paths (TCP accept, WebSocket upgrade, handler dispatch, proxy relay).
- **`handlers.rs`** contains all pure logic extracted from the server handlers. These are unit-testable without any I/O. The server functions in `lib.rs` call into `handlers.rs` for routing, event construction, and state management.
- **`main.rs`** is 44 lines: CLI arg parsing → config → `create_state` → `bind` → `serve`. Excluded from coverage since it's untestable boilerplate.
