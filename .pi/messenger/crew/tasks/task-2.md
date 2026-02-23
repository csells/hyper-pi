# Fix useAgent.ts connection leaks and error handling

## Problem
1. Inner `connect()` creates new WebSocket without closing previous one — leaks connections
2. `ws.onmessage` only checks for `init_state` — silently ignores proxy error JSON (`{"error": "Agent not found"}`)
3. Double message parsing: both `remoteAgent.connect(ws)` (addEventListener) AND `ws.onmessage` process messages

## Files
- `pi-de/src/useAgent.ts`

## Changes
1. In inner `connect()`, close `wsRef.current` before creating new WS (null onclose first to prevent recursive reconnect)
2. Handle proxy error messages in onmessage: if `data.error`, set status to "disconnected" or "offline" and close WS
3. Remove the duplicate `ws.onmessage` handler — let RemoteAgent be the single message handler. Have RemoteAgent expose truncation info via a callback or state.
4. Remove `activeNode?.status` from effect deps (Gemini H1) — handle offline via App.tsx sync effect

## Tests
Add tests in `pi-de/src/useAgent.test.ts`:
- Test: reconnect closes previous WebSocket
- Test: proxy error message sets status to disconnected
- Test: no duplicate message parsing
