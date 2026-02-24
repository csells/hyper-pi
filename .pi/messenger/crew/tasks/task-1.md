# Add abort wire protocol type and pi-socket abort handler

Add the `AbortRequest` type to the shared wire protocol and implement the abort message handler in pi-socket.

**hyper-pi-protocol changes** (`hyper-pi-protocol/src/index.ts`):
- Add `AbortRequest` interface: `{ type: "abort" }` — exported alongside `FetchHistoryRequest`
- Add to the client→server message types section (near `FetchHistoryRequest`)
- Run `cd hyper-pi-protocol && npm run build` to compile

**pi-socket changes** (`pi-socket/src/index.ts`):
- In the `ws.on("message")` handler (around line 113), after the `fetch_history` check and before the plain-text prompt fallthrough, add abort detection:
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

**Key implementation detail**: The abort handler MUST be placed after the `fetch_history` check but BEFORE the plain-text prompt fallthrough in the `ws.on("message")` handler. Currently any JSON that's not `fetch_history` falls through to `sendUserMessage()` — the abort check must `return` before that.

**Acceptance criteria**:
- `AbortRequest` type exported from `hyper-pi-protocol`
- pi-socket handles `{ "type": "abort" }` by calling `ctx.abort()` and returning (not falling through to sendUserMessage)
- Tests verify abort handling and no regression on existing fetch_history/text prompt behavior
- `cd hyper-pi-protocol && npm run build` passes
- `cd pi-socket && npm test` passes (94+ tests)
