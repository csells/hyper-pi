Now I have complete context. Let me produce the task breakdown.

## 1. PRD Understanding Summary

The PRD specifies 5 QoL features (F1–F5) for Pi-DE. Comparing against the **current codebase**:

| Feature | PRD Spec | Current State |
|---------|----------|---------------|
| **F1**: Send during streaming | Patch `AgentInterface.sendMessage` + `MessageEditor.isStreaming` | ✅ **DONE** — `patchSendDuringStreaming.ts` exists with tests, wired into `App.tsx` |
| **F2**: Cancel + submit buttons | Both stop and send buttons during streaming | ⚠️ **PARTIAL** — MessageEditor conditionally shows stop (empty input) vs send (typed text). But `RemoteAgent.abort()` is a no-op. TODO.md marks `[~]` |
| **F3**: Theming | Support all pi themes | ✅ **DONE** — 7 themes in `piThemes.ts` with 51→CSS token mapping, `<select>` dropdown |
| **F4**: Spawn verification | Manual surf test | ✅ **DONE** — checked in TODO.md |
| **F5**: Tool output investigation | CSS adjustments | ✅ **DONE** — `toolRenderers.ts` with compact TUI-style renderers |

**The sole remaining work**: Implement the abort wire protocol so the stop button (■) actually cancels agent work. This requires changes across 3 components: `hyper-pi-protocol` (types), `pi-socket` (handler calling `ctx.abort()`), and `pi-de` (`RemoteAgent.abort()` sending JSON over WebSocket).

## 2. Relevant Code/Docs/Resources Reviewed

| File | Key Findings |
|------|-------------|
| `TODO.md` | End-to-End section: `[ ] abort/cancel + send-during-streaming` — "Needs a new `abort` WebSocket message type in the protocol, a pi-socket handler that calls `pi.abort()`, and `RemoteAgent.abort()` sending it over WebSocket." |
| `pi-de/src/patchSendDuringStreaming.ts` | Overrides `MessageEditor.isStreaming` to conditionally return true (empty input + streaming → stop ■) or false (text in input → send). The stop button's click handler already calls `AgentInterface.session.abort()` → `RemoteAgent.abort()` |
| `pi-de/src/RemoteAgent.ts:159` | `abort(): void { // Remote agents don't support abort from the web UI }` — **no-op** |
| `pi-socket/src/index.ts:88-138` | `ws.on("message")` handler: parses JSON, handles `fetch_history`, else sends plain text via `pi.sendUserMessage()`. **No abort handling** — `{ "type": "abort" }` falls through to `sendUserMessage`, which is wrong. |
| `pi-socket/.../extensions/types.d.ts:193` | `ExtensionContext` has `abort(): void` — the abort capability exists on `ctx` (passed to `session_start` handler) |
| `pi-socket/.../extensions/types.d.ts:191` | `ExtensionContext` has `isIdle(): boolean` — already used by pi-socket for follow-up logic |
| `hyper-pi-protocol/src/index.ts` | Defines `FetchHistoryRequest`, `HistoryPageResponse`, `SocketEvent`. No `AbortRequest` type yet. |
| `pi-socket/src/index.test.ts` | `mockCtx` has `isIdle: vi.fn()` but **no `abort` mock** — needs updating for abort tests |
| `hypivisor/src/lib.rs` | Bidirectional relay — all WebSocket text frames forwarded transparently between Pi-DE and pi-socket. **No hypivisor changes needed.** |
| `pi-de/src/App.css` | `.btn-cancel-stream` CSS already defined (red border, danger color). But no button in JSX — the stop button lives inside `<message-editor>` via the `isStreaming` patch. |
| `pi-agent-core Agent.abort()` | Calls `this.abortController?.abort()` — stops the LLM stream and agent loop. This is what `ctx.abort()` delegates to. |

## 3. Sequential Implementation Steps

1. **Add `AbortRequest` type to `hyper-pi-protocol/src/index.ts`** — `{ type: "abort" }` interface, exported alongside `FetchHistoryRequest`
2. **Build protocol**: `cd hyper-pi-protocol && npm run build` so downstream packages pick up the type
3. **Add abort handler in `pi-socket/src/index.ts`** — after the `fetch_history` check, detect `{ type: "abort" }` and call `ctx.abort()`. Log at info level.
4. **Add `abort: vi.fn()` to `mockCtx` in `pi-socket/src/index.test.ts`** and add tests: abort message calls `ctx.abort()`, abort doesn't call `sendUserMessage`
5. **Implement `RemoteAgent.abort()` in `pi-de/src/RemoteAgent.ts`** — send `JSON.stringify({ type: "abort" })` over WebSocket if connected
6. **Re-export `AbortRequest` from `pi-de/src/types.ts`** (for type consistency)
7. **Update `pi-de/src/RemoteAgent.test.ts`** — test abort sends JSON, test abort is no-op when disconnected
8. **Update `TODO.md`** — check off the abort/cancel item in the End-to-End section
9. **Run all tests**: `cd pi-socket && npm test`, `cd pi-de && npm test && npm run build && npm run lint`

## 4. Parallelized Task Graph

### Gap Analysis

#### Missing Requirements
- **Abort is fire-and-forget**: `ctx.abort()` is void. Pi-DE gets no confirmation that abort succeeded — the agent will stop streaming and emit `agent_end`, which RemoteAgent already handles by setting `isStreaming = false`. No additional response handling needed.
- **Abort during tool execution**: `ctx.abort()` aborts the current `AbortController`, which cancels the LLM stream. If a bash command is running, it won't be killed (that requires `ctx.abortBash()`). This is acceptable — the TUI's stop button has the same behavior.

#### Edge Cases
- **Abort when not streaming**: `ctx.abort()` is safe to call when idle — the `abortController` is undefined, so `abort()` is a no-op. No guard needed in pi-socket.
- **Rapid abort + send**: User clicks stop (abort) then immediately types and sends. The abort cancels the current stream; the new message arrives via `sendUserMessage` with `deliverAs: "followUp"` because the agent may still be in a streaming state briefly. This is correct behavior.
- **JSON `{ "type": "abort" }` must not fall through to `sendUserMessage`**: Currently, any JSON that's not `fetch_history` is sent as a plain text prompt. The abort handler must `return` before the fallthrough.

#### Security Considerations
- No new security concerns — abort operates within the existing WebSocket trust boundary. Any connected client can already send arbitrary prompts.

#### Testing Requirements
- pi-socket unit tests: abort message calls `ctx.abort()`, abort doesn't trigger `sendUserMessage`, non-abort JSON still treated as prompt
- Pi-DE unit tests: `RemoteAgent.abort()` sends `{ type: "abort" }` JSON, abort is no-op when WebSocket is null or not OPEN
- All existing tests pass (177 pi-de, 94 pi-socket)

## Tasks

### Task 1: Add abort wire protocol type and pi-socket abort handler

Add the `AbortRequest` type to the shared wire protocol and implement the abort message handler in pi-socket.

**hyper-pi-protocol changes** (`hyper-pi-protocol/src/index.ts`):
- Add `AbortRequest` interface: `{ type: "abort" }` — exported alongside `FetchHistoryRequest`
- Add to the client→server message types section (near `FetchHistoryRequest`)
- Run `cd hyper-pi-protocol && npm run build` to compile

**pi-socket changes** (`pi-socket/src/index.ts`):
- In the `ws.on("message")` handler (around line 113), after the `fetch_history` check and before the plain-text prompt fallthrough, add:
  ```typescript
  if (parsed && typeof parsed === "object" && (parsed as any).type === "abort") {
    ctx.abort();
    return;
  }
  ```
- Import `AbortRequest` from `hyper-pi-protocol` in `pi-socket/src/types.ts` re-exports
- Log at info level: `log.info("pi-socket", "abort requested by client")`

**pi-socket test changes** (`pi-socket/src/index.test.ts`):
- Add `abort: vi.fn()` to `mockCtx` in `beforeEach`
- Add test: "calls ctx.abort() when receiving abort message" — send `{ "type": "abort" }` buffer, verify `mockCtx.abort` called and `mockPi.sendUserMessage` NOT called
- Add test: "does not treat abort as a text prompt" — verify `sendUserMessage` is not called for abort messages
- Verify existing `fetch_history` and plain-text tests still pass

**Acceptance criteria**:
- `AbortRequest` type exported from `hyper-pi-protocol`
- pi-socket handles `{ "type": "abort" }` by calling `ctx.abort()` and returning (not falling through to sendUserMessage)
- Tests verify abort handling and no regression
- `cd hyper-pi-protocol && npm run build` passes
- `cd pi-socket && npm test` passes (94+ tests)

Dependencies: none

### Task 2: Implement RemoteAgent.abort() in Pi-DE

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
- Add `AbortRequest` to the re-exports from `hyper-pi-protocol`

**Pi-DE test changes** (`pi-de/src/RemoteAgent.test.ts`):
- Add test: "abort() sends abort JSON when connected" — create RemoteAgent, connect to mock WebSocket, call `abort()`, verify `ws.send` called with `'{"type":"abort"}'`
- Add test: "abort() does nothing when WebSocket is null" — call `abort()` on unconnected RemoteAgent, no throw
- Add test: "abort() does nothing when WebSocket is not OPEN" — set `readyState` to CLOSED, call `abort()`, verify `ws.send` not called

**TODO.md update**:
- Change the End-to-End abort item from `[ ]` to `[x]` with note: "abort WebSocket message type added to protocol; pi-socket calls ctx.abort(); RemoteAgent.abort() sends { type: 'abort' } over WebSocket"
- Change the QoL `[~]` cancel button item to `[x]` with updated note

**Acceptance criteria**:
- `RemoteAgent.abort()` sends `{ "type": "abort" }` JSON over WebSocket when connected
- `RemoteAgent.abort()` is a safe no-op when disconnected
- Stop button (■) in MessageEditor now actually cancels agent work end-to-end
- Tests verify send behavior and edge cases
- `cd pi-de && npm test && npm run build && npm run lint` passes (177+ tests)

Dependencies: none

```tasks-json
[
  {
    "title": "Add abort wire protocol type and pi-socket abort handler",
    "description": "Add the `AbortRequest` type to the shared wire protocol and implement the abort message handler in pi-socket.\n\n**hyper-pi-protocol changes** (`hyper-pi-protocol/src/index.ts`):\n- Add `AbortRequest` interface: `{ type: \"abort\" }` — exported alongside `FetchHistoryRequest`\n- Add to the client→server message types section (near `FetchHistoryRequest`)\n- Run `cd hyper-pi-protocol && npm run build` to compile\n\n**pi-socket changes** (`pi-socket/src/index.ts`):\n- In the `ws.on(\"message\")` handler (around line 113), after the `fetch_history` check and before the plain-text prompt fallthrough, add abort detection:\n  ```typescript\n  if (parsed && typeof parsed === \"object\" && (parsed as any).type === \"abort\") {\n    ctx.abort();\n    return;\n  }\n  ```\n- Import `AbortRequest` from `hyper-pi-protocol` in `pi-socket/src/types.ts` re-exports\n- Log at info level: `log.info(\"pi-socket\", \"abort requested by client\")`\n\n**pi-socket test changes** (`pi-socket/src/index.test.ts`):\n- Add `abort: vi.fn()` to `mockCtx` in `beforeEach`\n- Add test: \"calls ctx.abort() when receiving abort message\" — send `{ \"type\": \"abort\" }` buffer, verify `mockCtx.abort` called and `mockPi.sendUserMessage` NOT called\n- Add test: \"does not treat abort as a text prompt\" — verify `sendUserMessage` is not called for abort messages\n- Verify existing `fetch_history` and plain-text tests still pass\n\n**Key implementation detail**: The abort handler MUST be placed after the `fetch_history` check but BEFORE the plain-text prompt fallthrough in the `ws.on(\"message\")` handler. Currently any JSON that's not `fetch_history` falls through to `sendUserMessage()` — the abort check must `return` before that.\n\n**Acceptance criteria**:\n- `AbortRequest` type exported from `hyper-pi-protocol`\n- pi-socket handles `{ \"type\": \"abort\" }` by calling `ctx.abort()` and returning (not falling through to sendUserMessage)\n- Tests verify abort handling and no regression on existing fetch_history/text prompt behavior\n- `cd hyper-pi-protocol && npm run build` passes\n- `cd pi-socket && npm test` passes (94+ tests)",
    "dependsOn": []
  },
  {
    "title": "Implement RemoteAgent.abort() in Pi-DE",
    "description": "Change `RemoteAgent.abort()` from a no-op to sending a JSON abort message over WebSocket, completing the abort control flow from Pi-DE → hypivisor proxy → pi-socket → `ctx.abort()`.\n\n**Pi-DE changes** (`pi-de/src/RemoteAgent.ts`):\n- Replace the no-op `abort()` method (line ~159) with:\n  ```typescript\n  abort(): void {\n    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;\n    this.ws.send(JSON.stringify({ type: \"abort\" }));\n  }\n  ```\n- Remove the comment `// Remote agents don't support abort from the web UI`\n\n**Pi-DE type re-export** (`pi-de/src/types.ts`):\n- Add `AbortRequest` to the re-exports from `hyper-pi-protocol` (the type will be added by the sibling task; if not yet available, define locally as `{ type: \"abort\" }` — the wire format is the contract)\n\n**Pi-DE test changes** (`pi-de/src/RemoteAgent.test.ts`):\n- Add test: \"abort() sends abort JSON when connected\" — create RemoteAgent, connect to mock WebSocket with `readyState = WebSocket.OPEN`, call `abort()`, verify `ws.send` called with `'{\"type\":\"abort\"}'`\n- Add test: \"abort() does nothing when WebSocket is null\" — call `abort()` on unconnected RemoteAgent, no throw\n- Add test: \"abort() does nothing when WebSocket is not OPEN\" — set `readyState` to CLOSED, call `abort()`, verify `ws.send` not called\n\n**TODO.md update**:\n- Change the End-to-End abort/cancel item from `[ ]` to `[x]` with note: \"abort WebSocket message type added to protocol; pi-socket calls ctx.abort(); RemoteAgent.abort() sends { type: 'abort' } over WebSocket\"\n- Change the QoL `[~]` cancel button item to `[x]` with updated note removing the 'abort is a no-op' caveat\n\n**How abort flows end-to-end**: User sees stop button (■) in MessageEditor when streaming with empty input → clicks it → MessageEditor calls `AgentInterface.session.abort()` → `RemoteAgent.abort()` → sends `{\"type\":\"abort\"}` over WebSocket → hypivisor relays transparently → pi-socket receives it → calls `ctx.abort()` → pi's AbortController fires → LLM stream stops → agent emits `agent_end` → RemoteAgent sets `isStreaming=false` → UI updates.\n\n**Acceptance criteria**:\n- `RemoteAgent.abort()` sends `{ \"type\": \"abort\" }` JSON over WebSocket when connected\n- `RemoteAgent.abort()` is a safe no-op when disconnected or WebSocket not OPEN\n- Stop button (■) in MessageEditor now actually cancels agent work end-to-end\n- Tests verify send behavior and edge cases (3 new tests minimum)\n- TODO.md updated to reflect completion\n- `cd pi-de && npm test && npm run build && npm run lint` passes (177+ tests)",
    "dependsOn": []
  }
]
```