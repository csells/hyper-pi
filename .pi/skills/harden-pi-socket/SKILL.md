---
name: harden-pi-socket
description: >
  Review pi-socket error log and harden the code. Triggers when asked to
  "harden pi-socket", "check pi-socket errors", "review extension errors",
  or "fix pi-socket crashes". Reads the structured error log at
  ~/.pi/logs/pi-socket-errors.jsonl and proposes code changes that
  eliminate each error class so it never recurs.
---

# Harden pi-socket

## When to use

Run this skill periodically or after observing issues with the pi-socket
extension. It reads the structured error log, analyzes each error class,
and proposes targeted code changes to eliminate them.

## How it works

The pi-socket extension has a two-layer error architecture:

1. **Inner layer**: Known errors handled at their source with specific
   logic (safeSerialize, readyState guards, defensive property access).
2. **Outer layer**: A `boundary()` wrapper on every Node event-loop
   callback that catches _unanticipated_ errors and logs them to
   `~/.pi/logs/pi-socket-errors.jsonl`.

**The log should be empty in a well-functioning system.** Every entry
represents a gap in the inner layer. This skill closes those gaps.

## Procedure

### Step 1: Read the error log

```bash
cat ~/.pi/logs/pi-socket-errors.jsonl 2>/dev/null || echo "No errors logged — system is healthy."
```

If the file is empty or doesn't exist, the system is healthy. Done.

### Step 2: Group errors by boundary and message

Each line is a JSON object:
```json
{"ts":"...","boundary":"wss.connection","error":"...","stack":"...","version":"0.1.0","nodeId":"..."}
```

Group by `boundary` + `error` to find distinct error classes. Count
occurrences of each. Most-frequent first.

### Step 3: For each error class, read the relevant source code

The boundary names map to source locations:

| Boundary | Source file | What runs there |
|----------|------------|-----------------|
| `wss.connection` | `pi-socket/src/index.ts` (wss.on "connection" handler) | buildInitState, safeSerialize, ws.send |
| `ws.message` | `pi-socket/src/index.ts` (ws.on "message" handler) | pi.sendUserMessage |
| `hypivisor.open` | `pi-socket/src/index.ts` (ws.on "open" handler) | JSON.stringify, ws.send for registration |
| `reconnect` | `pi-socket/src/index.ts` (setTimeout callback) | connectToHypivisor |

Read:
- `pi-socket/src/index.ts`
- `pi-socket/src/history.ts`
- `pi-socket/src/safety.ts`
- `pi-socket/src/types.ts`

### Step 4: For each error class, propose a targeted fix

The fix should go in the **inner layer** — handle the specific error at
its source so the outer layer's boundary() wrapper never catches it again.

Criteria for a good fix:
- **Specific**: Handles exactly this error condition, not a blanket catch
- **Tested**: Includes a test case that reproduces and verifies the fix
- **Eliminates the class**: After the fix, this error can never recur
- **No silent swallowing**: If the error indicates a real problem (e.g.,
  pi's API changed), the fix should also update the AGENTS.md or
  requirements to reflect the new understanding

### Step 5: Apply the fixes and verify

After applying fixes:
1. Run `cd pi-socket && npx tsc --noEmit` — must compile clean
2. Run `cd integration-tests && npx vitest run` — all tests must pass
3. Run `cd hypivisor && cargo test` — all tests must pass

### Step 6: Clear processed errors

After fixing, archive the processed entries:

```bash
if [ -f ~/.pi/logs/pi-socket-errors.jsonl ]; then
  mv ~/.pi/logs/pi-socket-errors.jsonl ~/.pi/logs/pi-socket-errors.$(date +%Y%m%d-%H%M%S).jsonl
fi
```

This preserves history while giving a clean slate for detecting new errors.

### Step 7: Commit

Commit the hardened code with a message describing which error classes
were eliminated.

## Key files

- Error log: `~/.pi/logs/pi-socket-errors.jsonl`
- Safety net: `pi-socket/src/safety.ts`
- Extension: `pi-socket/src/index.ts`
- History builder: `pi-socket/src/history.ts`
- Types: `pi-socket/src/types.ts`
- Integration tests: `integration-tests/src/smoke.test.ts`
- Specs: `specs/requirements.md`, `specs/design.md`
