# Pi-socket index.ts unit tests

Add comprehensive unit tests for `pi-socket/src/index.ts` — the main extension module that currently has zero tests. Create `pi-socket/src/index.test.ts`.

**Files to create/modify:**
- `pi-socket/src/index.test.ts` (new — ~200 lines)

**What to test:**
1. **broadcast()** — sends JSON to all OPEN clients, skips CLOSING/CLOSED clients
2. **safeSerialize()** — handles BigInt, circular refs, functions, falls back to error JSON
3. **session_start handler** — finds port via portfinder, creates WSS, calls connectToHypivisor
4. **ws.on("message") handler** — calls `pi.sendUserMessage(text)` when idle, `pi.sendUserMessage(text, { deliverAs: "followUp" })` when busy
5. **init_state on client connect** — calls buildInitState and sends JSON to new client
6. **Event forwarding** — message_start, message_update, message_end, tool_execution_start/update/end all call broadcast()
7. **session_shutdown** — sends deregister RPC, closes WSS, closes hypivisor WS
8. **Reconnect logic** — exponential backoff (reconnectMs → double → capped at 5min), resets on success
9. **Hypivisor URL validation** — invalid URL sets hypivisorUrlValid=false, stops reconnects
10. **shutdownRequested flag** — prevents reconnect after shutdown

**Mock approach:** Create mock `ExtensionAPI` with `on()`, `sendUserMessage()`, `getAllTools()`, mock `ctx` with `sessionManager`, `isIdle()`, `ui.notify()`. Use vitest's `vi.mock()` for `ws` and `portfinder` modules. Export internal functions or test through the public extension function.

**Acceptance criteria:**
- All 10 areas tested with positive and negative cases (~15-20 tests)
- Tests pass with `cd pi-socket && npm test`
- No changes to production code (or minimal refactoring to enable testability without changing behavior)
