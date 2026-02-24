# Spawn Verification (F4) and Tool Output Investigation (F5)

Manually verify that Spawn works end-to-end using surf browser testing, and investigate tool output differences between TUI and Pi-DE.

**Spawn Verification (F4)**:
1. Start the hypivisor (in tmux): `cd hypivisor && cargo run`
2. Start Pi-DE dev server (in tmux): `cd pi-de && npm run dev`
3. Use `surf tab.new http://localhost:5173` to open Pi-DE
4. Click "Spawn Agent", navigate to a directory, click "Deploy Agent Here"
5. Verify the new agent appears in the roster
6. Verify clicking the new agent shows the chat interface
7. If bugs found, fix them and add tests

**Tool Output Investigation (F5)**:
1. Take a screenshot of Pi-DE showing a bash/tool call result using `surf screenshot`
2. Compare visually with TUI tool output
3. Document the differences in TODO.md
4. If CSS-only fixes can improve visual parity, apply them to `App.css`
5. Update `TODO.md` with findings and check off both items

**Files to create/modify**:
- Possibly `pi-de/src/App.css` — CSS adjustments for tool output if differences warrant changes
- Update `TODO.md` — check off spawn and tool output items with notes

**Acceptance criteria**:
- Spawn verified working end-to-end OR bugs identified and fixed with tests
- Tool output differences documented with screenshots or descriptions
- Any CSS adjustments don't break existing styling or tests
- `npm test && npm run build && npm run lint` all pass
