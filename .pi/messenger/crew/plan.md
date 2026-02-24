Now I have a thorough understanding of the codebase. Let me produce the task breakdown.

## 1. PRD Understanding Summary

The request implements 4 mobile features for Pi-DE from TODO.md:

1. **Responsive mobile layout** — On viewports <768px, show roster as full-screen, clicking an agent shows full-screen chat with a back button. The CSS media queries already exist in `App.css` (lines 575-600) with `.agent-selected` class rules, but `App.tsx` never applies that class.

2. **Mobile VKB behavior** — On mobile virtual keyboards, Enter should insert a newline (not submit). A visible Send button handles submission. The `<agent-interface>` web component uses light DOM (`createRenderRoot() { return this }`), so the textarea is directly accessible for event interception. The `MessageEditor` component's `handleKeyDown` does `Enter && !shiftKey → handleSend()`.

3. **Lazy message loading / infinite scroll** — Load recent N messages on connect, fetch older on scroll-to-top. Requires a new `fetch_history` request/response protocol in pi-socket, new types in `hyper-pi-protocol`, and Pi-DE scroll detection + message prepending in `RemoteAgent`.

4. **Cloudflare tunnel setup** — Infrastructure docs only, no app code changes.

## 2. Relevant Code/Docs/Resources Reviewed

| File | Purpose | Key Findings |
|------|---------|-------------|
| `pi-de/src/App.tsx` | Root layout component | 2-column grid, `activeNode` state, `agentInterfaceRef`, never applies `agent-selected` class |
| `pi-de/src/App.css` | All styles | Lines 575-600 have mobile media queries for `.agent-selected` toggling roster/chat, but class is never applied |
| `pi-de/src/RemoteAgent.ts` | WebSocket adapter | Duck-types Agent interface, handles `init_state` and all `AgentEvent` types, no pagination support |
| `pi-de/src/useAgent.ts` | Agent connection hook | Creates `RemoteAgent`, manages WS lifecycle, handles `historyTruncated` state |
| `pi-de/src/types.ts` | Re-exports from hyper-pi-protocol | Clean re-export layer |
| `pi-de/src/rpc.ts` | JSON-RPC helper | `rpcCall()` with timeout, used for hypivisor registry calls only (not agent calls) |
| `hyper-pi-protocol/src/index.ts` | Shared wire types | `InitStateEvent`, `SocketEvent`, `NodeInfo`, etc. — no pagination types exist |
| `pi-socket/src/index.ts` | Extension entry | `ws.on("message")` treats ALL incoming messages as plain text prompts — no JSON request parsing |
| `pi-socket/src/history.ts` | `buildInitState()` | Extracts messages from `ctx.sessionManager.getBranch()`, truncates at 500KB, sets `truncated: true` |
| `pi-web-ui MessageEditor.js` | Keyboard handling | `handleKeyDown`: `Enter && !shiftKey → handleSend()`. Light DOM (`createRenderRoot → this`). Has visible Send button |
| `pi-web-ui AgentInterface.js` | Scroll handling | `_scrollContainer = this.querySelector(".overflow-y-auto")`, `_handleScroll` tracks scroll position. Light DOM |
| `hypivisor/src/lib.rs` | Proxy relay | Bidirectional text relay — JSON messages pass through transparently |
| `specs/requirements.md` | R-UI-3 | Mobile single-pane layout requirement defined |
| `pi-de/*.test.*` | Existing tests | Pattern: mock WebSocket, render hooks, test events |
| `pi-socket/src/history.test.ts` | History tests | 12 tests for buildInitState — good pattern for pagination tests |

## 3. Sequential Implementation Steps

1. **Add responsive mobile layout to Pi-DE** — Toggle `agent-selected` class on `.pi-de-layout` via React state when `activeNode` is set, add a back button in the stage-header, verify the existing CSS media queries activate correctly. Add tests.

2. **Add mobile VKB keyboard behavior** — Create a `patchMobileKeyboard.ts` module that detects mobile viewport and intercepts Enter key on the `<agent-interface>` textarea to insert newlines instead of sending. The visible Send button in MessageEditor already handles submission. Wire it up via the `agentInterfaceRef` in App.tsx. Add tests.

3. **Add `fetch_history` protocol types and pi-socket server handler** — Define `FetchHistoryRequest` and `HistoryPageResponse` in `hyper-pi-protocol`. Modify pi-socket's `ws.on("message")` to detect JSON `fetch_history` requests vs. plain text prompts. Add `getHistoryPage()` to `history.ts` that slices the session branch. Add tests.

4. **Add Pi-DE infinite scroll client** — Add `fetchHistory(before, limit)` to `RemoteAgent`, handle `history_page` responses, detect scroll-to-top on the agent-interface's `.overflow-y-auto` container to trigger loading, prepend older messages to state. Add tests.

5. **Document Cloudflare tunnel setup** — Create docs with `cloudflared tunnel` configuration for accessing the hypivisor and Pi-DE from mobile devices on different networks.

## 4. Parallelized Task Graph

**Parallelism summary:** 5 tasks form 2 independent streams:

- **Stream A (Mobile UI):** Task 1 + Task 2 (independent, separate files)
- **Stream B (Pagination):** Task 3 → Task 4 (protocol/server before client)
- **Stream C (Docs):** Task 5 (independent)

Wave 1 (all independent): Tasks 1, 2, 3, 5
Wave 2 (after deps): Task 4 (needs Task 3)

Critical path length: **2 waves** — most work happens in wave 1.

---

## Gap Analysis

### Missing Requirements
- pi-socket currently treats ALL incoming WebSocket messages as plain text prompts — no structured JSON request parsing exists. `fetch_history` requires adding a JSON request router alongside the existing text path.
- No mechanism to identify message indices or timestamps for pagination cursors. `getBranch()` returns an ordered array — index-based slicing is the simplest approach.
- The `<agent-interface>` component's scroll container (`.overflow-y-auto`) doesn't expose a scroll-to-top event — Pi-DE must attach its own scroll listener.

### Edge Cases
- **Concurrent `fetch_history` + live events:** A `history_page` response arriving while new messages are streaming must not corrupt message ordering. Prepending must be insertion-safe.
- **Empty history page:** Agent with fewer messages than the page size should return `hasMore: false` on the first (and only) fetch.
- **JSON vs text disambiguation:** A user could type valid JSON as a prompt. The `fetch_history` handler must only match `{ type: "fetch_history", ... }` and fall through to `sendUserMessage` for everything else.
- **Back button on mobile during agent streaming:** Returning to roster while the agent is streaming should not cause errors — the existing `useAgent` cleanup handles this.
- **VKB detection reliability:** Some tablets in landscape mode are >768px but still have VKBs. Use `"ontouchstart" in window` OR `matchMedia("(pointer: coarse)")` as secondary signals.
- **Race between `init_state` and `fetch_history`:** If the user scrolls up before `init_state` arrives, the fetch must be deferred until after init.

### Security Considerations
- The `fetch_history` endpoint runs over the same authenticated WebSocket — no additional auth needed.
- The Cloudflare tunnel doc must emphasize that the tunnel provides transport security but `HYPI_TOKEN` is still required for application-level auth.

### Testing Requirements
- **Unit tests (vitest):** Mobile layout class toggling, back button navigation, VKB keyboard interception, `getHistoryPage()` slicing/pagination, `RemoteAgent.fetchHistory()`, history response handling
- **DOM tests:** Verify `agent-selected` class presence/absence, textarea keydown behavior on mobile, scroll event trigger detection
- **Integration pattern:** Existing `RemoteAgent.test.ts` mock WebSocket pattern reusable for pagination tests

---

## Tasks

### Task 1: Responsive mobile layout with roster-to-chat navigation

Implement the mobile-first responsive layout where the roster and chat view are full-screen pages that toggle on agent selection, satisfying R-UI-3.

**Files to modify:**
- `pi-de/src/App.tsx` — Add `agent-selected` class to `.pi-de-layout` when `activeNode` is non-null. Add a back button `<button>` inside `.stage-header` that calls `setActiveNode(null)`. The back button should only render on mobile (via CSS or a `useMediaQuery`-style check).
- `pi-de/src/App.css` — Style the `.back-button` in the stage-header (touch-friendly 44px, left-aligned). Verify/fix the existing media query rules at lines 575-600. Add `display: none` for `.back-button` on desktop viewports.

**Implementation details:**
- The className on the layout div changes from `"pi-de-layout"` to `\`pi-de-layout \${activeNode ? "agent-selected" : ""}\`` 
- The existing CSS rules (`.pi-de-layout.agent-selected .roster-pane { display: none }` and `.pi-de-layout.agent-selected .main-stage { display: flex }`) already handle the visibility toggling
- The back button goes inside `.stage-header` before the `<h3>`: `<button className="back-button" onClick={() => setActiveNode(null)}>← Back</button>`
- On desktop (>767px), `.back-button { display: none }` — the sidebar is always visible

**Acceptance criteria:**
- On viewports <768px, only roster is visible when no agent is selected
- Clicking an agent card shows full-screen chat, roster is hidden
- Back button in chat header returns to roster (clears `activeNode`)
- Back button is hidden on desktop viewports
- All existing desktop tests pass unchanged
- New tests: verify `agent-selected` class toggling, back button click clears selection
- Tests pass with `cd pi-de && npm test`

Dependencies: none

### Task 2: Mobile virtual keyboard Enter-key behavior

On mobile devices, make Enter in the virtual keyboard insert a newline in the prompt textarea instead of submitting. The existing visible Send button in `MessageEditor` handles submission.

**Files to create/modify:**
- `pi-de/src/patchMobileKeyboard.ts` (new, ~60 lines) — Module that sets up mobile keyboard interception on the `<agent-interface>` element's textarea
- `pi-de/src/patchMobileKeyboard.test.ts` (new, ~100 lines) — Tests
- `pi-de/src/App.tsx` — Import `patchMobileKeyboard` and call it in the `useEffect` that wires the `agentInterfaceRef`

**Implementation details:**
- Mobile detection: `window.matchMedia("(pointer: coarse)").matches` as primary signal (targets touch devices). Falls back to `"ontouchstart" in window`. Export `isMobileDevice()` for testability.
- `patchMobileKeyboard(el: HTMLElement)` function:
  1. Uses `MutationObserver` or `requestAnimationFrame` loop to find the `textarea` element inside the `<agent-interface>` (it renders in light DOM)
  2. Adds a capturing `keydown` listener on the textarea
  3. If `isMobileDevice()` and `e.key === "Enter"` and `!e.shiftKey`: call `e.stopImmediatePropagation()` to prevent MessageEditor's `handleKeyDown` from firing. The default textarea behavior (insert newline) proceeds.
  4. Returns a cleanup function that removes the listener and disconnects the observer
- In `App.tsx`'s `useEffect`, after setting `ai.session = agent.remoteAgent`:
  ```typescript
  const cleanup = patchMobileKeyboard(el);
  return () => { cleanup(); };
  ```
- The Send button in `MessageEditor` (line 345 `onClick: this.handleSend`) already works — it calls `onSend` with the textarea value. No changes needed to the web component.

**Why `stopImmediatePropagation` works:** Both our capturing listener and MessageEditor's `@keydown` handler are on the same element (the textarea, in light DOM). Our listener registered via `addEventListener("keydown", fn, { capture: true })` fires before Lit's event binding. Calling `stopImmediatePropagation()` prevents MessageEditor's handler from executing.

**Acceptance criteria:**
- On mobile (coarse pointer), Enter in textarea inserts newline, does NOT submit
- On desktop, Enter still submits (existing behavior unchanged)
- Shift+Enter behavior unchanged on all platforms
- Send button works on mobile to submit the prompt
- Cleanup function properly removes listeners
- Tests: mock `matchMedia`, verify Enter behavior on mobile vs desktop, verify cleanup
- Tests pass with `cd pi-de && npm test`

Dependencies: none

### Task 3: History pagination protocol and pi-socket server handler

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
- `pi-socket/src/history.ts` — Add `getHistoryPage(entries, before, limit)` function:
  - Extracts messages from session entries (same logic as `buildInitState`)
  - Returns the slice `[max(0, before-limit) .. before]` plus `hasMore` flag
  - Reuses the same entry-to-message extraction logic (extract to shared helper)
- `pi-socket/src/index.ts` — Modify `ws.on("message")` handler:
  - Try to parse incoming text as JSON
  - If it has `type: "fetch_history"`, call `getHistoryPage()` and `ws.send()` the response
  - Otherwise, fall through to existing `sendUserMessage()` logic
  - JSON parse failure means it's a plain text prompt (most messages) — proceed as before
- `pi-socket/src/types.ts` — Re-export new types from hyper-pi-protocol

**Message routing logic in `ws.on("message")`:**
```typescript
const text = data.toString();
if (!text.trim()) { /* reject empty */ return; }

// Try structured request
let parsed: unknown;
try { parsed = JSON.parse(text); } catch { parsed = null; }
if (parsed && typeof parsed === "object" && (parsed as any).type === "fetch_history") {
  const req = parsed as FetchHistoryRequest;
  const page = getHistoryPage(ctx.sessionManager.getBranch(), req.before, req.limit);
  if (ws.readyState === WebSocket.OPEN) ws.send(safeSerialize(page));
  return;
}

// Plain text prompt — existing logic
```

**Acceptance criteria:**
- `getHistoryPage()` correctly slices messages from session entries
- `getHistoryPage()` returns `hasMore: true` when there are older messages, `false` at beginning
- `getHistoryPage()` handles edge cases: `before=0`, `limit > total messages`, empty entries
- JSON `fetch_history` messages are handled and don't get sent to `pi.sendUserMessage()`
- Plain text prompts (including valid JSON that isn't `fetch_history`) still work as before
- `hyper-pi-protocol` builds: `cd hyper-pi-protocol && npm run build`
- Tests pass with `cd pi-socket && npm test`
- New tests: `getHistoryPage()` unit tests (~8 tests), message routing tests (~4 tests)

Dependencies: none

### Task 4: Pi-DE infinite scroll client with history prepending

Implement the client side of lazy message loading: detect scroll-to-top, send `fetch_history` requests, and prepend older messages to the conversation.

**Files to modify:**
- `pi-de/src/RemoteAgent.ts` — Add:
  - `fetchHistory(before: number, limit: number): void` method that sends JSON `{ type: "fetch_history", before, limit }` over the WebSocket
  - Handle `history_page` response in `handleSocketEvent()`: prepend `messages` to `this._state.messages`, update local state, emit an event so the UI re-renders
  - Track `hasMore` and `oldestIndex` state for pagination cursor
  - Add `onHistoryPage` callback (like `onInitState`) so useAgent can update loading state
- `pi-de/src/useAgent.ts` — Add:
  - `isLoadingHistory` state
  - `oldestIndex` ref tracking the cursor for next fetch
  - Wire `remoteAgent.onHistoryPage` callback to update loading/cursor state
  - `loadOlderMessages()` function that calls `remoteAgent.fetchHistory(oldestIndex, 50)`
  - Initialize `oldestIndex` from `init_state` (message count or a provided index)
  - Return `{ isLoadingHistory, hasMoreHistory, loadOlderMessages }` from the hook
- `pi-de/src/App.tsx` — Add:
  - Destructure `isLoadingHistory`, `hasMoreHistory`, `loadOlderMessages` from `useAgent()`
  - Add a scroll listener (`useEffect`) on the `agentInterfaceRef`'s `.overflow-y-auto` child
  - When `scrollTop === 0` and `hasMoreHistory` and `!isLoadingHistory`, call `loadOlderMessages()`
  - Show a loading indicator (e.g. `<div className="loading-history">Loading older messages…</div>`) above the messages when `isLoadingHistory`
  - After prepending, restore scroll position so content doesn't jump (save `scrollHeight` before prepend, set `scrollTop += newScrollHeight - oldScrollHeight` after)
- `pi-de/src/App.css` — Add `.loading-history` styles

**Scroll position restoration:**
```typescript
const container = agentInterfaceRef.current?.querySelector(".overflow-y-auto");
if (!container) return;
const prevHeight = container.scrollHeight;
// ... after messages prepended (via state update) ...
requestAnimationFrame(() => {
  container.scrollTop += container.scrollHeight - prevHeight;
});
```

**Message prepending in RemoteAgent:**
```typescript
case "history_page": {
  const page = event as HistoryPageResponse;
  this._state = {
    ...this._state,
    messages: [...page.messages, ...this._state.messages],
  };
  this.onHistoryPage?.(page);
  this.emit({ type: "agent_end", messages: this._state.messages });
  break;
}
```

**Acceptance criteria:**
- Scrolling to the top of the conversation triggers a `fetch_history` request
- Older messages are prepended above existing messages
- Scroll position is preserved (no jump) after prepending
- Loading indicator shows while fetching
- When `hasMore` is false, no more fetches are triggered
- Debouncing prevents rapid duplicate requests
- Tests: RemoteAgent `fetchHistory()` sends correct JSON, `history_page` handling prepends messages, scroll detection triggers, loading state transitions
- Tests pass with `cd pi-de && npm test`

Dependencies: Task 3 ("History pagination protocol and pi-socket server handler" — provides `FetchHistoryRequest`/`HistoryPageResponse` types in hyper-pi-protocol and the server endpoint in pi-socket)

### Task 5: Cloudflare tunnel setup documentation

Document how to set up a Cloudflare tunnel so Pi-DE can be accessed from mobile devices on different networks.

**Files to create:**
- `docs/cloudflare-tunnel.md` (new, ~80 lines) — Setup guide

**Content:**
1. **Prerequisites:** `cloudflared` CLI installed, Cloudflare account (free tier works)
2. **Quick tunnel (no account needed):** `cloudflared tunnel --url http://localhost:31415` — creates a temporary public URL for the hypivisor
3. **Named tunnel setup:** `cloudflared tunnel create hyper-pi`, configure `~/.cloudflared/config.yml`:
   ```yaml
   tunnel: hyper-pi
   credentials-file: ~/.cloudflared/<tunnel-id>.json
   ingress:
     - hostname: hyper-pi.yourdomain.com
       service: http://localhost:31415
     - hostname: pide.yourdomain.com
       service: http://localhost:5180
     - service: http_status:404
   ```
4. **Pi-DE configuration:** Set `VITE_HYPIVISOR_PORT` and adjust the WebSocket URL construction in useAgent.ts/useHypivisor.ts if needed (wss:// vs ws://)
5. **Security note:** Always set `HYPI_TOKEN` when exposing over a tunnel. The tunnel provides transport encryption but `HYPI_TOKEN` provides application-level auth.
6. **WebSocket considerations:** Cloudflare tunnels support WebSocket natively — no special config needed.
7. **Mobile testing:** Open the tunnel URL in a mobile browser to access Pi-DE.

**Acceptance criteria:**
- Doc covers quick tunnel and named tunnel setups
- Includes security warnings about HYPI_TOKEN
- References existing env vars (`VITE_HYPIVISOR_PORT`, `HYPI_TOKEN`)
- No code changes required

Dependencies: none

---

```tasks-json
[
  {
    "title": "Responsive mobile layout with roster-to-chat navigation",
    "description": "Implement the mobile-first responsive layout where the roster and chat view are full-screen pages that toggle on agent selection, satisfying R-UI-3.\n\n**Files to modify:**\n- `pi-de/src/App.tsx` — Add `agent-selected` class to `.pi-de-layout` when `activeNode` is non-null. Add a back button inside `.stage-header` that calls `setActiveNode(null)`. The back button should only render on mobile (hidden via CSS on desktop).\n- `pi-de/src/App.css` — Style the `.back-button` in the stage-header (touch-friendly 44px, left-aligned). Verify/fix the existing media query rules at lines 575-600. Add `display: none` for `.back-button` on desktop viewports.\n\n**Implementation details:**\n- The className on the layout div changes from `\"pi-de-layout\"` to `` `pi-de-layout ${activeNode ? \"agent-selected\" : \"\"}` ``\n- The existing CSS rules (`.pi-de-layout.agent-selected .roster-pane { display: none }` and `.pi-de-layout.agent-selected .main-stage { display: flex }`) already handle the visibility toggling\n- The back button goes inside `.stage-header` before the `<h3>`: `<button className=\"back-button\" onClick={() => setActiveNode(null)}>← Back</button>`\n- On desktop (>767px), `.back-button { display: none }` — the sidebar is always visible\n\n**Acceptance criteria:**\n- On viewports <768px, only roster is visible when no agent is selected\n- Clicking an agent card shows full-screen chat, roster is hidden\n- Back button in chat header returns to roster (clears activeNode)\n- Back button is hidden on desktop viewports\n- All existing desktop tests pass unchanged\n- New tests: verify `agent-selected` class toggling, back button click clears selection\n- Tests pass with `cd pi-de && npm test`",
    "dependsOn": []
  },
  {
    "title": "Mobile virtual keyboard Enter-key behavior",
    "description": "On mobile devices, make Enter in the virtual keyboard insert a newline in the prompt textarea instead of submitting. The existing visible Send button in MessageEditor handles submission.\n\n**Files to create/modify:**\n- `pi-de/src/patchMobileKeyboard.ts` (new, ~60 lines) — Module that sets up mobile keyboard interception on the `<agent-interface>` element's textarea\n- `pi-de/src/patchMobileKeyboard.test.ts` (new, ~100 lines) — Tests\n- `pi-de/src/App.tsx` — Import `patchMobileKeyboard` and call it in the `useEffect` that wires the `agentInterfaceRef`, adding its cleanup to the effect return\n\n**Implementation details:**\n- Mobile detection: `window.matchMedia(\"(pointer: coarse)\").matches` as primary signal (targets touch devices). Falls back to `\"ontouchstart\" in window`. Export `isMobileDevice()` for testability.\n- `patchMobileKeyboard(el: HTMLElement): () => void` function:\n  1. Uses `MutationObserver` to find the `textarea` element inside the `<agent-interface>` (it renders in light DOM — `createRenderRoot() { return this; }`)\n  2. Adds a capturing `keydown` listener on the textarea\n  3. If `isMobileDevice()` and `e.key === \"Enter\"` and `!e.shiftKey`: call `e.stopImmediatePropagation()` to prevent MessageEditor's `handleKeyDown` from firing. The default textarea behavior (insert newline) proceeds.\n  4. Returns a cleanup function that removes the listener and disconnects the observer\n- In `App.tsx`'s existing `useEffect` (the one that sets `ai.session`), after wiring the agent: `const cleanup = patchMobileKeyboard(el); return () => { cleanup(); };`\n- The Send button in MessageEditor (onClick: this.handleSend) already works for submission.\n\n**Why `stopImmediatePropagation` works:** Both our capturing listener and MessageEditor's `@keydown` handler are on the same element (the textarea, in light DOM). Our listener registered via `addEventListener(\"keydown\", fn, { capture: true })` fires before Lit's event binding. Calling `stopImmediatePropagation()` prevents MessageEditor's handler from executing.\n\n**Acceptance criteria:**\n- On mobile (coarse pointer), Enter in textarea inserts newline, does NOT submit\n- On desktop, Enter still submits (existing behavior unchanged)\n- Shift+Enter behavior unchanged on all platforms\n- Send button works on mobile to submit the prompt\n- Cleanup function properly removes listeners\n- Tests: mock `matchMedia`, verify Enter behavior on mobile vs desktop, verify cleanup\n- Tests pass with `cd pi-de && npm test`",
    "dependsOn": []
  },
  {
    "title": "History pagination protocol and pi-socket server handler",
    "description": "Add the `fetch_history` request/response protocol types to `hyper-pi-protocol` and implement the server-side handler in pi-socket that serves paginated history from the session branch.\n\n**Files to modify:**\n- `hyper-pi-protocol/src/index.ts` — Add new types:\n  ```typescript\n  export interface FetchHistoryRequest {\n    type: \"fetch_history\";\n    before: number;  // message index — fetch messages before this index\n    limit: number;   // max messages to return\n  }\n  export interface HistoryPageResponse {\n    type: \"history_page\";\n    messages: AgentMessage[];\n    hasMore: boolean;\n    oldestIndex: number;  // index of the oldest message in this page\n  }\n  ```\n  Update `SocketEvent` union to include `HistoryPageResponse`.\n- `pi-socket/src/history.ts` — Add `getHistoryPage(entries: unknown[], before: number, limit: number): HistoryPageResponse` function. Extract the message-extraction logic from `buildInitState` into a shared `extractMessages(entries)` helper. `getHistoryPage` returns the slice `[max(0, before-limit) .. before]` plus `hasMore` flag and `oldestIndex`.\n- `pi-socket/src/index.ts` — Modify `ws.on(\"message\")` handler to detect JSON `fetch_history` requests vs plain text prompts. Try `JSON.parse(text)` — if result has `type === \"fetch_history\"`, handle it. On parse failure or any other type, fall through to existing `sendUserMessage()` logic. Must store `ctx` reference accessible to the handler.\n- `pi-socket/src/types.ts` — Re-export `FetchHistoryRequest` and `HistoryPageResponse` from hyper-pi-protocol.\n\n**Message routing logic in `ws.on(\"message\")`:**\n```typescript\nconst text = data.toString();\nif (!text.trim()) { /* reject empty */ return; }\nlet parsed: unknown;\ntry { parsed = JSON.parse(text); } catch { parsed = null; }\nif (parsed && typeof parsed === \"object\" && (parsed as any).type === \"fetch_history\") {\n  const req = parsed as FetchHistoryRequest;\n  const page = getHistoryPage(ctx.sessionManager.getBranch(), req.before, req.limit);\n  if (ws.readyState === WebSocket.OPEN) ws.send(safeSerialize(page));\n  return;\n}\n// Plain text prompt — existing logic unchanged\n```\n\n**Acceptance criteria:**\n- `getHistoryPage()` correctly slices messages from session entries\n- `getHistoryPage()` returns `hasMore: true` when older messages exist, `false` at beginning\n- Edge cases handled: `before=0`, `limit > total messages`, empty entries, `before > total`\n- JSON `fetch_history` messages are handled and NOT sent to `pi.sendUserMessage()`\n- Plain text prompts (including valid JSON that isn't `fetch_history`) still work as before\n- `hyper-pi-protocol` builds: `cd hyper-pi-protocol && npm run build`\n- New tests: `getHistoryPage()` unit tests (~8 tests), message routing tests (~4 tests)\n- Tests pass with `cd pi-socket && npm test`",
    "dependsOn": []
  },
  {
    "title": "Pi-DE infinite scroll client with history prepending",
    "description": "Implement the client side of lazy message loading: detect scroll-to-top, send `fetch_history` requests, and prepend older messages to the conversation.\n\n**Files to modify:**\n- `pi-de/src/RemoteAgent.ts` — Add:\n  - `fetchHistory(before: number, limit: number): void` method that sends JSON `{ type: \"fetch_history\", before, limit }` over the WebSocket\n  - Handle `history_page` response in `handleSocketEvent()`: prepend `messages` to `this._state.messages`, update local state\n  - Track `hasMore` and `oldestIndex` state properties\n  - Add `onHistoryPage?: (page: HistoryPageResponse) => void` callback\n- `pi-de/src/useAgent.ts` — Add:\n  - `isLoadingHistory` state, `hasMoreHistory` state\n  - `oldestIndex` ref for pagination cursor\n  - Wire `remoteAgent.onHistoryPage` to update loading/cursor state\n  - `loadOlderMessages()` function calling `remoteAgent.fetchHistory(oldestIndex, 50)`\n  - Initialize `oldestIndex` from `init_state` message count\n  - Return `{ isLoadingHistory, hasMoreHistory, loadOlderMessages }` from hook\n- `pi-de/src/App.tsx` — Add:\n  - Destructure new values from `useAgent()`\n  - `useEffect` attaching scroll listener to `agentInterfaceRef`'s `.overflow-y-auto` child\n  - When `scrollTop < 50` and `hasMoreHistory` and `!isLoadingHistory`, call `loadOlderMessages()`\n  - Show loading indicator above messages when `isLoadingHistory`\n  - After prepend, restore scroll position: save `scrollHeight` before, set `scrollTop += newScrollHeight - oldScrollHeight` after\n- `pi-de/src/App.css` — Add `.loading-history` styles (centered spinner/text above messages)\n\n**Scroll position restoration:**\n```typescript\nconst container = agentInterfaceRef.current?.querySelector(\".overflow-y-auto\");\nconst prevHeight = container.scrollHeight;\n// ... after messages prepended ...\nrequestAnimationFrame(() => {\n  container.scrollTop += container.scrollHeight - prevHeight;\n});\n```\n\n**RemoteAgent history_page handling:**\n```typescript\nif (socketEvent.type === \"history_page\") {\n  const page = socketEvent as HistoryPageResponse;\n  this._state = { ...this._state, messages: [...page.messages, ...this._state.messages] };\n  this.onHistoryPage?.(page);\n  this.emit({ type: \"agent_end\", messages: this._state.messages });\n  return;\n}\n```\n\n**Acceptance criteria:**\n- Scrolling to top triggers `fetch_history` request with correct cursor\n- Older messages prepended above existing messages\n- Scroll position preserved (no jump) after prepending\n- Loading indicator visible while fetching\n- No fetches when `hasMore` is false\n- Debouncing prevents rapid duplicate requests\n- Tests: RemoteAgent `fetchHistory()` sends correct JSON, `history_page` handling prepends, useAgent loading state, scroll detection\n- Tests pass with `cd pi-de && npm test`",
    "dependsOn": ["History pagination protocol and pi-socket server handler"]
  },
  {
    "title": "Cloudflare tunnel setup documentation",
    "description": "Document how to set up a Cloudflare tunnel so Pi-DE and the hypivisor can be accessed from mobile devices on different networks.\n\n**Files to create:**\n- `docs/cloudflare-tunnel.md` (new, ~80 lines) — Setup guide\n\n**Content:**\n1. **Prerequisites:** `cloudflared` CLI installed (`brew install cloudflare/cloudflare/cloudflared`), Cloudflare account (free tier works)\n2. **Quick tunnel (no account needed):** `cloudflared tunnel --url http://localhost:31415` — creates a temporary public URL for the hypivisor. Note: this gives you a random `*.trycloudflare.com` subdomain.\n3. **Named tunnel setup:** `cloudflared tunnel create hyper-pi`, configure `~/.cloudflared/config.yml` with ingress rules for both the hypivisor (port 31415) and Pi-DE dev server (port 5180)\n4. **Pi-DE configuration:** When accessing via tunnel, Pi-DE connects to the hypivisor at the tunnel's hostname. Set `VITE_HYPIVISOR_PORT` to 443 (tunnel uses HTTPS). Note that WebSocket upgrades work over Cloudflare tunnels natively.\n5. **Security warning:** ALWAYS set `HYPI_TOKEN` env var on the hypivisor when exposing via tunnel. The tunnel provides transport encryption (TLS) but `HYPI_TOKEN` provides application-level authentication.\n6. **WebSocket note:** Cloudflare tunnels support WebSocket protocol natively — no special configuration needed. The proxy relay through the hypivisor works identically whether local or tunneled.\n7. **Mobile testing workflow:** Start hypivisor + Pi-DE locally, run `cloudflared tunnel`, open the tunnel URL on your phone's browser.\n\n**Acceptance criteria:**\n- Doc covers quick tunnel and named tunnel setups\n- Includes security warnings about HYPI_TOKEN\n- References existing env vars (VITE_HYPIVISOR_PORT, VITE_HYPI_TOKEN, HYPI_TOKEN)\n- Includes example cloudflared config.yml\n- No code changes required",
    "dependsOn": []
  }
]
```