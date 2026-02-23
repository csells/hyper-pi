# Pi-DE browser rendering tests with surf

Use the `surf` CLI tool to verify that Pi-DE actually renders the expected UI: agents appear in the roster, clicking an agent shows the chat stage, sending a message works.

**Files to create/modify:**
- `integration-tests/src/browser-rendering.test.ts` (new — ~200 lines)

**Prerequisites (started in beforeAll):**
- Hypivisor running (via `startHypivisor()`)
- At least one pi agent registered (via `startPiAgent()`)
- Pi-DE Vite dev server running (via tmux: `tmux new-session -d -s pide "cd pi-de && npm run dev -- --port 5180"`)
- Wait for all services to be ready before tests run

**Tests (6-8 tests):**
1. **Pi-DE loads:** `surf tab.new http://localhost:5180` → screenshot → verify no console errors
2. **Roster shows agents:** screenshot → verify agent cards are visible (text content includes expected cwd/project name)
3. **Agent card click shows chat stage:** `surf click` on an active agent node → screenshot → verify chat stage header shows agent cwd
4. **Empty stage message:** With no agent selected, verify "Select an agent to begin" text is visible
5. **Send message from Pi-DE:** Click the chat input, type a message, submit → verify message appears in the chat
6. **Offline agent styling:** Register an agent, disconnect it, verify the roster shows gray dot / disabled styling via screenshot
7. **Spawn modal opens:** Click "Spawn Agent" button → screenshot → verify modal with file browser is visible
8. **Console error check:** After all interactions, `surf console --level error` → verify no JS errors

**surf approach (per AGENTS.md):**
- `surf tab.new http://localhost:5180` → save tab ID
- ALL subsequent commands use `--tab-id {ID}`
- `surf --tab-id {ID} screenshot` to capture state
- `surf --tab-id {ID} console --level error` to check for errors
- `surf --tab-id {ID} tab.close` in afterAll

**Acceptance criteria:**
- Tests pass with `cd integration-tests && npm test -- --testPathPattern browser-rendering`
- All tests use `--tab-id` (never bare surf commands)
- Tab closed in afterAll, tmux sessions killed
- No JS console errors in final check
