# Hyper-Pi

Decentralized control plane for [pi](https://github.com/badlogic/pi-coding-agent) coding agents.

**pi-socket** · **hypivisor** · **Pi-DE**

---

## Components

| Component | Tech | Purpose |
|-----------|------|---------|
| [pi-socket](pi-socket/) | TypeScript (pi extension) | Exposes each pi CLI via WebSocket |
| [hypivisor](hypivisor/) | Rust (asupersync) | Central registry + WebSocket proxy |
| [Pi-DE](pi-de/) | React + Vite + TypeScript | Web dashboard |

## Quick Start

### 1. Install pi-socket extension

```bash
cd pi-socket
npm install && npm run build
# Symlink for global use (pi auto-loads extensions from here):
ln -s $(pwd) ~/.pi/agent/extensions/pi-socket
```

### 2. Start hypivisor

```bash
cd hypivisor
cargo run
# Listens on ws://0.0.0.0:31415/ws
# Proxy: ws://0.0.0.0:31415/ws/agent/{nodeId}
```

### 3. Start Pi-DE

```bash
cd pi-de
npm install
npm run dev
# Opens http://localhost:5180
```

### 4. Run pi (in any project directory)

```bash
cd ~/my-project
pi
# pi-socket auto-loads, registers with hypivisor, appears in Pi-DE
# Click the agent in Pi-DE to see its conversation in real time
```

After `/reload` in the pi TUI, pi-socket picks up code changes without restarting.

## Authentication

Set `HYPI_TOKEN` on all processes for optional pre-shared key auth:

```bash
export HYPI_TOKEN="your-secret"
```

For Pi-DE, set `VITE_HYPI_TOKEN` in a `.env` file or environment.

## Architecture

```
Pi-DE (browser)
  ├─ ws://hypivisor:31415/ws         → registry (roster, spawn)
  └─ ws://hypivisor:31415/ws/agent/… → proxy → pi-socket → pi
```

Pi-DE connects only to the hypivisor. The hypivisor proxies agent WebSocket connections bidirectionally. pi-socket runs inside each pi process, broadcasting real-time events: streaming text, thinking, tool calls, and user messages. Pi-DE's `RemoteAgent` adapter translates these into pi-web-ui's `AgentEvent` interface.

Pi-DE registers compact tool renderers for pi's built-in tools (`read`, `write`, `edit`, `bash`, `ls`, `find`, `grep`) that match the TUI's information density — one-line headers with collapsible content instead of verbose JSON cards. It also supports 7 themes (dark, light, gruvbox-dark, tokyo-night, nord, solarized-dark, solarized-light) that map pi's color tokens to CSS custom properties.

See [specs/](specs/) for the full design:

- [Vision](specs/vision.md) — project philosophy
- [Requirements](specs/requirements.md) — 60+ requirements
- [Design](specs/design.md) — architecture, protocols, reference implementations

## Self-Hardening Error Architecture

pi-socket runs inside pi's Node.js process — an unhandled exception kills the host agent. Rather than blanket try/catch (which hides bugs), Hyper-Pi uses a **two-layer architecture** with a **continuous hardening loop** that progressively eliminates error classes.

### How it works

```
Code runs
  → Inner layer handles known errors at source
  → Outer layer (boundary()) catches unanticipated errors
  → Logged to ~/.pi/logs/pi-socket.jsonl with needsHardening: true
  → harden-pi-socket skill reads log + hardening ledger
  → Proposes inner-layer fix that eliminates the error class
  → Records fix in ledger with git commit SHA
  → Error class can never recur
  → Log is clean again
```

### The two layers

**Inner layer** — specific, targeted handling of known error conditions:
- `safeSerialize()` — handles circular refs and BigInt in tool args
- `readyState` guards — prevents `ws.send()` on closing sockets
- `hypivisorUrlValid` flag — stops retrying malformed URLs
- Defensive property access — `buildInitState()` validates all pi session data

**Outer layer** — `boundary()` wrapper on every Node event-loop callback:
- Catches everything the inner layer doesn't anticipate
- Logs structured JSONL with full stack trace and context
- Never throws — pi never crashes

### The hardening loop

The `harden-pi-socket` skill (run with `/skill:harden-pi-socket`) is the feedback mechanism:

1. **Reads** `needsHardening` errors from the operational log
2. **Checks** the hardening ledger (`.pi/skills/harden-pi-socket/ledger.jsonl`) for past fix attempts
3. **For recurring errors**: reads prior fix commits with `git show` to learn from what was already tried
4. **Proposes** targeted inner-layer fixes that eliminate each error class
5. **Records** each fix in the ledger with git commit, root cause analysis, and status

The ledger is version-controlled so the skill learns over time — it knows what worked, what didn't, and what the root causes were.

**Zero `needsHardening` entries = healthy system.** Each entry is a gap to close.

### Operational log

`~/.pi/logs/pi-socket.jsonl` — structured JSONL:

```jsonl
{"ts":"...","level":"info","component":"pi-socket","msg":"WebSocket server listening","port":8080}
{"ts":"...","level":"info","component":"hypivisor","msg":"registered","nodeId":"mac-1234","port":8080}
{"ts":"...","level":"warn","component":"hypivisor","msg":"disconnected, will reconnect","reconnectMs":5000}
{"ts":"...","level":"error","component":"pi-socket","msg":"...","needsHardening":true,"boundary":"wss.connection","stack":"..."}
```

## Testing

```bash
# Unit tests
cd pi-socket && npm test       # 87 tests
cd pi-de && npm test           # 174 tests
cd hypivisor && cargo test     # 107 tests (89 unit + 18 in-process integration)

# Integration tests (requires built hypivisor + real pi agents via tmux)
cd integration-tests && npx vitest run

# Coverage
cd pi-socket && npx vitest run --coverage   # 73% lines
cd pi-de && npx vitest run --coverage       # 89% lines
cd hypivisor && cargo tarpaulin --exclude-files src/main.rs --out stdout  # 81% lines
```

### Test breakdown

| Component | Unit | Integration | Coverage |
|-----------|------|-------------|----------|
| **hypivisor** | 89 (auth, cleanup, fs_browser, handlers, rpc, spawn) | 18 (in-process server tests) | 81% lines |
| **pi-socket** | 87 (index, history, safety, resilience) | — | 73% lines |
| **Pi-DE** | 174 (RemoteAgent, useHypivisor, useAgent, useTheme, piThemes, toolRenderers, rpc, SpawnModal, initStorage, patchLit, patchSendDuringStreaming, App) | — | 89% lines |
| **integration-tests** | — | 51 (smoke, reconnect, multi-agent, proxy-relay, lifecycle, message-roundtrip, cross-channel, browser-rendering, e2e-live) | — |

The integration tests spawn real pi agents in tmux sessions and test the full stack: registration/deregistration, message round-trips (web→proxy→agent→response→web), cross-channel visibility (TUI↔Web), and browser rendering via the `surf` CLI.

## License

MIT
