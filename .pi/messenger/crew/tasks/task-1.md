# Fix ghost nodes in useHypivisor.ts

## Problem
When the hypivisor restarts, Pi-DE reconnects and receives BOTH an `init` snapshot AND `node_joined` broadcasts as agents re-register with NEW session IDs. Since `node_joined` filters by `n.id !== data.node.id`, entries accumulate (2→4→8). Also, `connect()` nulls `ws.onclose` but NOT `ws.onmessage` on the old WS.

## Files
- `pi-de/src/useHypivisor.ts`

## Changes
1. Add `initReceived` flag — drop all incremental events (`node_joined`, `node_offline`, `node_removed`) until `init` arrives
2. In `connect()`, null BOTH `ws.onclose` AND `ws.onmessage` before closing old WS
3. Use `window.location.hostname` instead of hardcoded `localhost` (Codex P1-5)

## Tests
Add tests in `pi-de/src/useHypivisor.test.ts`:
- Test: incremental events before init are dropped
- Test: init replaces full node list
- Test: reconnect nulls old WS handlers

## Constraint
NEVER deduplicate nodes by cwd. Only `id` is valid for dedup in node_joined.
