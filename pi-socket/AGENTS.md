# pi-socket

TypeScript extension for the pi coding agent. Exposes a local WebSocket server, broadcasts real-time agent events, and registers with the hypivisor.

Uses real pi ExtensionAPI — see `specs/design.md` for the correct event names and API surface. Do not use hallucinated APIs like `pi.chat.send()` or `pi.on('message:delta')`.

## Commands

```bash
npm install    # Install dependencies
npm run build  # Compile TypeScript
npm run lint   # Type-check without emitting
npm test       # Run unit tests
```

## Installation

Symlink or copy to `~/.pi/agent/extensions/pi-socket/` for global use:

```bash
ln -s $(pwd) ~/.pi/agent/extensions/pi-socket
```

Use `/reload` in the pi TUI to pick up changes after rebuilding.

## Source files

| File | Purpose |
|------|---------|
| `src/index.ts` | Extension entry point, event handlers, hypivisor connection |
| `src/log.ts` | Structured JSONL logger (writes to `~/.pi/logs/hyper-pi.jsonl`) |
| `src/safety.ts` | `boundary()` wrapper — outer-layer safety net for Node callbacks |
| `src/history.ts` | Converts pi session data into `init_state` payload |
| `src/types.ts` | Shared type definitions for all socket events |

## Event catalog

Events broadcast from pi-socket to connected clients:

| Type | Payload | Source |
|------|---------|--------|
| `init_state` | `{ events[], tools[], truncated?, totalEvents? }` | On client connect (from session history) |
| `delta` | `{ text }` | `message_update` with `text_delta` |
| `thinking_delta` | `{ text }` | `message_update` with `thinking_delta` |
| `toolcall_start` | `{ name, id }` | `message_update` with `toolcall_start` — LLM outputs tool call |
| `toolcall_delta` | `{ id, argsDelta }` | `message_update` with `toolcall_delta` — incremental args |
| `tool_start` | `{ name, args }` | `tool_execution_start` — tool begins executing |
| `tool_end` | `{ name, isError, result? }` | `tool_execution_end` — tool finishes |
| `message_start` | `{ role, content? }` | `message_start` — includes `content` for user messages |
| `message_end` | `{ role }` | `message_end` |

The `toolcall_start`/`toolcall_delta` events fire DURING the assistant message (before `message_end`). The `tool_start`/`tool_end` events fire AFTER `message_end` for tool execution. This distinction is critical for Pi-DE's `RemoteAgent` to correctly maintain streaming state.

## Error handling

pi-socket runs inside pi's Node.js process. An uncaught exception kills pi.

**pi.on() handlers**: pi's `ExtensionRunner.emit()` already wraps these in try/catch. Errors propagate to pi's error system — do not add try/catch inside these handlers.

**Node event-loop callbacks** (wss.on, ws.on, setTimeout): Wrapped with `boundary()` from `safety.ts`. Two layers:

1. **Inner layer**: Handle known errors at source — `safeSerialize()`, `readyState` guards, `hypivisorUrlValid` flag, defensive property access in `buildInitState()`.
2. **Outer layer**: `boundary()` catches everything else and logs it as `error` with `needsHardening: true` to the operational log.

**WebSocket error handlers** (`ws.on("error")`, `wss.on("error")`): Log the error
details — never leave empty. WSS server errors are `error` level (infrastructure
failure); client/hypivisor connection errors are `warn` level (expected degradation).

## Logging

All operational events go to `~/.pi/logs/hyper-pi.jsonl` as structured JSONL
(shared with hypivisor — see root `AGENTS.md` for level definitions). Never use
`console.log`/`console.error` — those go to pi's TUI.

```typescript
import * as log from "./log.js";
log.info("pi-socket", "client connected", { clientCount: 3 });
log.warn("hypivisor", "disconnected, will reconnect", { reconnectMs: 5000 });
log.error("wss.error", err);  // level: "error", needsHardening: true
```
