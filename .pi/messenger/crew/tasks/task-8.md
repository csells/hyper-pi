# Fix hypivisor NodeStatus enum and deregister auth

## Problem
1. `NodeInfo.status` is `String` — typos compile silently, no exhaustive matching
2. `deregister` RPC has no authorization — any client can remove any node

## Files
- `hypivisor/src/state.rs`
- `hypivisor/src/rpc.rs`
- `hypivisor/src/cleanup.rs`
- `hypivisor/src/main.rs` (status comparisons)

## Changes
1. Replace `pub status: String` with `pub enum NodeStatus { Active, Offline }` with `#[serde(rename_all = "lowercase")]`
2. Update all code that compares `node.status == "active"` / `"offline"` to use the enum
3. Pass `registered_node_id` into dispatch context. In `handle_deregister`, verify the caller's registered node ID matches the deregister target, OR allow deregister if no registered_node_id (for dashboard admin use)

## Tests
- Existing tests should compile and pass with the new enum
- Add test: deregister fails when caller doesn't own the node
- Add test: deregister succeeds when caller owns the node
