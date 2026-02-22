# hypivisor

Rust daemon using asupersync (structured concurrency runtime) serving as the Hyper-Pi central registry. WebSocket endpoints at `/ws` (registry) and `/ws/agent/{nodeId}` (proxy). Default port 31415.

## Commands

```bash
cargo build            # Debug build
cargo build --release  # Release build
cargo run              # Run (default port 31415)
cargo run -- -p 9000   # Custom port
cargo test             # Run tests
cargo clippy           # Lint
```

## Environment

- `HYPI_TOKEN` — pre-shared key for authentication (optional)
- `RUST_LOG` — logging filter (default: `hypivisor=info`)

## Source modules

| File | Purpose |
|------|---------|
| `src/main.rs` | Entry point, WebSocket handling, proxy relay |
| `src/state.rs` | `AppState`, `NodeInfo`, `Registry` types |
| `src/rpc.rs` | JSON-RPC dispatch (register, list_nodes, list_directories, spawn_agent) |
| `src/auth.rs` | Token-based authentication |
| `src/fs_browser.rs` | Directory listing for spawn UI |
| `src/spawn.rs` | Agent process spawning |
| `src/cleanup.rs` | Stale node removal |

## WebSocket routes

- `/ws` — Registry. pi-socket agents connect here to register and receive broadcast events.
- `/ws/agent/{nodeId}` — Proxy. Pi-DE connects here; hypivisor relays bidirectionally to the agent's local WebSocket port.
