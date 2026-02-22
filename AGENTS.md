# Hyper-Pi

Decentralized control plane for pi coding agents: a WebSocket extension (pi-socket), a Rust registry daemon (hypivisor), and a React web dashboard (Pi-DE).

## Components

| Component | Tech | Location |
|-----------|------|----------|
| pi-socket | TypeScript (pi extension) | `pi-socket/` |
| hypivisor | Rust (asupersync) | `hypivisor/` |
| Pi-DE | React + Vite + TypeScript | `pi-de/` |
| integration tests | TypeScript (vitest) | `integration-tests/` |

## Key Constraint

pi itself is never modified. Everything is additive — a global extension, an external daemon, and an external web app.

## Read Before Assuming

When you encounter a reference to a file, spec, API, config, or convention — **read it** before concluding it doesn't exist or works differently than described. This includes specs/, component AGENTS.md files, package.json files, and any path mentioned in docs. If a file isn't where you expect, use `find` or `ls` to locate it.

## Specs

All design decisions, requirements, and architecture are in `specs/`:

- `specs/vision.md` — project philosophy and naming conventions
- `specs/requirements.md` — 60+ requirements across all components
- `specs/design.md` — full architecture, protocols, and reference implementations

Read the relevant spec before implementing or modifying any component.

Each component has its own `AGENTS.md` with build commands.

## Self-Hardening Architecture

pi-socket runs inside pi's Node.js process. An unhandled exception in the extension kills the host pi agent. To prevent this while maintaining visibility into bugs, pi-socket uses a **two-layer error architecture** with a **continuous hardening loop**.

### Two-layer error handling

- **Inner layer**: Known errors handled at their source with specific logic — `safeSerialize()` for non-serializable data, `readyState` guards before `ws.send()`, `hypivisorUrlValid` flag for bad URLs, defensive property access in `buildInitState()`.
- **Outer layer**: `boundary()` wrapper on every Node event-loop callback (`wss.on`, `ws.on`, `setTimeout`). Catches unanticipated errors, logs them with `needsHardening: true`, and never throws.

Note: `pi.on()` handlers do NOT need wrapping — pi's `ExtensionRunner.emit()` already catches errors from extension handlers.

### Operational log

`~/.pi/logs/pi-socket.jsonl` — structured JSONL with every significant event:
- `info`: startup, connections, registrations
- `warn`: expected degraded conditions (reconnecting, client dropped)
- `error` + `needsHardening: true`: unanticipated errors caught by `boundary()`

### Hardening loop

The `harden-pi-socket` skill (`.pi/skills/harden-pi-socket/`) closes gaps in the inner layer:

1. Reads `needsHardening` errors from the operational log
2. Cross-references the **hardening ledger** (`.pi/skills/harden-pi-socket/ledger.jsonl`) for past fix attempts
3. For recurring errors, reads prior fix commits with `git show` to learn what was tried
4. Proposes a targeted inner-layer fix that eliminates the error class
5. Records the fix in the ledger with git commit SHA, files changed, status, and root cause notes

**The log should have zero `needsHardening` entries in a healthy system.** Each entry represents a gap in the inner layer. Run `/skill:harden-pi-socket` to process new errors.

## Browser Testing with Surf

When using `surf` for browser automation and testing:

- **Never use `surf tab.new`** — it spawns new browser windows/tabs that clutter the user's browser.
- **Always use `surf navigate <url>`** to reuse the current tab.
- **Name a tab once** with `surf tab.name --tab-id <id> pide` and then `surf tab.switch pide` to return to it.
- **Use `surf console --level error`** to check for runtime errors after every navigation and interaction.
- **Use `surf screenshot`** to visually verify rendering — don't trust that "no errors" means "it works."
- **Start background services with `tmux`**, not `nohup` or `&` (which get killed by bash tool timeouts).

## Architecture Best Practices

- **TDD** — write tests first; code isn't done until tests pass.
- **DRY** — extract shared utilities; no duplicated logic.
- **Separation of Concerns** — each module handles one distinct responsibility.
- **SRP** — every class/module/function/file has exactly one reason to change.
- **Clear Abstractions & Contracts** — small, stable interfaces; hide implementation details.
- **Low Coupling, High Cohesion** — self-contained modules, minimal cross-dependencies.
- **Scalability & Statelessness** — design for horizontal scale; prefer stateless services.
- **Observability & Testability** — logging, metrics, tracing; unit/integration testable.
- **KISS** — keep solutions as simple as possible.
- **YAGNI** — no speculative complexity or over-engineering.
- **Don't Swallow Errors** — never silently catch exceptions, fill in missing values, or add timeouts for hangs. Errors must be visible so root causes can be found.
- **No Placeholder Code** — production code only, not stubs or toys.
- **No Comments for Removed Functionality** — source implements current requirements only; history lives in git.
- **Layered Architecture** — clear tiers; each layer depends only on the one(s) below it.
- **Prefer Non-Nullable Variables** — use nullability sparingly.
- **Prefer Async Notifications** — over inefficient polling.
- **First Principles** — assess architecture against what you'd build from scratch.
- **Eliminate Race Conditions** — no dropped or corrupted data.
- **Write for Maintainability** — clear, readable code for future developers.
- **Arrange Idiomatically** — follow language/framework conventions for lints, static analysis, folder structure, and gitignore.
