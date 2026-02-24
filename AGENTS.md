# Hyper-Pi

Decentralized control plane for pi coding agents: a WebSocket extension
(pi-socket), a Rust registry daemon (hypivisor), and a React web dashboard
(Pi-DE).

## Components

| Component         | Tech                      | Location             |
| ----------------- | ------------------------- | -------------------- |
| pi-socket         | TypeScript (pi extension) | `pi-socket/`         |
| hypivisor         | Rust (asupersync)         | `hypivisor/`         |
| Pi-DE             | React + Vite + TypeScript | `pi-de/`             |
| integration tests | TypeScript (vitest)       | `integration-tests/` |

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

Pi-DE connects exclusively to the hypivisor. The `/ws/agent/{nodeId}` endpoint
proxies bidirectionally to the agent's local pi-socket WebSocket. This avoids
CORS issues, simplifies multi-machine routing, and means Pi-DE never needs to
know agent ports or IPs.

### Event flow

pi-socket broadcasts real-time events to all clients:

- `delta` / `thinking_delta` — streaming LLM output
- `toolcall_start` / `toolcall_delta` — LLM tool call construction (during
  assistant message)
- `tool_start` / `tool_end` — tool execution (after assistant message)
- `message_start` (with `content` for user messages) / `message_end` — message
  boundaries

Pi-DE's `RemoteAgent` translates these into pi-web-ui's `AgentEvent` interface,
so `<agent-interface>` renders full conversations with markdown, code blocks,
thinking sections, and tool cards — identical to pi's own web UI.

## Key Constraints

### pi is never modified

Everything is additive — a global extension, an external daemon, and an external
web app.

### The hypivisor can NEVER take down a pi agent

This is the most important architectural invariant. The hypivisor is an
**observe-only** monitoring layer. If it crashes, is killed (SIGKILL), or
becomes unreachable, every pi agent MUST continue running with zero impact.
The local WebSocket server, event broadcasting, message injection, and all
agent functionality continue normally. Only dashboard visibility is lost.
See `specs/design.md` § "Agent Resilience Invariant" and requirements
R-PS-18a, R-PS-18b, R-CC-4, R-CC-10.

### Multiple agents per directory is a FIRST-CLASS use case

**Users can run THOUSANDS of pi agents in the same project folder.** This is not
an edge case — it is a core architectural requirement. Every agent gets its own
unique session ID and its own unique port. The only thing that physically
identifies a unique agent is `machine:port`. NEVER use `machine:cwd` to
deduplicate, evict, or collapse agents. Two agents in the same directory are two
separate agents, period.

## Read Before Assuming

When you encounter a reference to a file, spec, API, config, or convention —
**read it** before concluding it doesn't exist or works differently than
described. This includes specs/, component AGENTS.md files, package.json files,
and any path mentioned in docs. If a file isn't where you expect, use `find` or
`ls` to locate it.

## Specs

All design decisions, requirements, and architecture are in `specs/`:

- `specs/vision.md` — project philosophy and naming conventions
- `specs/requirements.md` — 60+ requirements across all components
- `specs/design.md` — full architecture, protocols, and reference
  implementations

Read the relevant spec before implementing or modifying any component.

Each component has its own `AGENTS.md` with build commands.

## Testing

Tests are measured with actual coverage tools (`cargo tarpaulin` for Rust,
`@vitest/coverage-v8` for TypeScript). Current measured coverage:

| Component         | Tests                          | Line Coverage              |
| ----------------- | ------------------------------ | -------------------------- |
| hypivisor         | 109 (91 unit + 18 integration) | **81%**                    |
| pi-socket         | 44                             | 73%                        |
| Pi-DE             | 59                             | **89%**                    |
| integration-tests | 51                             | (exercises all components) |

The integration tests (`integration-tests/`) spawn real pi agents in tmux
sessions and test the full WebSocket stack end-to-end. Key test infrastructure:

- `pi-agent-helpers.ts` — `startPiAgent()` / `stopPiAgent()` via tmux, with
  `waitForNode()` polling the hypivisor for registration
- `helpers.ts` — `startHypivisor()` on a random port, `connectWs()` /
  `BufferedWs` for WebSocket test clients
- Tests run sequentially (`fileParallelism: false` in vitest.config.ts) to avoid
  port/tmux contention
- macOS `/var` → `/private/var` symlink resolved via `realpathSync` in
  `createTempCwd()`

## Unified Logging & Hardening

All server-side components write to a single structured log:

`~/.pi/logs/hyper-pi.jsonl`

Each entry is a JSON object with `ts`, `level`, `component`, and `msg` fields.
The `component` field distinguishes the source (`pi-socket`, `hypivisor`).
Pi-DE is a browser app and logs to `console.error`/`console.warn` instead.

### Log levels

| Level | Meaning | `needsHardening` |
|-------|---------|-------------------|
| `error` | Bugs or unexpected failures — code needs fixing | `true` |
| `warn` | Expected degraded conditions — reconnecting, client dropped | no |
| `info` | Normal operations — startup, connections, registrations | no |

**Error-level events** (these are bugs, not expected degradation):

- WSS server error (pi-socket)
- TCP accept failure (hypivisor)
- WebSocket frame encode failure (hypivisor proxy)
- Any unanticipated exception caught by `boundary()` (pi-socket)

**Warn-level events** (expected, not bugs):

- Client WebSocket disconnect/error
- Hypivisor connection failure (hypivisor may not be running)
- Proxy relay forward failure (agent/dashboard disconnected)
- Handshake or init send failure (timing-related)

### Hardening

Use the global `harden` skill to process runtime errors from all server-side
components:

```
/skill:harden ~/.pi/logs/hyper-pi.jsonl
```

It reads the log, finds new `error`-level entries with `needsHardening: true`,
writes tests, fixes code, and tracks fixes in `.harden/ledger.md`.

### pi-socket two-layer error handling

pi-socket runs inside pi's Node.js process. An unhandled exception kills the
host pi agent. Two layers prevent this:

- **Inner layer**: Known errors handled at their source — `safeSerialize()`,
  `readyState` guards, `hypivisorUrlValid` flag, defensive `buildInitState()`.
- **Outer layer**: `boundary()` wrapper on every Node event-loop callback
  (`wss.on`, `ws.on`, `setTimeout`). Catches unanticipated errors, logs them
  as `error` with `needsHardening: true`, and never throws.

Note: `pi.on()` handlers do NOT need wrapping — pi's `ExtensionRunner.emit()`
already catches errors from extension handlers.

## Browser Testing with Surf

The user's browser tabs are THEIRS. You get ONE dedicated testing tab.

- **On first test**: run `surf tab.new <url>` to create your testing tab. Save
  the tab ID.
- **ALL subsequent commands**: use `surf --tab-id <YOUR_TAB_ID>` for navigate,
  screenshot, console, click — EVERYTHING.
- **NEVER run `surf` commands without `--tab-id`** — bare `surf navigate`, `surf
screenshot`, `surf console` will hijack the user's active tab.
- **When done testing**: close your tab with `surf --tab-id <YOUR_TAB_ID>
tab.close`.
- **NEVER close any tab you didn't create.**
- Use `surf --tab-id <ID> console --level error` to check for runtime errors
  after every navigation and interaction.
- Use `surf --tab-id <ID> screenshot` to visually verify rendering — don't trust
  that "no errors" means "it works."
- Start background services with `tmux`, not `nohup` or `&` (which get killed by
  bash tool timeouts).

## Verify Before Handing Off

**NEVER hand a URL, feature, or change to the user without testing it yourself
first.** Use `surf` to open the URL, take a screenshot, and check console errors
before telling the user it works. If a service needs a tunnel, test the tunnel
URL. If a build needs to pass, run the build. The user's time is not for
debugging your untested output.

use your own sub-agents, the codex CLI and the gemini CLI to check the project
for best practices. make recommendations based on the consolidated review
feedback.

# Architecture Best Practices

- **TDD (Test-Driven Development)** - write the tests first; the implementation
  code isn't done until the tests pass.
- **DRY (Don’t Repeat Yourself)** – eliminate duplicated logic by extracting
  shared utilities and modules.
- **Separation of Concerns** – each module should handle one distinct
  responsibility.
- **Single Responsibility Principle (SRP)** – every class/module/function/file
  should have exactly one reason to change.
- **Clear Abstractions & Contracts** – expose intent through small, stable
  interfaces and hide implementation details.
- **Low Coupling, High Cohesion** – keep modules self-contained, minimize
  cross-dependencies.
- **Scalability & Statelessness** – design components to scale horizontally and
  prefer stateless services when possible.
- **Observability & Testability** – build in logging, metrics, tracing, and
  ensure components can be unit/integration tested.
- **KISS (Keep It Simple, Sir)** - keep solutions as simple as possible.
- **YAGNI (You're Not Gonna Need It)** – avoid speculative complexity or
  over-engineering.
- **Don't Swallow Errors** by catching exceptions, silently filling in required
  but missing values or adding timeouts when something hangs unexpectedly. All
  of those are exceptions that should be thrown so that the errors can be seen,
  root causes can be found and fixes can be applied.
- **No Placeholder Code** - we're building production code here, not toys.
- **No Comments for Removed Functionality** - the source is not the place to
  keep history of what's changed; it's the place to implement the current
  requirements only.
- **Layered Architecture** - organize code into clear tiers where each layer
  depends only on the one(s) below it, keeping logic cleanly separated.
- **Prefer Non-Nullable Variables** when possible; use nullability sparingly.
- **Prefer Async Notifications** when possible over inefficient polling.
- **Consider First Principles** to assess your current architecture against the
  one you'd use if you started over from scratch.
- **Eliminate Race Conditions** that might cause dropped or corrupted data
- **Write for Maintainability** so that the code is clear and readable and easy
  to maintain by future developers.
- **Arrange Project Idiomatically** for the language and framework being used,
  including recommended lints, static analysis tools, folder structure and
  gitignore entries.
