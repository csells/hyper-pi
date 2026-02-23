# Fix rpc.ts pending requests leak and SpawnModal loop

## Problem
1. `pendingRequests` Map never cleaned on WS close — promises linger up to 30s, UI shows stale loading states
2. SpawnModal `loadDirs` depends on `currentPath` but also sets `currentPath` — infinite re-fetch risk
3. `catch (e: any)` should be `catch (e: unknown)`

## Files
- `pi-de/src/rpc.ts`
- `pi-de/src/rpc.test.ts`
- `pi-de/src/SpawnModal.tsx`

## Changes
1. Add `rejectAllPending(reason: string)` function to rpc.ts that clears all pending requests and rejects their promises
2. Export it so useHypivisor can call it from onclose
3. Fix SpawnModal: remove `currentPath` from `loadDirs` deps, pass it as parameter instead
4. Fix `catch (e: any)` → `catch (e: unknown)` with proper narrowing

## Tests
Add to `pi-de/src/rpc.test.ts`:
- Test: rejectAllPending rejects all pending and clears map
- Test: rejectAllPending clears timeouts
