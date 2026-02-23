# Fix RemoteAgent event listener leak

## Problem
`RemoteAgent.connect()` uses `addEventListener("message")` but never calls `removeEventListener` in `disconnect()`. Each reconnect adds another listener. Old listeners fire on stale WebSockets, corrupting state.

## Files
- `pi-de/src/RemoteAgent.ts`
- `pi-de/src/RemoteAgent.test.ts`

## Changes
1. Track the message handler reference: `private messageHandler: ((event: MessageEvent) => void) | null = null`
2. In `connect()`: call `disconnect()` first to clean up any existing listener, then add the new one
3. In `disconnect()`: remove the event listener from the old WS before nulling `this.ws`
4. Add `onInitState` callback property so useAgent can get truncation info without a duplicate handler

## Tests
Add to `pi-de/src/RemoteAgent.test.ts`:
- Test: disconnect removes event listener (old WS messages don't fire)
- Test: connect→disconnect→connect cycle doesn't leak listeners
- Test: onInitState callback fires on init_state
