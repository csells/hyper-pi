# Add integration tests for reconnect and multi-agent scenarios

## Problem
No integration tests for:
1. Hypivisor restart → Pi-DE reconnect → state is correct (the exact ghost node scenario)
2. Proxy returns error for offline/removed agent (not hang)
3. Rapid agent register/deregister cycles

## Files
- `integration-tests/src/reconnect.test.ts` (new)

## Changes
Add E2E integration tests (real hypivisor binary, no mocks):
1. Test: dashboard connects → hypivisor killed → hypivisor restarted → dashboard reconnects → init has correct nodes (NOT accumulated ghosts)
2. Test: agent registers then deregisters rapidly 5 times → roster stays clean
3. Test: proxy to non-existent nodeId returns error, not hang
4. Test: proxy to offline agent returns error
5. Test: 3 agents in same cwd register/deregister independently without interference

## Constraint
NEVER deduplicate by cwd in any test assertion. Multiple agents in same directory is first-class.
