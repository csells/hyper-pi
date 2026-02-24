# Responsive mobile layout with roster-to-chat navigation

Implement the mobile-first responsive layout where the roster and chat view are full-screen pages that toggle on agent selection, satisfying R-UI-3.

**Files to modify:**
- `pi-de/src/App.tsx` — Add `agent-selected` class to `.pi-de-layout` when `activeNode` is non-null. Add a back button inside `.stage-header` that calls `setActiveNode(null)`. The back button should only render on mobile (hidden via CSS on desktop).
- `pi-de/src/App.css` — Style the `.back-button` in the stage-header (touch-friendly 44px, left-aligned). Verify/fix the existing media query rules at lines 575-600. Add `display: none` for `.back-button` on desktop viewports.

**Implementation details:**
- The className on the layout div changes from `"pi-de-layout"` to `` `pi-de-layout ${activeNode ? "agent-selected" : ""}` ``
- The existing CSS rules (`.pi-de-layout.agent-selected .roster-pane { display: none }` and `.pi-de-layout.agent-selected .main-stage { display: flex }`) already handle the visibility toggling
- The back button goes inside `.stage-header` before the `<h3>`: `<button className="back-button" onClick={() => setActiveNode(null)}>← Back</button>`
- On desktop (>767px), `.back-button { display: none }` — the sidebar is always visible

**Acceptance criteria:**
- On viewports <768px, only roster is visible when no agent is selected
- Clicking an agent card shows full-screen chat, roster is hidden
- Back button in chat header returns to roster (clears activeNode)
- Back button is hidden on desktop viewports
- All existing desktop tests pass unchanged
- New tests: verify `agent-selected` class toggling, back button click clears selection
- Tests pass with `cd pi-de && npm test`
