# hypivisor

Rust daemon (Axum + Tokio) serving as the Hyper-Pi central registry. Single WebSocket endpoint at `/ws`, pure JSON-RPC protocol. Default port 31415.

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
