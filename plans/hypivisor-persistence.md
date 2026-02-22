# Plan: Hypivisor Persistence

## Summary

Add durable storage to the hypivisor so it survives restarts without losing node metadata, connection history, and operational statistics. Currently the registry is in-memory only — a restart wipes all state and agents must re-register.

## Problem

When the hypivisor restarts:
- All node entries are lost
- Pi-DE shows an empty roster until agents reconnect
- No history of which agents were registered, when they connected, or how long they've been active
- Statistics (uptime, message counts, error rates) are lost

Agents do re-register via their reconnect loops, but there's a window where Pi-DE shows nothing, and all historical data is gone permanently.

## Requirements

### Must have
1. **Persist node registry to disk** — nodes survive hypivisor restart
2. **Distinguish "offline" from "unknown"** — after restart, previously-known nodes show as "offline (last seen: ...)" rather than disappearing
3. **Fast startup** — loading persisted state should add <100ms to startup
4. **Atomic writes** — no corruption on crash during write
5. **Backward compatible** — hypivisor works without persistence (fresh start = empty registry, same as today)

### Should have
6. **Connection history** — when each node first registered, reconnection count, last N connect/disconnect timestamps
7. **Operational statistics** — messages relayed, uptime per node, proxy sessions
8. **Configurable storage path** — default `~/.hyper-pi/state/` but overridable via `--data-dir`

### Nice to have
9. **Compaction** — periodically prune stale offline nodes older than TTL (already partially implemented via `cleanup.rs`)
10. **Export/import** — dump registry state as JSON for backup or migration

## Design

### Storage format

**SQLite** via the `rusqlite` crate. Reasons:
- Single file, no daemon, embedded
- ACID transactions — atomic writes, no corruption on crash
- Fast reads — node lookup by ID is indexed
- Well-supported in Rust
- Handles all current and future query patterns (history, stats, search)

Alternative considered: JSON file with write-on-change. Rejected because it doesn't support atomic writes safely (partial write on crash = corruption) and doesn't scale to history/statistics queries.

### Schema

```sql
-- Core registry (replaces in-memory HashMap<String, NodeInfo>)
CREATE TABLE nodes (
    id          TEXT PRIMARY KEY,
    machine     TEXT NOT NULL,
    cwd         TEXT NOT NULL,
    port        INTEGER NOT NULL,
    status      TEXT NOT NULL DEFAULT 'offline',  -- 'active' | 'offline'
    registered_at TEXT NOT NULL,  -- ISO-8601
    last_seen_at  TEXT NOT NULL,  -- ISO-8601, updated on every heartbeat/message
    offline_since TEXT            -- ISO-8601, set when status → offline
);

-- Connection history (append-only)
CREATE TABLE connections (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    node_id     TEXT NOT NULL REFERENCES nodes(id),
    event       TEXT NOT NULL,  -- 'connected' | 'disconnected'
    ts          TEXT NOT NULL,
    peer_addr   TEXT
);

-- Operational statistics (updated periodically)
CREATE TABLE stats (
    node_id         TEXT PRIMARY KEY REFERENCES nodes(id),
    messages_relayed INTEGER NOT NULL DEFAULT 0,
    proxy_sessions   INTEGER NOT NULL DEFAULT 0,
    total_uptime_sec INTEGER NOT NULL DEFAULT 0
);
```

### Integration with existing code

The current `state.rs` defines:

```rust
pub struct AppState {
    pub nodes: RwLock<HashMap<String, NodeInfo>>,
    pub tx: broadcast::Sender<String>,
    pub secret_token: String,
    pub home_dir: PathBuf,
    pub node_ttl: u64,
}
```

Changes:
1. Add a `db: Option<rusqlite::Connection>` field to `AppState` (wrapped in `Mutex` for thread safety)
2. On startup, open/create the SQLite DB. Load all nodes with `status = 'active'` into the in-memory `HashMap` as `offline` (they'll re-register if still running)
3. On `register` RPC: upsert into SQLite + in-memory map
4. On disconnect: update SQLite `status` + `offline_since` + append to `connections`
5. On cleanup (stale node removal): delete from SQLite if past TTL
6. The in-memory `HashMap` remains the authoritative runtime state for performance. SQLite is the durable backing store.

### Startup behavior

1. Open `{data_dir}/hyper-pi.db` (create if missing)
2. Run migrations (create tables if they don't exist)
3. Load all nodes from `nodes` table
4. Set all loaded nodes to `status = 'offline'` (they need to re-register to prove they're alive)
5. Broadcast `init` event with loaded nodes to any connecting Pi-DE — it sees the full roster immediately, with previously-known nodes marked offline

### Write strategy

- **Register/disconnect**: write-through (update SQLite immediately, then in-memory)
- **Statistics**: batch write every 60 seconds to avoid thrashing disk
- **Connection history**: append immediately (append-only table, cheap)

## Implementation steps

1. **Add `rusqlite` dependency** to `Cargo.toml`
2. **Create `src/db.rs` module** — open/create DB, run migrations, CRUD for nodes/connections/stats
3. **Update `src/state.rs`** — add `db` field to `AppState`
4. **Update `src/main.rs`** — open DB on startup, load persisted nodes
5. **Update `src/rpc.rs`** — write-through on register
6. **Update disconnect handler** in `main.rs` — persist offline status + connection event
7. **Update `src/cleanup.rs`** — delete from DB when stale nodes are removed
8. **Add `--data-dir` CLI argument** via clap
9. **Add tests** — startup with existing DB, restart recovery, concurrent access
10. **Update `init` event** — include `last_seen_at` and `registered_at` for each node so Pi-DE can show "last seen 5 minutes ago"

## Testing

- Start hypivisor, register a node, stop hypivisor, restart → node appears as offline with correct metadata
- Register node A, stop hypivisor, restart, register node B → both A (offline) and B (active) visible
- Crash simulation: kill -9 hypivisor mid-write → restart with no corruption
- Backward compat: start with no existing DB → works identically to current behavior

## Future extensions

- **Query API**: `list_connections { node_id }` RPC to fetch connection history from Pi-DE
- **Statistics dashboard**: Pi-DE panel showing per-agent uptime, message volume, error rates
- **Multi-machine replication**: sync the SQLite DB across machines (read-only replicas) for global roster visibility
