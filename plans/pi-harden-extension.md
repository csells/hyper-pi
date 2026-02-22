# Plan: pi-harden — Generalized Self-Improvement Extension

## Summary

Extract the two-layer error architecture, structured logging, hardening skill, and hardening ledger from pi-socket into a reusable **pi-harden** extension that any project can use. When installed, pi-harden gives any pi session a continuous self-improvement loop: structured error logging → hardening skill → ledger → progressive code fixes.

## Origin

This pattern was developed in Hyper-Pi's pi-socket extension to solve a specific problem: the extension runs inside pi's Node.js process, and unhandled exceptions kill the host agent. The solution — a two-layer error model with a feedback loop — is general enough to benefit any codebase where pi is working.

## What pi-harden provides

### 1. Structured operational log

A JSONL file at `~/.pi/logs/{project-slug}.jsonl` that captures:

- **info**: Normal operations — builds, test runs, deployments, file changes
- **warn**: Degraded conditions — flaky tests, slow operations, deprecation warnings
- **error** + `needsHardening: true`: Unanticipated errors, test failures, crashes

The log is project-scoped. Multiple pi instances working on the same project write to the same log.

### 2. Hardening skill

A project-local skill (`.pi/skills/harden/SKILL.md`) that:

1. Reads `needsHardening` entries from the operational log
2. Cross-references the hardening ledger for past fix attempts
3. For recurring errors, reads prior fix commits with `git show` to learn what was tried
4. Proposes targeted code fixes that eliminate each error class
5. Records each fix in the ledger with git commit SHA, root cause analysis, and status

### 3. Hardening ledger

A version-controlled JSONL file (`.pi/skills/harden/ledger.jsonl`) that tracks every hardening action:

```json
{
  "ts": "2026-02-22T10:00:00Z",
  "errorClass": "test:TypeError: Cannot read properties of null",
  "errorPattern": "Cannot read properties of null",
  "source": "src/parser.ts:42",
  "occurrences": 5,
  "firstSeen": "2026-02-22T08:00:00Z",
  "lastSeen": "2026-02-22T09:55:00Z",
  "action": "Added null guard for token.value in parser",
  "filesChanged": ["src/parser.ts", "src/parser.test.ts"],
  "commit": "abc1234",
  "status": "fixed",
  "notes": "Root cause: lexer emits null tokens on empty input lines"
}
```

The ledger lets the skill learn from history — what worked, what didn't, what keeps recurring.

### 4. Log integration points

pi-harden hooks into pi's lifecycle events to automatically capture errors:

- `tool_execution_end` where `isError: true` → log the tool failure with context
- Build/test commands that exit non-zero → log with stdout/stderr
- Unhandled exceptions in any project-local extension → log with stack trace

Projects can also write to the log explicitly:

```typescript
import { harden } from "pi-harden";
harden.error("component", new Error("something unexpected"), { context: "..." });
harden.info("component", "operation completed", { duration: 42 });
```

## Architecture

```
pi-harden (global extension)
├── Hooks pi lifecycle events
├── Writes to ~/.pi/logs/{project}.jsonl
└── Installs .pi/skills/harden/ on first run

.pi/skills/harden/ (project-local)
├── SKILL.md           — the hardening skill
└── ledger.jsonl       — tracks every fix attempt

The loop:
  Code runs → errors logged with needsHardening
  → User or agent runs /skill:harden
  → Skill reads log + ledger
  → Proposes inner-layer fix
  → Records in ledger with commit SHA
  → Error class eliminated
  → Log is clean
```

## Implementation steps

### Phase 1: Core extension

1. **Create `pi-harden/` package** as a new pi extension (TypeScript)
2. **Implement the logger** — project-scoped JSONL writer with info/warn/error levels
3. **Hook `tool_execution_end`** — capture tool failures (build errors, test failures) automatically
4. **Hook `session_start`** — detect project, initialize log path from project slug
5. **Scaffold the skill** — on first run in a project, create `.pi/skills/harden/SKILL.md` and `ledger.jsonl` if they don't exist
6. **Publish as pi package** — `pi install pi-harden`

### Phase 2: Hardening skill

7. **Write the generic SKILL.md** — parameterized for any project (not pi-socket-specific)
8. **Skill reads the log** — filters for `needsHardening`, groups by error class
9. **Skill reads the ledger** — finds new vs. addressed vs. recurring errors
10. **Skill proposes fixes** — reads source at the failing location, suggests targeted fix
11. **Skill records in ledger** — after commit, appends entry with SHA and analysis

### Phase 3: Smarter capture

12. **Parse build output** — detect common error patterns (TypeScript type errors, Rust compiler errors, test assertion failures) and structure them
13. **Capture command exit codes** — any bash tool execution that fails gets logged with the command and output
14. **Rate limiting** — don't log the same error class more than N times per session to prevent log bloat during repeated build-fix cycles

### Phase 4: Back-port to pi-socket

15. **Replace pi-socket's custom log.ts and safety.ts** with pi-harden's logger
16. **Replace `.pi/skills/harden-pi-socket/`** with the generic `.pi/skills/harden/`
17. **Migrate the existing ledger** entries to the new format

## Open questions

- Should the hardening skill run automatically (e.g., at session_start if there are new errors) or only on demand?
- Should the ledger support linking to GitHub issues for errors that need upstream fixes?
- Should pi-harden expose an MCP tool so agents can query the error log and ledger programmatically?
- What's the right log rotation strategy? Per-session? Per-day? Size-based?

## References

- Hyper-Pi pi-socket implementation: `pi-socket/src/log.ts`, `pi-socket/src/safety.ts`
- Hyper-Pi hardening skill: `.pi/skills/harden-pi-socket/SKILL.md`
- Hyper-Pi hardening ledger: `.pi/skills/harden-pi-socket/ledger.jsonl`
