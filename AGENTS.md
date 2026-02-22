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

pi-socket runs inside pi's Node.js process. An unhandled exception in the extension kills the host pi agent. To prevent this while maintaining visibility into bugs, pi-socket uses a **two-layer error architecture**.

### Two-layer error handling

- **Inner layer**: Known errors handled at their source with specific logic — `safeSerialize()` for non-serializable data, `readyState` guards before `ws.send()`, `hypivisorUrlValid` flag for bad URLs, defensive property access in `buildInitState()`.
- **Outer layer**: `boundary()` wrapper on every Node event-loop callback (`wss.on`, `ws.on`, `setTimeout`). Catches unanticipated errors, logs them with `needsHardening: true`, and never throws.

Note: `pi.on()` handlers do NOT need wrapping — pi's `ExtensionRunner.emit()` already catches errors from extension handlers.

### Operational log

`~/.pi/logs/pi-socket.jsonl` — structured JSONL with every significant event:
- `info`: startup, connections, registrations
- `warn`: expected degraded conditions (reconnecting, client dropped)
- `error` + `needsHardening: true`: unanticipated errors caught by `boundary()`

### Hardening

Use the global `harden` skill (`/skill:harden ~/.pi/logs/pi-socket.jsonl`) to process runtime errors. It reads the log, finds new errors, writes tests, fixes code, and tracks fixes in `.harden/ledger.md`.

## Browser Testing with Surf

**NEVER create or close browser tabs/windows.** The user's browser is their workspace — not yours.

- **NEVER use `surf tab.new`** — opens unwanted windows. FORBIDDEN.
- **NEVER use `surf tab.close`** — destroys the user's tabs. FORBIDDEN.
- **ALWAYS use `surf navigate <url>`** to reuse whatever tab surf is currently on.
- **ALWAYS use `surf --tab-id <id>`** if you need a specific tab — find it with `surf tab.list` first.
- Use `surf console --level error` to check for runtime errors after every navigation and interaction.
- Use `surf screenshot` to visually verify rendering — don't trust that "no errors" means "it works."
- Start background services with `tmux`, not `nohup` or `&` (which get killed by bash tool timeouts).
- If you need a clean browser state, use `surf navigate` to reload — do NOT close and reopen tabs.

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
