# pi-socket

TypeScript extension for the pi coding agent. Exposes a local WebSocket server and registers with the hypivisor.

Uses real pi ExtensionAPI — see `specs/design.md` for the correct event names and API surface. Do not use hallucinated APIs like `pi.chat.send()` or `pi.on('message:delta')`.

## Commands

```bash
npm install    # Install dependencies
npm run build  # Compile TypeScript
npm run lint   # Type-check without emitting
npm test       # Run unit tests
```

## Installation

Copy or symlink the built output to `~/.pi/agent/extensions/pi-socket/` for global use.

## Source files

| File | Purpose |
|------|---------|
| `src/index.ts` | Extension entry point, event handlers, hypivisor connection |
| `src/log.ts` | Structured JSONL logger (writes to `~/.pi/logs/pi-socket.jsonl`) |
| `src/safety.ts` | `boundary()` wrapper — outer-layer safety net for Node callbacks |
| `src/history.ts` | Converts pi session data into `init_state` payload |
| `src/types.ts` | Shared type definitions |

## Error handling

pi-socket runs inside pi's Node.js process. An uncaught exception kills pi.

**pi.on() handlers**: pi's `ExtensionRunner.emit()` already wraps these in try/catch. Errors propagate to pi's error system — do not add try/catch inside these handlers.

**Node event-loop callbacks** (wss.on, ws.on, setTimeout): Wrapped with `boundary()` from `safety.ts`. Two layers:

1. **Inner layer**: Handle known errors at source — `safeSerialize()`, `readyState` guards, `hypivisorUrlValid` flag, defensive property access in `buildInitState()`.
2. **Outer layer**: `boundary()` catches everything else and logs it as `needsHardening: true` to the operational log.

Run `/skill:harden-pi-socket` to process new errors and propose inner-layer fixes.

## Logging

All operational events go to `~/.pi/logs/pi-socket.jsonl` as structured JSONL. Never use `console.log`/`console.error` — those go to pi's TUI.

```typescript
import * as log from "./log.js";
log.info("pi-socket", "client connected", { clientCount: 3 });
log.warn("hypivisor", "disconnected, will reconnect", { reconnectMs: 5000 });
log.error("wss.connection", err);  // sets needsHardening: true
```
