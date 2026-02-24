# Patch Send-During-Streaming and MessageEditor isStreaming Override

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
