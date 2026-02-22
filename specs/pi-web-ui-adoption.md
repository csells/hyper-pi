# Pi-DE: Adopt @mariozechner/pi-web-ui Components

Status: **Implemented**
Created: 2026-02-22

---

## Summary

Pi-DE now uses the official `@mariozechner/pi-web-ui` `<agent-interface>` web component
for the chat stage, satisfying requirements R-UI-24 and R-UI-34.

### What changed

| File | Change |
|------|--------|
| `package.json` | Added `@mariozechner/pi-web-ui`, `@mariozechner/pi-agent-core`, `@mariozechner/pi-ai` |
| `src/RemoteAgent.ts` | **New.** Duck-types the `Agent` interface over a pi-socket WebSocket |
| `src/useAgent.ts` | Returns a `RemoteAgent` instead of raw `ChatMessage[]` |
| `src/App.tsx` | Chat stage now renders `<agent-interface>` web component |
| `src/web-ui.d.ts` | **New.** TypeScript JSX declarations for custom elements |
| `src/App.css` | Added `.agent-interface-container` styles; scoped global reset |
| `vite.config.ts` | Externalize Node builtins pulled in by pi-ai providers |

### Architecture

```
┌──────────────────────────────────────────────────┐
│                  Pi-DE (React)                   │
│  ┌────────────┐  ┌─────────────────────────────┐ │
│  │  Sidebar    │  │  <agent-interface>          │ │
│  │  (React)    │  │  (pi-web-ui / Lit)          │ │
│  │  - Roster   │  │  - MessageList              │ │
│  │  - Spawn    │  │  - StreamingContainer       │ │
│  └────────────┘  │  - MessageEditor             │ │
│                   │  - ThinkingBlock             │ │
│                   └──────────┬──────────────────┘ │
│                              │ .session            │
│                   ┌──────────▼──────────────────┐ │
│                   │  RemoteAgent                 │ │
│                   │  (duck-types Agent)          │ │
│                   │  - state: AgentState         │ │
│                   │  - subscribe() → AgentEvent  │ │
│                   │  - prompt() → ws.send()      │ │
│                   └──────────┬──────────────────┘ │
└──────────────────────────────┼────────────────────┘
                               │ WebSocket
                    ┌──────────▼──────────────────┐
                    │  pi-socket extension         │
                    │  (running inside pi CLI)     │
                    └─────────────────────────────┘
```

### RemoteAgent event mapping

| pi-socket event | → AgentEvent | State change |
|-----------------|-------------|-------------|
| `init_state` | `agent_end` | Rebuild `messages[]`, set `tools[]` |
| `message_start` (assistant) | `agent_start`, `turn_start`, `message_start` | `isStreaming = true` |
| `delta` | `message_update` (text_delta) | Append to streaming assistant message |
| `tool_start` | `tool_execution_start`, `message_update` (toolcall_start) | Add to `pendingToolCalls` |
| `tool_end` | `tool_execution_end` | Remove from `pendingToolCalls`, add `toolResult` |
| `message_end` (assistant) | `message_end`, `turn_end`, `agent_end` | `isStreaming = false`, finalize message |

### Limitations vs. local Agent

- **No abort:** Remote agents can't be aborted from the web UI (Ctrl+C at terminal)
- **No model switching:** Model is owned by the remote pi instance
- **No thinking level control:** Owned by the remote pi instance
- **No attachments:** pi-socket doesn't support file upload
- **Tool results are stubs:** pi-socket only sends tool name + isError, not full output

These are disabled in the `<agent-interface>` config:
```tsx
ai.enableModelSelector = false;
ai.enableThinkingSelector = false;
ai.enableAttachments = false;
```

### What you get

- ✅ Proper markdown rendering with syntax-highlighted code blocks
- ✅ Streaming message display with real-time token updates
- ✅ Tool execution cards (start/end with success/error status)
- ✅ Thinking block rendering (when remote agent uses reasoning)
- ✅ Dark theme via pi-web-ui's Tailwind CSS `.dark` class
- ✅ Auto-scroll with smart scroll-away detection
- ✅ Same rendering engine as the official pi web-ui example app
