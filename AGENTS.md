# Hyper-Pi

Decentralized control plane for pi coding agents: a WebSocket extension (pi-socket), a Rust registry daemon (hypivisor), and a React web dashboard (Pi-DE).

## Components

| Component | Tech | Location |
|-----------|------|----------|
| pi-socket | TypeScript (pi extension) | `pi-socket/` |
| hypivisor | Rust (asupersync) | `hypivisor/` |
| Pi-DE | React + Vite + TypeScript | `pi-de/` |
| integration tests | TypeScript (vitest) | `integration-tests/` |

## Connection Architecture

```
Pi-DE (browser)
  │
  ├─ ws://hypivisor:31415/ws              → registry (node roster, spawn)
  │
  └─ ws://hypivisor:31415/ws/agent/{nodeId} → proxy relay to agent
       │
       └─ hypivisor ←→ ws://agent:port    → pi-socket inside pi process
```

Pi-DE connects exclusively to the hypivisor. The `/ws/agent/{nodeId}` endpoint proxies bidirectionally to the agent's local pi-socket WebSocket. This avoids CORS issues, simplifies multi-machine routing, and means Pi-DE never needs to know agent ports or IPs.

### Event flow

pi-socket broadcasts real-time events to all clients:
- `delta` / `thinking_delta` — streaming LLM output
- `toolcall_start` / `toolcall_delta` — LLM tool call construction (during assistant message)
- `tool_start` / `tool_end` — tool execution (after assistant message)
- `message_start` (with `content` for user messages) / `message_end` — message boundaries

Pi-DE's `RemoteAgent` translates these into pi-web-ui's `AgentEvent` interface, so `<agent-interface>` renders full conversations with markdown, code blocks, thinking sections, and tool cards — identical to pi's own web UI.

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

The user's browser tabs are THEIRS. You get ONE dedicated testing tab.

- **On first test**: run `surf tab.new <url>` to create your testing tab. Save the tab ID.
- **ALL subsequent commands**: use `surf --tab-id <YOUR_TAB_ID>` for navigate, screenshot, console, click — EVERYTHING.
- **NEVER run `surf` commands without `--tab-id`** — bare `surf navigate`, `surf screenshot`, `surf console` will hijack the user's active tab.
- **When done testing**: close your tab with `surf --tab-id <YOUR_TAB_ID> tab.close`.
- **NEVER close any tab you didn't create.**
- Use `surf --tab-id <ID> console --level error` to check for runtime errors after every navigation and interaction.
- Use `surf --tab-id <ID> screenshot` to visually verify rendering — don't trust that "no errors" means "it works."
- Start background services with `tmux`, not `nohup` or `&` (which get killed by bash tool timeouts).

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
