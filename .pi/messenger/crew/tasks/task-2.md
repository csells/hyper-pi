# Implement RemoteAgent.abort() in Pi-DE

Change `RemoteAgent.abort()` from a no-op to sending a JSON abort message over WebSocket, completing the abort control flow from Pi-DE → hypivisor proxy → pi-socket → `ctx.abort()`.

**Pi-DE changes** (`pi-de/src/RemoteAgent.ts`):
- Replace the no-op `abort()` method (line ~159) with:
  ```typescript
  abort(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ type: "abort" }));
  }
  ```
- Remove the comment `// Remote agents don't support abort from the web UI`

**Pi-DE type re-export** (`pi-de/src/types.ts`):
- Add `AbortRequest` to the re-exports from `hyper-pi-protocol` (the type will be added by the sibling task; if not yet available, define locally as `{ type: "abort" }` — the wire format is the contract)

**Pi-DE test changes** (`pi-de/src/RemoteAgent.test.ts`):
- Add test: "abort() sends abort JSON when connected" — create RemoteAgent, connect to mock WebSocket with `readyState = WebSocket.OPEN`, call `abort()`, verify `ws.send` called with `'{"type":"abort"}'`
- Add test: "abort() does nothing when WebSocket is null" — call `abort()` on unconnected RemoteAgent, no throw
- Add test: "abort() does nothing when WebSocket is not OPEN" — set `readyState` to CLOSED, call `abort()`, verify `ws.send` not called

**TODO.md update**:
- Change the End-to-End abort/cancel item from `[ ]` to `[x]` with note: "abort WebSocket message type added to protocol; pi-socket calls ctx.abort(); RemoteAgent.abort() sends { type: 'abort' } over WebSocket"
- Change the QoL `[~]` cancel button item to `[x]` with updated note removing the 'abort is a no-op' caveat

**How abort flows end-to-end**: User sees stop button (■) in MessageEditor when streaming with empty input → clicks it → MessageEditor calls `AgentInterface.session.abort()` → `RemoteAgent.abort()` → sends `{"type":"abort"}` over WebSocket → hypivisor relays transparently → pi-socket receives it → calls `ctx.abort()` → pi's AbortController fires → LLM stream stops → agent emits `agent_end` → RemoteAgent sets `isStreaming=false` → UI updates.

**Acceptance criteria**:
- `RemoteAgent.abort()` sends `{ "type": "abort" }` JSON over WebSocket when connected
- `RemoteAgent.abort()` is a safe no-op when disconnected or WebSocket not OPEN
- Stop button (■) in MessageEditor now actually cancels agent work end-to-end
- Tests verify send behavior and edge cases (3 new tests minimum)
- TODO.md updated to reflect completion
- `cd pi-de && npm test && npm run build && npm run lint` passes (177+ tests)
