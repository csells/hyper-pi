# Pi-DE

React + Vite + TypeScript web dashboard for Hyper-Pi. Renders pi agent conversations using `@mariozechner/pi-web-ui` components via a `RemoteAgent` adapter.

## Commands

```bash
npm install     # Install dependencies
npm run dev     # Dev server on :5180
npm run build   # Production build
npm run lint    # Type-check
npm test        # Run vitest unit tests
```

## Environment

- `VITE_HYPI_TOKEN` — pre-shared key matching hypivisor's HYPI_TOKEN
- `VITE_HYPIVISOR_PORT` — hypivisor port (default: 31415)

## Key files

| File | Purpose |
|------|---------|
| `src/App.tsx` | Root component. Wires `RemoteAgent` into `<agent-interface>`. Patches `sendMessage` and `MessageEditor` to allow sending while agent is busy. |
| `src/RemoteAgent.ts` | **Core adapter.** Duck-types pi-agent-core's `Agent` interface over WebSocket. Handles socket events (`delta`, `thinking_delta`, `toolcall_start`, `toolcall_delta`, `tool_start`, `tool_end`, `message_start`, `message_end`), maintains `AgentState`, emits `AgentEvent`s. |
| `src/useHypivisor.ts` | Hook: connects to hypivisor WebSocket, manages node roster via push events. |
| `src/useAgent.ts` | Hook: connects to agent via hypivisor proxy (`/ws/agent/{nodeId}`), creates `RemoteAgent`. |
| `src/types.ts` | WebSocket event types, node info, hypivisor events. |
| `src/patchLit.ts` | Fixes Lit class-field-shadowing in dev mode. Patches `ReactiveElement.performUpdate`. |
| `src/initStorage.ts` | In-memory `AppStorage` with `MemoryBackend` and dummy API keys for all providers. |
| `vite.config.ts` | Vite config. Excludes Node-only packages from pre-bundling. `katexFontsPlugin()` middleware for font redirects. |

## Architecture

```
Pi-DE connects to agents through the hypivisor proxy:

  Pi-DE → ws://hypivisor:31415/ws              (registry: roster)
  Pi-DE → ws://hypivisor:31415/ws/agent/{nodeId} (proxy → agent)

RemoteAgent translates socket events into AgentEvents:

  Socket events (delta, toolcall_start, tool_end, ...)
    → RemoteAgent maintains AgentState
    → Emits AgentEvent (message_update, tool_execution_start, ...)
    → AgentInterface subscribes and renders via pi-web-ui components
```

### Tool call event flow

During a tool-using turn, events arrive in this order:

1. `message_start` (assistant) → `isStreaming = true`, create streaming message
2. `delta` / `thinking_delta` → append to streaming message content
3. `toolcall_start` → add `toolCall` block to streaming message, mark pending
4. `toolcall_delta` → accumulate args JSON, try to parse
5. `message_end` (assistant) → finalize message. If `hasToolCalls`, keep `isStreaming = true` (don't emit `agent_end`)
6. `tool_start` → tool execution begins (finds existing block from step 3)
7. `tool_end` → create `toolResult` message, remove from pending
8. `message_start` (assistant) → next turn begins
9. Steps repeat until a `message_end` with no tool calls → emit `agent_end`

### User messages

- **From Pi-DE:** Sent via `RemoteAgent.prompt()` → WebSocket → pi-socket → `pi.sendUserMessage()`. Input stays active during streaming.
- **From TUI:** pi emits `message_start` with `role: "user"`. pi-socket includes `content` in the event. `RemoteAgent` adds user message to state.

### Vite configuration

Only Node-only packages are excluded from pre-bundling (`@aws-sdk/*`, `@smithy/*`, `socks`). Everything else (pi-web-ui, mini-lit, highlight.js, etc.) pre-bundles normally, following pi-web-ui's own example app pattern.
