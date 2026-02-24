# F7: Add PID field to protocol, pi-socket, and hypivisor

# Add System PID for Debugging

## Goal
Show the system PID in Pi-DE's agent metadata for debugging purposes.

## Changes Required

### 1. hyper-pi-protocol/src/index.ts
Add optional `pid?: number` field to the `NodeInfo` interface.

### 2. pi-socket/src/index.ts
In the `register` RPC params (inside `session_start` handler), add `pid: process.pid`.

### 3. hypivisor (Rust)
Find the NodeInfo/NodeEntry struct in the hypivisor Rust code and add a `pid` field.
The hypivisor needs to:
- Accept `pid` in the register RPC params
- Store it in the node registry
- Include it in `init` events, `node_joined` events, and `list_nodes` responses

Use `find hypivisor/src -name "*.rs" | xargs grep -l "NodeInfo\|node_joined\|register"` to find the relevant files.

### 4. pi-de/src/App.tsx
Display the PID in the node card metadata: `{node.machine}:{node.port} (PID: {node.pid})`.

## Testing
- `cd hyper-pi-protocol && npm run build` — verify protocol builds
- `cd pi-socket && npm run build` — verify pi-socket builds
- `cd hypivisor && cargo test` — verify Rust tests pass
- `cd pi-de && npm run build && npm test` — verify Pi-DE builds and tests pass

## Key Constraint
- The `pid` field MUST be optional in the protocol (older pi-socket versions won't send it)
- The hypivisor MUST handle missing `pid` gracefully (default to None/null)

