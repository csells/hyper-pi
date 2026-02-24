# History pagination protocol and pi-socket server handler

Add the `fetch_history` request/response protocol types to `hyper-pi-protocol` and implement the server-side handler in pi-socket that serves paginated history from the session branch.

**Files to modify:**
- `hyper-pi-protocol/src/index.ts` — Add new types:
  ```typescript
  export interface FetchHistoryRequest {
    type: "fetch_history";
    before: number;  // message index — fetch messages before this index
    limit: number;   // max messages to return
  }
  export interface HistoryPageResponse {
    type: "history_page";
    messages: AgentMessage[];
    hasMore: boolean;
    oldestIndex: number;  // index of the oldest message in this page
  }
  ```
  Update `SocketEvent` union to include `HistoryPageResponse`.
- `pi-socket/src/history.ts` — Add `getHistoryPage(entries: unknown[], before: number, limit: number): HistoryPageResponse` function. Extract the message-extraction logic from `buildInitState` into a shared `extractMessages(entries)` helper. `getHistoryPage` returns the slice `[max(0, before-limit) .. before]` plus `hasMore` flag and `oldestIndex`.
- `pi-socket/src/index.ts` — Modify `ws.on("message")` handler to detect JSON `fetch_history` requests vs plain text prompts. Try `JSON.parse(text)` — if result has `type === "fetch_history"`, handle it. On parse failure or any other type, fall through to existing `sendUserMessage()` logic. Must store `ctx` reference accessible to the handler.
- `pi-socket/src/types.ts` — Re-export `FetchHistoryRequest` and `HistoryPageResponse` from hyper-pi-protocol.

**Message routing logic in `ws.on("message")`:**
```typescript
const text = data.toString();
if (!text.trim()) { /* reject empty */ return; }
let parsed: unknown;
try { parsed = JSON.parse(text); } catch { parsed = null; }
if (parsed && typeof parsed === "object" && (parsed as any).type === "fetch_history") {
  const req = parsed as FetchHistoryRequest;
  const page = getHistoryPage(ctx.sessionManager.getBranch(), req.before, req.limit);
  if (ws.readyState === WebSocket.OPEN) ws.send(safeSerialize(page));
  return;
}
// Plain text prompt — existing logic unchanged
```

**Acceptance criteria:**
- `getHistoryPage()` correctly slices messages from session entries
- `getHistoryPage()` returns `hasMore: true` when older messages exist, `false` at beginning
- Edge cases handled: `before=0`, `limit > total messages`, empty entries, `before > total`
- JSON `fetch_history` messages are handled and NOT sent to `pi.sendUserMessage()`
- Plain text prompts (including valid JSON that isn't `fetch_history`) still work as before
- `hyper-pi-protocol` builds: `cd hyper-pi-protocol && npm run build`
- New tests: `getHistoryPage()` unit tests (~8 tests), message routing tests (~4 tests)
- Tests pass with `cd pi-socket && npm test`
