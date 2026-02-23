# Fix pi-socket: truncation perf, async boundary, logger

## Problem
1. `buildInitState` truncation is O(n²) — re-serializes entire array on each shift() call, blocks Node event loop
2. `boundary()` doesn't handle async functions — Promise rejections bypass try/catch, crashing pi process
3. `safeSerialize` swallows failures without logging — hardening system can't detect these errors

## Files
- `pi-socket/src/history.ts`
- `pi-socket/src/history.test.ts`
- `pi-socket/src/safety.ts`

## Changes
1. Replace O(n²) truncation with single-pass estimator: compute avg message size, calculate keepCount, slice from end
2. In `boundary()`, check if fn returns a Promise and add `.catch()` for async rejection handling
3. In `safeSerialize`, add `log.error()` call in the catch block

## Tests
Add to `pi-socket/src/history.test.ts`:
- Test: truncation with >500KB payload produces truncated result with fewer messages
- Test: truncated result has `truncated: true` and `totalMessages`

Add to a new `pi-socket/src/safety.test.ts`:
- Test: boundary catches sync errors
- Test: boundary catches async rejections
- Test: boundary returns the wrapper function result
