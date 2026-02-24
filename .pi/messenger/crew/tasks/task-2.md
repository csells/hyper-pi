# Mobile virtual keyboard Enter-key behavior

On mobile devices, make Enter in the virtual keyboard insert a newline in the prompt textarea instead of submitting. The existing visible Send button in MessageEditor handles submission.

**Files to create/modify:**
- `pi-de/src/patchMobileKeyboard.ts` (new, ~60 lines) — Module that sets up mobile keyboard interception on the `<agent-interface>` element's textarea
- `pi-de/src/patchMobileKeyboard.test.ts` (new, ~100 lines) — Tests
- `pi-de/src/App.tsx` — Import `patchMobileKeyboard` and call it in the `useEffect` that wires the `agentInterfaceRef`, adding its cleanup to the effect return

**Implementation details:**
- Mobile detection: `window.matchMedia("(pointer: coarse)").matches` as primary signal (targets touch devices). Falls back to `"ontouchstart" in window`. Export `isMobileDevice()` for testability.
- `patchMobileKeyboard(el: HTMLElement): () => void` function:
  1. Uses `MutationObserver` to find the `textarea` element inside the `<agent-interface>` (it renders in light DOM — `createRenderRoot() { return this; }`)
  2. Adds a capturing `keydown` listener on the textarea
  3. If `isMobileDevice()` and `e.key === "Enter"` and `!e.shiftKey`: call `e.stopImmediatePropagation()` to prevent MessageEditor's `handleKeyDown` from firing. The default textarea behavior (insert newline) proceeds.
  4. Returns a cleanup function that removes the listener and disconnects the observer
- In `App.tsx`'s existing `useEffect` (the one that sets `ai.session`), after wiring the agent: `const cleanup = patchMobileKeyboard(el); return () => { cleanup(); };`
- The Send button in MessageEditor (onClick: this.handleSend) already works for submission.

**Why `stopImmediatePropagation` works:** Both our capturing listener and MessageEditor's `@keydown` handler are on the same element (the textarea, in light DOM). Our listener registered via `addEventListener("keydown", fn, { capture: true })` fires before Lit's event binding. Calling `stopImmediatePropagation()` prevents MessageEditor's handler from executing.

**Acceptance criteria:**
- On mobile (coarse pointer), Enter in textarea inserts newline, does NOT submit
- On desktop, Enter still submits (existing behavior unchanged)
- Shift+Enter behavior unchanged on all platforms
- Send button works on mobile to submit the prompt
- Cleanup function properly removes listeners
- Tests: mock `matchMedia`, verify Enter behavior on mobile vs desktop, verify cleanup
- Tests pass with `cd pi-de && npm test`
