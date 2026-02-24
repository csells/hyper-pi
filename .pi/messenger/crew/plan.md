Now I have all the context needed. Let me produce the task breakdown.

## 1. PRD Understanding Summary

The PRD specifies 5 remaining QoL features for Pi-DE:

- **F1 (Send During Streaming)**: Users can't type/send while the agent streams. Two gates in pi-web-ui's `AgentInterface.sendMessage()` (blocks on `isStreaming`) and `MessageEditor.handleKeyDown()` (blocks Enter on `isStreaming`) must be bypassed via patches.
- **F2 (Cancel + Submit Buttons)**: During streaming, only a stop button (■) is shown. Users need both a send button AND a cancel/stop button visible. The recommended approach: override `MessageEditor.isStreaming` to always be `false` (so it always shows the send button), and add a separate cancel button in Pi-DE's stage header.
- **F3 (Theming)**: The existing dark/light/system toggle already covers the two built-in pi themes. TUI themes use 51 ANSI tokens with no web CSS equivalent. Mark as addressed with clear labels.
- **F4 (Spawn Verification)**: Manual verification via `surf` browser testing. No code changes unless bugs are found.
- **F5 (Tool Output Investigation)**: Compare TUI vs Pi-DE tool rendering. CSS-only adjustments if needed.

## 2. Relevant Code/Docs/Resources Reviewed

| File | Key Findings |
|------|-------------|
| `pi-de/src/patchMobileKeyboard.ts` | **The proven patch pattern**: MutationObserver finds textarea in light DOM, registers capturing keydown listener to intercept before Lit's event binding. Returns cleanup function. |
| `pi-de/src/patchMobileKeyboard.test.ts` | **Test pattern**: Creates mock DOM elements, mocks `matchMedia`, tests event interception with `stopImmediatePropagation` spies, tests MutationObserver async textarea discovery, tests cleanup. |
| `pi-web-ui/AgentInterface.ts` | `sendMessage()` has explicit `isStreaming` gate on line: `if ((!input.trim()...) \|\| this.session?.state.isStreaming) return;`. Passes `.isStreaming=${state.isStreaming}` to `<message-editor>`. The `session.abort()` is wired to `onAbort`. |
| `pi-web-ui/MessageEditor.ts` | `handleKeyDown()` gates Enter send on `!this.isStreaming`. `render()` uses a ternary: `this.isStreaming ? [stop button] : [send button]` — never both. `isStreaming` is a `@property()`. |
| `pi-de/src/RemoteAgent.ts` | `abort()` is a no-op: `// Remote agents don't support abort from the web UI`. This needs to be implemented for F2's cancel button. |
| `pi-socket/src/index.ts` | No abort mechanism exists. `sendUserMessage` with `deliverAs: "followUp"` is how messages are injected during streaming. No `pi.abort()` or similar call. |
| `pi-de/src/App.tsx` | Wires `patchMobileKeyboard(el)` in the `useEffect` that sets `session` on `<agent-interface>`. The `isAgentStreaming` state from `useAgent` drives status dot `working` class. |
| `pi-de/src/useAgent.ts` | Exposes `isAgentStreaming` from `remoteAgent.state.isStreaming` via subscription. |
| `pi-de/src/useTheme.ts` | Theme cycle: dark → light → system. Persists to localStorage. |

## 3. Sequential Implementation Steps

1. **Create `patchSendDuringStreaming.ts`**: Patch `AgentInterface.sendMessage()` to remove the `isStreaming` gate. Also patch `MessageEditor.isStreaming` property to always return `false` so it always renders the send button and allows Enter-to-send.
2. **Create `patchSendDuringStreaming.test.ts`**: Unit tests following the `patchMobileKeyboard.test.ts` pattern.
3. **Add cancel button in `App.tsx`**: Show a "Cancel" button in the stage header (next to the status dot) when `isAgentStreaming` is true. Wire it to send a cancel signal.
4. **Implement `RemoteAgent.abort()`**: Send an abort/cancel message over the WebSocket. Since pi-socket doesn't have a dedicated abort handler, the simplest approach is to send a text like `/cancel` or use `followUp` semantics — but actually, `pi.sendUserMessage()` with `deliverAs: "followUp"` is the only mechanism. The `abort()` on `Agent` uses `AbortController`. Since there's no wire protocol for abort, the cancel button should instead just send a follow-up message like "stop" (which the user can do manually anyway). **Actually**: Looking deeper, `RemoteAgent.abort()` can't do anything because pi-socket has no abort handler. The PRD's F2 says "calls `RemoteAgent.abort()`" but abort is a no-op. The cancel button should visually exist but the tooltip should indicate it sends a follow-up — or we leave abort as no-op and document the limitation.
5. **Style the cancel button in `App.css`**.
6. **Update theme toggle labels** in `App.tsx` to clearly show "Dark"/"Light"/"System" per F3.
7. **F4 and F5 are manual verification/investigation tasks** — no code changes expected.

## 4. Parallelized Task Graph

### Gap Analysis

#### Missing Requirements
- **No abort wire protocol**: pi-socket has no mechanism to cancel/abort the current agent operation remotely. `RemoteAgent.abort()` is a no-op. The cancel button can only provide visual feedback — it can't actually stop the agent. This is an intentional pi constraint ("pi is never modified"). The cancel button should call `RemoteAgent.abort()` but users should understand it's a no-op until pi-socket adds abort support.
- **Patch composition with mobile**: The `patchSendDuringStreaming` and `patchMobileKeyboard` patches both add capturing keydown listeners on the same textarea. Order matters — the mobile patch calls `stopImmediatePropagation` on Enter for mobile, which would prevent the streaming patch from firing. The streaming patch must check `!isMobileDevice()` before handling Enter.
- **MessageEditor `isStreaming` override**: Setting `isStreaming` to always `false` on MessageEditor means the stop button (■) in the MessageEditor will never show. This is fine because F2 adds a cancel button in Pi-DE's own stage header instead.

#### Edge Cases
- **Rapid message sending**: User could spam Enter during streaming. `AgentInterface.sendMessage` clears the editor value, and pi-socket uses `deliverAs: "followUp"` — so rapid sends should queue correctly.
- **Patch timing**: The `<agent-interface>` element may not have rendered `<message-editor>` yet when the patch runs. Use MutationObserver (same as mobile patch) to find elements.
- **Cleanup on agent switch**: When the user switches agents, the old patch cleanup must run and the new patch must be applied to the new `<agent-interface>` render cycle.

#### Security Considerations
- No security concerns — all changes are frontend UI patches within the existing trust boundary.

#### Testing Requirements
- Unit tests for `patchSendDuringStreaming.ts` following `patchMobileKeyboard.test.ts` pattern
- Unit tests for cancel button visibility in `App.test.tsx`
- All existing tests must continue passing (115 tests)
- Build and lint must pass: `npm test && npm run build && npm run lint`

## Tasks

### Task 1: Patch Send-During-Streaming and MessageEditor isStreaming Override

Create `pi-de/src/patchSendDuringStreaming.ts` that patches two things:

1. **`AgentInterface.sendMessage()`**: After the `<agent-interface>` element is available, override its `sendMessage` method to remove the `isStreaming` gate. The patched version should allow sending when `this.session?.state.isStreaming` is true, but still block empty messages and still call `this.session.prompt()`.

2. **`MessageEditor.isStreaming` property**: Override the `isStreaming` property on the `<message-editor>` element (found via `el.querySelector("message-editor")`) to always return `false`. This makes it always render the send button (not the stop button) and always allow Enter-to-send via its `handleKeyDown`.

Use MutationObserver to find elements in light DOM (same pattern as `patchMobileKeyboard.ts`). Return a cleanup function.

**Composition with mobile patch**: The `isStreaming=false` override on MessageEditor means `handleKeyDown` will allow Enter-to-send. On mobile, the existing `patchMobileKeyboard` fires first (capturing phase, registered before this patch) and calls `stopImmediatePropagation` for Enter — so Enter on mobile still inserts a newline. On desktop, `handleKeyDown` allows send. This composes correctly without additional logic.

**Files to create/modify**:
- Create `pi-de/src/patchSendDuringStreaming.ts` — exports `patchSendDuringStreaming(el: HTMLElement): () => void`
- Create `pi-de/src/patchSendDuringStreaming.test.ts` — unit tests following `patchMobileKeyboard.test.ts` patterns
- Modify `pi-de/src/App.tsx` — import and call `patchSendDuringStreaming(el)` in the `useEffect` that sets up `<agent-interface>`, alongside the existing `patchMobileKeyboard(el)` call. Compose cleanups.

**Acceptance criteria**:
- `patchSendDuringStreaming()` overrides `AgentInterface.sendMessage` to remove isStreaming gate
- `patchSendDuringStreaming()` overrides `MessageEditor.isStreaming` to always be `false`
- Tests verify: sendMessage works during streaming, empty messages still blocked, MessageEditor always shows send button, cleanup restores original behavior
- `patchMobileKeyboard` still works correctly (Enter = newline on mobile)
- `npm test && npm run build && npm run lint` all pass

Dependencies: none

### Task 2: Add Cancel Button to Stage Header

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

Dependencies: Patch Send-During-Streaming and MessageEditor isStreaming Override

### Task 3: Theme Toggle Label Update and F3 Completion

Update the theme toggle in the sidebar to clearly display "Dark" / "Light" / "System" labels instead of just emoji icons. Mark F3 (theming) as addressed with documentation of the limitation.

**Implementation**:
1. In `App.tsx`, update the theme toggle button to show text labels alongside or instead of just emoji. For example: `🌙 Dark`, `☀️ Light`, `🖥️ System`.
2. Optionally add a tooltip explaining the toggle.
3. In `TODO.md`, check off the theming item with a note: "Pi-DE supports dark/light/system. Pi TUI themes use 51 ANSI color tokens with no web CSS equivalent — full TUI theme parity requires a future mapping layer."

**Files to create/modify**:
- Modify `pi-de/src/App.tsx` — update theme toggle button content
- Modify `pi-de/src/App.css` — adjust `.theme-toggle` width if needed for text labels
- Update `TODO.md` — mark theming item as done with explanation

**Acceptance criteria**:
- Theme toggle shows clear text labels (Dark/Light/System)
- Theme cycling still works correctly (dark → light → system → dark)
- Existing theme tests still pass
- `npm test && npm run build && npm run lint` all pass

Dependencies: none

### Task 4: Spawn Verification (F4) and Tool Output Investigation (F5)

Manually verify that Spawn works end-to-end using surf browser testing, and investigate tool output differences between TUI and Pi-DE.

**Spawn Verification (F4)**:
1. Start the hypivisor (in tmux)
2. Start Pi-DE dev server (in tmux)
3. Use `surf tab.new` to open Pi-DE
4. Click "Spawn Agent", navigate to a directory, click "Deploy Agent Here"
5. Verify the new agent appears in the roster
6. Verify clicking the new agent shows the chat interface
7. If bugs found, fix them

**Tool Output Investigation (F5)**:
1. Take a screenshot of Pi-DE showing a tool call result
2. Compare visually with TUI tool output
3. Document the differences
4. If CSS-only fixes can improve parity, apply them to `App.css`
5. Update `TODO.md` with findings

**Files to create/modify**:
- Possibly `pi-de/src/App.css` — CSS adjustments for tool output if needed
- Update `TODO.md` — check off spawn and tool output items with notes

**Acceptance criteria**:
- Spawn verified working or bugs fixed
- Tool output differences documented
- Any CSS adjustments don't break existing styling
- `npm test && npm run build && npm run lint` all pass

Dependencies: none

```tasks-json
[
  {
    "title": "Patch Send-During-Streaming and MessageEditor isStreaming Override",
    "description": "Create `pi-de/src/patchSendDuringStreaming.ts` that patches two things:\n\n1. **`AgentInterface.sendMessage()`**: After the `<agent-interface>` element is available, override its `sendMessage` method to remove the `isStreaming` gate. The patched version should allow sending when `this.session?.state.isStreaming` is true, but still block empty messages and still call `this.session.prompt()`.\n\n2. **`MessageEditor.isStreaming` property**: Override the `isStreaming` property on the `<message-editor>` element (found via `el.querySelector(\"message-editor\")`) to always return `false`. This makes it always render the send button (not the stop button) and always allow Enter-to-send via its `handleKeyDown`.\n\nUse MutationObserver to find elements in light DOM (same pattern as `patchMobileKeyboard.ts`). Return a cleanup function.\n\n**Composition with mobile patch**: The `isStreaming=false` override on MessageEditor means `handleKeyDown` will allow Enter-to-send. On mobile, the existing `patchMobileKeyboard` fires first (capturing phase, registered before this patch) and calls `stopImmediatePropagation` for Enter — so Enter on mobile still inserts a newline. On desktop, `handleKeyDown` allows send. This composes correctly without additional logic.\n\n**Files to create/modify**:\n- Create `pi-de/src/patchSendDuringStreaming.ts` — exports `patchSendDuringStreaming(el: HTMLElement): () => void`\n- Create `pi-de/src/patchSendDuringStreaming.test.ts` — unit tests following `patchMobileKeyboard.test.ts` patterns\n- Modify `pi-de/src/App.tsx` — import and call `patchSendDuringStreaming(el)` in the `useEffect` that sets up `<agent-interface>`, alongside the existing `patchMobileKeyboard(el)` call. Compose cleanups.\n\n**Acceptance criteria**:\n- `patchSendDuringStreaming()` overrides `AgentInterface.sendMessage` to remove isStreaming gate\n- `patchSendDuringStreaming()` overrides `MessageEditor.isStreaming` to always be `false`\n- Tests verify: sendMessage works during streaming, empty messages still blocked, MessageEditor always shows send button, cleanup restores original behavior\n- `patchMobileKeyboard` still works correctly (Enter = newline on mobile)\n- `npm test && npm run build && npm run lint` all pass",
    "dependsOn": []
  },
  {
    "title": "Add Cancel Button to Stage Header",
    "description": "Add a cancel/stop button in Pi-DE's stage header that is visible only during streaming. Since `MessageEditor.isStreaming` is now always `false` (from Task 1's patch), the built-in stop button (■) will never render. Pi-DE needs its own cancel button.\n\n**Implementation**:\n1. In `App.tsx`, add a cancel button inside `.stage-header`, next to the status dot, visible only when `isAgentStreaming` is `true`.\n2. Wire the button to call `agent.remoteAgent.abort()`.\n3. Style it in `App.css` — small, red-ish square icon (■) matching the pi-web-ui aesthetic, positioned in the header.\n4. `RemoteAgent.abort()` is currently a no-op — that's acceptable for now. The button provides the UI affordance; actual abort support requires pi-socket changes (out of scope per PRD).\n\n**Files to create/modify**:\n- Modify `pi-de/src/App.tsx` — add cancel button in stage header, conditionally rendered when `isAgentStreaming` is true\n- Modify `pi-de/src/App.css` — add `.btn-cancel-stream` styles\n- Add tests in `pi-de/src/App.test.tsx` — verify cancel button appears during streaming and is hidden when idle\n\n**Acceptance criteria**:\n- Cancel button (■) visible in stage header only during streaming\n- Cancel button calls `remoteAgent.abort()` on click\n- Cancel button hidden when not streaming\n- Existing stage header layout (back button, session name, status dot) not disrupted\n- Tests verify visibility and click behavior\n- `npm test && npm run build && npm run lint` all pass",
    "dependsOn": ["Patch Send-During-Streaming and MessageEditor isStreaming Override"]
  },
  {
    "title": "Theme Toggle Label Update and F3 Completion",
    "description": "Update the theme toggle in the sidebar to clearly display \"Dark\" / \"Light\" / \"System\" labels instead of just emoji icons. Mark F3 (theming) as addressed with documentation of the limitation.\n\n**Implementation**:\n1. In `App.tsx`, update the theme toggle button to show text labels alongside emoji. For example: `🌙 Dark`, `☀️ Light`, `🖥️ System`.\n2. Optionally add a tooltip explaining the toggle.\n3. In `TODO.md`, check off the theming item with a note: \"Pi-DE supports dark/light/system. Pi TUI themes use 51 ANSI color tokens with no web CSS equivalent — full TUI theme parity requires a future mapping layer.\"\n\n**Files to create/modify**:\n- Modify `pi-de/src/App.tsx` — update theme toggle button content\n- Modify `pi-de/src/App.css` — adjust `.theme-toggle` width if needed for text labels\n- Update `TODO.md` — mark theming item as done with explanation\n\n**Acceptance criteria**:\n- Theme toggle shows clear text labels (Dark/Light/System)\n- Theme cycling still works correctly (dark → light → system → dark)\n- Existing theme tests still pass\n- `npm test && npm run build && npm run lint` all pass",
    "dependsOn": []
  },
  {
    "title": "Spawn Verification (F4) and Tool Output Investigation (F5)",
    "description": "Manually verify that Spawn works end-to-end using surf browser testing, and investigate tool output differences between TUI and Pi-DE.\n\n**Spawn Verification (F4)**:\n1. Start the hypivisor (in tmux): `cd hypivisor && cargo run`\n2. Start Pi-DE dev server (in tmux): `cd pi-de && npm run dev`\n3. Use `surf tab.new http://localhost:5173` to open Pi-DE\n4. Click \"Spawn Agent\", navigate to a directory, click \"Deploy Agent Here\"\n5. Verify the new agent appears in the roster\n6. Verify clicking the new agent shows the chat interface\n7. If bugs found, fix them and add tests\n\n**Tool Output Investigation (F5)**:\n1. Take a screenshot of Pi-DE showing a bash/tool call result using `surf screenshot`\n2. Compare visually with TUI tool output\n3. Document the differences in TODO.md\n4. If CSS-only fixes can improve visual parity, apply them to `App.css`\n5. Update `TODO.md` with findings and check off both items\n\n**Files to create/modify**:\n- Possibly `pi-de/src/App.css` — CSS adjustments for tool output if differences warrant changes\n- Update `TODO.md` — check off spawn and tool output items with notes\n\n**Acceptance criteria**:\n- Spawn verified working end-to-end OR bugs identified and fixed with tests\n- Tool output differences documented with screenshots or descriptions\n- Any CSS adjustments don't break existing styling or tests\n- `npm test && npm run build && npm run lint` all pass",
    "dependsOn": []
  }
]
```