# Fix hypivisor broadcast thread hang and FD leaks

## Problem
1. `rx.recv().await` blocks forever when no broadcasts arrive. `broadcast_handle.join()` hangs after client disconnect, leaking threads permanently. Currently 63 FDs for 22 connections.
2. 100ms read timeouts cause busy-wait — 10 wakeups/sec per connection doing nothing
3. Proxy thread leak: agent-to-dashboard thread not joined on dashboard disconnect because agent stream stays open

## Files
- `hypivisor/src/main.rs`

## Changes
1. Fix broadcast thread: after read loop exits, shutdown the stream (or drop the cloned stream) to unblock the broadcast forwarder. Then set `broadcast_running = false` and join.
2. Increase read timeout from 100ms to 2000ms for registry WS and proxy WS — reduces CPU burn by 20x while still allowing reasonable disconnect detection
3. Fix proxy thread leak: after dashboard→agent loop breaks, shutdown the agent stream to make agent→dashboard thread's reads fail, then join

## Tests
- Verify existing tests still pass (cargo test)
- The integration tests already test connection/disconnection flows
