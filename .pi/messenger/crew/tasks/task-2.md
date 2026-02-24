# Add Cancel Button to Stage Header

Add a cancel/stop button in Pi-DE's stage header that is visible only during streaming. Since `MessageEditor.isStreaming` is now always `false` (from Task 1's patch), the built-in stop button (■) will never render. Pi-DE needs its own cancel button.

**Implementation**:
1. In `App.tsx`, add a cancel button inside `.stage-header`, next to the status dot, visible only when `isAgentStreaming` is `true`.
2. Wire the button to call `agent.remoteAgent.abort()`.
3. Style it in `App.css` — small, red-ish square icon (■) matching the pi-web-ui aesthetic, positioned in the header.
4. `RemoteAgent.abort()` is currently a no-op — that's acceptable for now. The button provides the UI affordance; actual abort support requires pi-socket changes (out of scope per PRD).

**Files to create/modify**:
- Modify `pi-de/src/App.tsx` — add cancel button in stage header, conditionally rendered when `isAgentStreaming` is true
- Modify `pi-de/src/App.css` — add `.btn-cancel-stream` styles
- Add tests in `pi-de/src/App.test.tsx` — verify cancel button appears during streaming and is hidden when idle

**Acceptance criteria**:
- Cancel button (■) visible in stage header only during streaming
- Cancel button calls `remoteAgent.abort()` on click
- Cancel button hidden when not streaming
- Existing stage header layout (back button, session name, status dot) not disrupted
- Tests verify visibility and click behavior
- `npm test && npm run build && npm run lint` all pass
