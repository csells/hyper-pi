# Theme Toggle Label Update and F3 Completion

Update the theme toggle in the sidebar to clearly display "Dark" / "Light" / "System" labels instead of just emoji icons. Mark F3 (theming) as addressed with documentation of the limitation.

**Implementation**:
1. In `App.tsx`, update the theme toggle button to show text labels alongside emoji. For example: `🌙 Dark`, `☀️ Light`, `🖥️ System`.
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
