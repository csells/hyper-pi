# Pi-DE Quality of Life Features PRD — Remaining Items

## Overview
Implement the remaining unchecked QoL items from TODO.md. These require patching
pi-web-ui's `AgentInterface` and `MessageEditor` web components (similar to how
`patchMobileKeyboard.ts` already patches behavior), plus a spawn verification.

## Codebase Context
- **Pi-DE**: React + Vite + TypeScript app in `pi-de/`
- **Core files**: `src/App.tsx`, `src/App.css`, `src/RemoteAgent.ts`, `src/useAgent.ts`,
  `src/useHypivisor.ts`, `src/types.ts`, `src/patchMobileKeyboard.ts` (existing patch pattern)
- **pi-web-ui source** (read-only, for understanding): Located in
  `pi-de/node_modules/@mariozechner/pi-web-ui/src/components/`
  - `AgentInterface.ts` — has `sendMessage()` that gates on `isStreaming`
  - `MessageEditor.ts` — has `handleKeyDown()` that gates Enter on `!isStreaming`,
    renders either a stop button (■) OR a send button — never both
- **Existing patch pattern**: `patchMobileKeyboard.ts` uses MutationObserver to find
  the textarea inside `<agent-interface>` light DOM, then registers a capturing
  keydown listener to intercept before Lit's event binding. This is the proven
  approach for patching pi-web-ui behavior without modifying it.
- **Build**: `cd pi-de && npm run build` to verify, `npm test` for tests, `npm run lint` for types
- **Spawn**: `SpawnModal.tsx` sends `spawn_agent` RPC to hypivisor. The hypivisor's
  `spawn.rs` executes `pi` CLI. Needs verification with a real running hypivisor.

## Remaining Features

### F1: Allow Prompt Entry During Streaming
**TODO item**: "I STILL can't enter a prompt while the agent is producing it's result!!!"

The user MUST be able to type and send messages while the agent is streaming.
pi-socket already handles this via `pi.sendUserMessage(text, { deliverAs: "followUp" })`.

**The problem**: Two gates block sending during streaming:
1. `AgentInterface.sendMessage()` line: `if (...|| this.session?.state.isStreaming) return;`
2. `MessageEditor.handleKeyDown()`: `if (!this.isStreaming && ...) { this.handleSend(); }`

**Solution**: Create `src/patchSendDuringStreaming.ts` following the same pattern
as `patchMobileKeyboard.ts`:

1. **Patch `AgentInterface.sendMessage`**: After the `<agent-interface>` element is
   available, override its `sendMessage` method to remove the `isStreaming` gate.
   The patched version should:
   - Allow sending even when `this.session?.state.isStreaming` is true
   - Still block empty messages
   - Still call `this.session.prompt()` (which goes to `RemoteAgent.prompt()` → WebSocket)

2. **Patch `MessageEditor` keydown**: Use a capturing keydown listener on the
   textarea (same as `patchMobileKeyboard`) to allow Enter to trigger send even
   during streaming. On non-mobile devices, Enter should send. On mobile devices,
   the existing mobile patch takes precedence (Enter = newline).

**Important**: The mobile keyboard patch and the send-during-streaming patch must
compose correctly. The mobile patch calls `stopImmediatePropagation` for Enter on
mobile, so the streaming patch should only handle desktop (non-mobile) Enter sends.

**Files**:
- Create `src/patchSendDuringStreaming.ts`
- Create `src/patchSendDuringStreaming.test.ts`
- Update `src/App.tsx` to import and call the patch

### F2: Cancel + Submit Buttons During Streaming
**TODO item**: "need a cancel button AND a submit button during streaming responses"

Currently `MessageEditor` renders either a stop button (■) during streaming OR a
send button when idle — using a ternary. The user wants BOTH visible during streaming.

**Solution**: Create `src/patchStreamingButtons.ts`:

After `<agent-interface>` renders, find the button container in the MessageEditor's
light DOM and inject a send button next to the existing stop button when streaming.

1. Use MutationObserver to detect when the stop button (■) appears in the DOM
2. When streaming starts (stop button visible), add a send button next to it
3. Wire the send button to call the (already patched) `sendMessage` on AgentInterface
4. When streaming stops, the normal render cycle shows the send button and hides
   the stop button — our injected button should be removed

**Alternative simpler approach**: Instead of DOM injection, override the
MessageEditor's `render` method or use CSS to show both buttons. The render override
is cleaner — capture a reference to the MessageEditor element and patch its render
to always show both buttons (send + stop) when streaming.

Actually, the simplest approach: patch the `isStreaming` property on `MessageEditor`
so it's always false from the editor's perspective. This makes it always show the
send button and enable Enter-to-send. Then separately add a cancel/stop button in
Pi-DE's own UI (outside the web component). This avoids complex DOM manipulation.

**Recommended approach**: 
- Set `MessageEditor.isStreaming = false` always (via property override) so it 
  always shows the send button and always allows Enter-to-send
- Add a separate cancel button in Pi-DE's stage header (next to the status dot)
  that calls `RemoteAgent.abort()` when visible (only show during streaming)

**Files**:
- This can be part of the `patchSendDuringStreaming.ts` patch (set isStreaming=false on editor)
- Update `src/App.tsx` to add cancel button in stage header during streaming
- Update `src/App.css` for cancel button styling
- Add tests

### F3: Theming — Support All Pi Agent Themes
**TODO item**: "theming: support all of the pi agent themes"

We already implemented dark/light/system. The pi agent has a full theme system with
51 color tokens in JSON files (`dark.json`, `light.json`, plus user themes in
`~/.pi/agent/themes/`). However, these are TUI themes (ANSI terminal colors) that
don't directly map to web CSS.

**What "support all pi agent themes" means for Pi-DE**:
- Pi-DE's chrome (sidebar, header) has its own CSS variables
- The `<agent-interface>` web component uses Tailwind CSS with `.dark` class

**Solution**: The current dark/light/system toggle already covers the two built-in
pi themes. To "support all pi themes," the realistic interpretation is:
1. Keep the dark/light/system toggle (already done)
2. If the user has a preference in pi's `settings.json` (`"theme": "dark"` or
   `"theme": "light"`), we could read that — but Pi-DE doesn't have access to
   pi's settings directly

**For now**: Update the theme toggle to clearly label the options as "Dark" / "Light" / 
"System" and consider this item addressed. The TODO is ambiguous — the pi TUI themes
use 51 ANSI color tokens that have no web CSS equivalent.

Mark this done with a comment explaining the limitation.

### F4: Check That Spawn Works
**TODO item**: "check that Spawn works"

Manually verify spawn functionality using `surf` browser testing:
1. Start the hypivisor
2. Start Pi-DE dev server
3. Open Pi-DE in a browser tab (via surf)
4. Click "Spawn Agent"
5. Navigate to a directory
6. Click "Deploy Agent Here"
7. Verify the new agent appears in the roster
8. Verify clicking the new agent shows the chat interface

If spawn doesn't work, fix the issues found.

**Files**: No code changes expected unless bugs are found. This is a verification task.

### F5: Investigate Tool Output Differences
**TODO item**: "why does the tool output look SO different from the tui UI?"

The TUI uses custom terminal renderers (`bash-execution.ts`, `tool-execution.ts`)
with ANSI colors and the theme's 51 color tokens. The web UI uses pi-web-ui's
`BashRenderer` and `DefaultRenderer` with Tailwind CSS.

**Investigation approach**:
1. Take a screenshot of the TUI showing a bash tool call result
2. Take a screenshot of Pi-DE showing the same tool call result
3. Compare and document the differences
4. If the differences are just styling (colors, padding, borders), adjust Pi-DE's
   CSS to more closely match the TUI aesthetic

The most likely difference: the TUI shows collapsed/truncated tool output by default
while the web UI shows everything expanded. Also the TUI uses the theme's tool
colors (toolPendingBg, toolSuccessBg, toolErrorBg) which may differ from the
web UI's Tailwind defaults.

**Scope**: Investigation + CSS adjustments only. Don't rewrite renderers.

## Testing Requirements
- All patches must have unit tests following the pattern in `patchMobileKeyboard.test.ts`
- `cd pi-de && npm test && npm run build && npm run lint`

## Architecture Constraints
- **pi and pi-web-ui are never modified** — all changes via patches/overrides
- Follow the existing `patchMobileKeyboard.ts` pattern for patching web components
- Keep patches minimal and surgical
