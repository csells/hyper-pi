---
name: harden-pi-socket
description: >
  Continuously harden the pi-socket extension by analyzing its operational
  log. Reads ~/.pi/logs/pi-socket.jsonl for errors marked needsHardening,
  cross-references the hardening ledger for past attempts, and proposes
  targeted code fixes. Triggers: "harden pi-socket", "check pi-socket
  errors", "review extension errors", "review pi-socket log".
---

# Harden pi-socket

## Purpose

The pi-socket extension has a two-layer error architecture:

- **Inner layer**: Known errors handled at source (safeSerialize, readyState
  guards, defensive buildInitState, etc.)
- **Outer layer**: `boundary()` wrapper catches unanticipated errors and logs
  them to `~/.pi/logs/pi-socket.jsonl` with `needsHardening: true`.

**The hardening log should have zero `needsHardening` entries in a healthy
system.** Each one represents a gap in the inner layer. This skill closes
those gaps, tracks what it's done, and learns from past attempts.

## Files

| File | Purpose |
|------|---------|
| `~/.pi/logs/pi-socket.jsonl` | Operational log (JSONL). All events. Errors have `needsHardening: true`. |
| `.pi/skills/harden-pi-socket/ledger.jsonl` | Hardening ledger. Tracks every fix attempt, what worked, what didn't. |
| `pi-socket/src/index.ts` | Main extension |
| `pi-socket/src/safety.ts` | boundary() wrapper (outer layer) |
| `pi-socket/src/log.ts` | Structured logger |
| `pi-socket/src/history.ts` | Session data parser |
| `pi-socket/src/types.ts` | Type definitions |

## Procedure

### Step 1: Read the operational log

```bash
cat ~/.pi/logs/pi-socket.jsonl 2>/dev/null | grep '"needsHardening":true' || echo "No errors needing hardening."
```

If no errors need hardening, report the system is healthy and stop.

Also review recent info/warn entries to understand operational context:

```bash
tail -50 ~/.pi/logs/pi-socket.jsonl 2>/dev/null
```

### Step 2: Read the hardening ledger

```bash
cat .pi/skills/harden-pi-socket/ledger.jsonl 2>/dev/null || echo "No prior hardening work."
```

The ledger is JSONL with one entry per hardening action:

```json
{
  "ts": "2026-02-22T10:00:00.000Z",
  "errorClass": "wss.connection:TypeError: Cannot read properties of null",
  "errorPattern": "Cannot read properties of null",
  "boundary": "wss.connection",
  "occurrences": 5,
  "firstSeen": "2026-02-22T08:00:00.000Z",
  "lastSeen": "2026-02-22T09:55:00.000Z",
  "action": "Added null check for ctx.sessionManager in connection handler",
  "filesChanged": ["pi-socket/src/index.ts"],
  "commit": "abc1234",
  "status": "fixed",
  "notes": "Root cause: session_start ctx was captured but sessionManager was not yet initialized when early connection arrived."
}
```

Fields:
- `errorClass`: `{boundary}:{error message pattern}` — the unique key
- `status`: `fixed` | `attempted` | `reverted` | `recurring`
- `commit`: git SHA of the fix commit (use `git rev-parse HEAD` after committing)

### Step 3: Identify new error classes

Group errors from the log by `boundary` + error message pattern. Compare
against the ledger. New = not in ledger, or in ledger with status `attempted`
(previous fix didn't work) or `recurring` (came back).

For errors in ledger with status `attempted`, read the commit diff:
```bash
git show <commit> -- pi-socket/
```
This shows what was tried before so you don't repeat failed approaches.

### Step 4: For each new error class, analyze and fix

Read the relevant source files. The `boundary` field maps to:

| Boundary | Location |
|----------|----------|
| `wss.connection` | index.ts: wss.on("connection") handler |
| `ws.message` | index.ts: ws.on("message") handler |
| `hypivisor.open` | index.ts: hypivisor ws.on("open") handler |
| `reconnect` | index.ts: setTimeout reconnect callback |

For each error:
1. **Read the stack trace** — find the exact line that threw
2. **Understand the root cause** — why did this value/state occur?
3. **Fix in the inner layer** — handle this specific condition at its source,
   not with a blanket catch. The fix should make this error structurally
   impossible.
4. **Add a test** if the error is reproducible
5. **Verify**: `cd pi-socket && npx tsc --noEmit` and
   `cd integration-tests && npx vitest run`

### Step 5: Record in the ledger

After committing the fix, append to `.pi/skills/harden-pi-socket/ledger.jsonl`:

```bash
COMMIT=$(git rev-parse HEAD)
```

Write a JSONL entry with the errorClass, what you did, the commit SHA,
files changed, and status. Include notes explaining the root cause so
future runs understand the history.

### Step 6: Mark processed errors

Do NOT delete log entries. They're operational history. The ledger tracks
which error classes have been addressed. The skill compares log entries
against the ledger to find unaddressed ones.

### Step 7: If an error class recurs after a fix

Update the ledger entry status from `fixed` to `recurring`. Read the
original fix commit with `git show`. Understand why it didn't hold.
Apply a deeper fix. Record the new attempt as a separate ledger entry
referencing the previous one in notes.

## Log format reference

Every line in `~/.pi/logs/pi-socket.jsonl`:

```json
{
  "ts": "ISO-8601",
  "level": "info|warn|error",
  "component": "pi-socket|hypivisor",
  "msg": "human-readable message",
  "needsHardening": true,
  "boundary": "wss.connection",
  "error": "error message",
  "stack": "full stack trace",
  "...": "additional context fields"
}
```

- `level: "info"` — normal operations (startup, connect, register)
- `level: "warn"` — expected degraded state (reconnecting, client dropped)
- `level: "error"` + `needsHardening: true` — unanticipated error caught by
  boundary(). THIS is what the skill processes.
