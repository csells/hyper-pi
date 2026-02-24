# Pi-DE infinite scroll client with history prepending

Implement the client side of lazy message loading: detect scroll-to-top, send `fetch_history` requests, and prepend older messages to the conversation.

**Files to modify:**
- `pi-de/src/RemoteAgent.ts` — Add:
  - `fetchHistory(before: number, limit: number): void` method that sends JSON `{ type: "fetch_history", before, limit }` over the WebSocket
  - Handle `history_page` response in `handleSocketEvent()`: prepend `messages` to `this._state.messages`, update local state
  - Track `hasMore` and `oldestIndex` state properties
  - Add `onHistoryPage?: (page: HistoryPageResponse) => void` callback
- `pi-de/src/useAgent.ts` — Add:
  - `isLoadingHistory` state, `hasMoreHistory` state
  - `oldestIndex` ref for pagination cursor
  - Wire `remoteAgent.onHistoryPage` to update loading/cursor state
  - `loadOlderMessages()` function calling `remoteAgent.fetchHistory(oldestIndex, 50)`
  - Initialize `oldestIndex` from `init_state` message count
  - Return `{ isLoadingHistory, hasMoreHistory, loadOlderMessages }` from hook
- `pi-de/src/App.tsx` — Add:
  - Destructure new values from `useAgent()`
  - `useEffect` attaching scroll listener to `agentInterfaceRef`'s `.overflow-y-auto` child
  - When `scrollTop < 50` and `hasMoreHistory` and `!isLoadingHistory`, call `loadOlderMessages()`
  - Show loading indicator above messages when `isLoadingHistory`
  - After prepend, restore scroll position: save `scrollHeight` before, set `scrollTop += newScrollHeight - oldScrollHeight` after
- `pi-de/src/App.css` — Add `.loading-history` styles (centered spinner/text above messages)

**Scroll position restoration:**
```typescript
const container = agentInterfaceRef.current?.querySelector(".overflow-y-auto");
const prevHeight = container.scrollHeight;
// ... after messages prepended ...
requestAnimationFrame(() => {
  container.scrollTop += container.scrollHeight - prevHeight;
});
```

**RemoteAgent history_page handling:**
```typescript
if (socketEvent.type === "history_page") {
  const page = socketEvent as HistoryPageResponse;
  this._state = { ...this._state, messages: [...page.messages, ...this._state.messages] };
  this.onHistoryPage?.(page);
  this.emit({ type: "agent_end", messages: this._state.messages });
  return;
}
```

**Acceptance criteria:**
- Scrolling to top triggers `fetch_history` request with correct cursor
- Older messages prepended above existing messages
- Scroll position preserved (no jump) after prepending
- Loading indicator visible while fetching
- No fetches when `hasMore` is false
- Debouncing prevents rapid duplicate requests
- Tests: RemoteAgent `fetchHistory()` sends correct JSON, `history_page` handling prepends, useAgent loading state, scroll detection
- Tests pass with `cd pi-de && npm test`
