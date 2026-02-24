# Planning Progress

## Notes
<!-- User notes here are read by the planner on every run.
     Add steering like "ignore auth" or "prioritize performance". -->


---
[2026-02-23T14:07:42.902Z] Re-plan: Implement ALL waves (1-5) from the synthesis in parallel. Each task should be independently executable. Group by file to avoid conflicts. Key files: pi-de/src/useHypivisor.ts, pi-de/src/useAgent.ts, pi-de/src/RemoteAgent.ts, pi-de/src/rpc.ts, pi-de/src/SpawnModal.tsx, pi-socket/src/history.ts, pi-socket/src/safety.ts, hypivisor/src/main.rs, hypivisor/src/state.rs, hypivisor/src/auth.rs. Each task MUST include tests. The multi-agent-per-directory constraint is sacred: NEVER deduplicate by cwd. Read AGENTS.md before implementing anything.

## Run: 2026-02-23T14:07:42.902Z — specs/review-full-synthesis.md

### Pass 1 (14:11)
---

**Parallelism summary:** The 8 tasks form 3 independent work streams that can execute concurrently:

- **Stream A (Pi-DE frontend):** Task 1 + Task 2 + Task 4 → Task 3 → (done)
- **Stream B (Hypivisor Rust):** Task 5 + Task 6 → Task 8
- **Stream C (pi-socket TypeScript):** Task 7

Wave 1 (all independent): Tasks 1, 2, 4, 5, 6, 7
Wave 2 (after deps): Task 3 (needs Task 2), Task 8 (needs Tasks 5+6)

Critical path length: **2 waves** — nearly all work happens in wave 1.

---
## Run: 2026-02-23T14:48:01.773Z — Increase test coverage to 80% across hyper-pi with a focu...

### Pass 1 (14:52)
Now I have a thorough understanding of the codebase. Let me compile the task breakdown:

## 1. PRD Understanding Summary

The request aims to increase test coverage across the hyper-pi project from the current ~115 tests to ~80% line coverage. The project has 4 components: **pi-socket** (TypeScript extension), **hypivisor** (Rust registry daemon), **Pi-DE** (React web dashboard), and **integration-tests** (cross-component). The 6 areas of focus are:

1. **Live pi agent lifecycle tests** — Real `pi` CLI agents in temp dirs registering/deregistering with hypivisor
2. **Message round-trip tests** — Web→pi-socket→Web via hypivisor proxy
3. **Pi-DE browser rendering tests** — `surf` CLI to verify UI renders correctly
4. **TUI interaction tests** — tmux+sendkeys to drive pi's terminal, verify WebSocket output
5. **Cross-channel message visibility** — Web↔TUI event correlation
6. **Component unit test gaps** — SpawnModal, initStorage, patchLit (pi-de), index.ts (pi-socket), spawn.rs, fs_browser.rs (hypivisor)

Key constraints: pi is never modified, multiple agents per directory is sacred, tmux for long-lived processes, surf for browser testing, deterministic CI-safe tests.

## 2. Relevant Code/Docs/Resources Reviewed

| File | Purpose |
|------|---------|
| `AGENTS.md` | Project architecture, connection model, error handling, constraints |
| `specs/requirements.md` | 60+ requirements across all components |
| `specs/design.md` | Full architecture, protocols, reference implementations |
| `integration-tests/src/helpers.ts` | `startHypivisor()`, `BufferedWs`, `connectWs()` test helpers |
| `integration-tests/src/smoke.test.ts` | 8 tests: register/deregister, late join, auth, fanout, ping |
| `integration-tests/src/e2e-live.test.ts` | 6 tests: live hypivisor, proxy init_state, Pi-DE server check |
| `integration-tests/src/proxy-relay.test.ts` | 3 tests: dashboard↔agent proxy relay with mock WS server |
| `integration-tests/src/multi-agent.test.ts` | 4 tests: same-cwd coexistence, machine:port eviction |
| `integration-tests/src/reconnect.test.ts` | 7 tests: hypivisor restart, rapid register/deregister, proxy errors |
| `pi-de/src/RemoteAgent.test.ts` | 15 tests: init_state, event forwarding, prompt, subscribe, listener cleanup |
| `pi-de/src/rpc.test.ts` | 6 tests: rpcCall, handleRpcResponse, rejectAllPending |
| `pi-de/src/useAgent.test.ts` | 6 tests: reconnect, proxy error, single handler, truncation, cleanup, offline |
| `pi-de/src/useHypivisor.test.ts` | 7 tests: pre-init drop, init, reconnect handler cleanup, dedup, offline/removed |
| `pi-socket/src/history.test.ts` | 12 tests: buildInitState with all message types, truncation, edge cases |
| `pi-socket/src/safety.test.ts` | 5 tests: sync/async error catching, argument passthrough |
| `pi-socket/src/index.ts` | Main extension: WS server, event forwarding, hypivisor registration |
| `pi-de/src/SpawnModal.tsx` | File browser + spawn modal (0 tests) |
| `pi-de/src/initStorage.ts` | MemoryBackend + initPiDeStorage (0 tests) |
| `pi-de/src/patchLit.ts` | Lit ReactiveElement patch (0 tests) |
| `hypivisor/src/spawn.rs` | spawn_agent function (0 Rust tests) |
| `hypivisor/src/fs_browser.rs` | list_directories (2 Rust tests) |
| `hypivisor/src/auth.rs` | Token auth + query extraction (7 Rust tests) |
| `hypivisor/src/rpc.rs` | RPC dispatch + handlers (11 Rust tests) |
| `hypivisor/src/cleanup.rs` | Stale node cleanup (6 Rust tests) |
| `hypivisor/src/main.rs` | Server, proxy, WS handler (0 unit tests — tested via integration) |

**Current test counts:** pi-de: 34, pi-socket: 17, hypivisor: 26, integration: 28 = **105 total tests**

## 3. Sequential Implementation Steps

1. **Fill pi-socket unit test gaps** — index.ts has zero unit tests. Test the extension's broadcast, safeSerialize, connection lifecycle, message injection (idle vs follow-up), and shutdown paths using mocks for `ExtensionAPI`, `WebSocketServer`, and `WebSocket`.

2. **Fill Pi-DE unit test gaps** — SpawnModal (navigation, spawn success/error, loading state), initStorage (MemoryBackend operations, dummy API keys), patchLit (class-field-shadowing patch).

3. **Fill hypivisor Rust unit test gaps** — spawn.rs (path validation, new_folder creation, home-dir boundary), fs_browser.rs (symlinks, permission errors, empty dirs, deeper edge cases).

4. **Add integration tests for live pi agent lifecycle** — Spawn real `pi` instances in tmux in temp dirs, verify hypivisor registration via WS, verify multi-agent-per-directory, verify clean shutdown/deregistration.

5. **Add message round-trip integration tests** — Send message through proxy, verify pi-socket receives it, verify response events flow back through proxy to dashboard WS client.

6. **Add TUI interaction tests** — Use tmux sendkeys to type into a real pi agent, verify that the message and response events appear on connected WebSocket clients.

7. **Add cross-channel message visibility tests** — Send from web via proxy, verify TUI output; send from TUI via sendkeys, verify web WS events.

8. **Add Pi-DE browser rendering tests** — Use `surf` to launch Pi-DE, verify roster renders agents, verify clicking an agent shows chat stage, verify sending a message.

## 4. Parallelized Task Graph

The tasks form 3 independent work streams with a final integration layer:

- **Stream A (unit tests):** Tasks 1, 2, 3 — all independent, pure unit tests in separate components
- **Stream B (integration scaffolding):** Task 4 (live agent lifecycle) → Task 5 (message round-trip) → Task 6 (cross-channel + TUI)
- **Stream C (browser tests):** Task 7 depends on Tasks 4 + 5 (needs working live infrastructure)

**Wave 1:** Tasks 1, 2, 3, 4 (all independent)
**Wave 2:** Task 5 (needs Task 4's tmux/pi helpers), Task 7 (needs Task 4)
**Wave 3:** Task 6 (needs Tasks 4 + 5)

---

## Gap Analysis

### Missing Requirements
- No tests for pi-socket's `index.ts` main extension module (broadcast logic, safeSerialize, idle/follow-up message injection, shutdown deregister, reconnect backoff)
- No tests for SpawnModal component (directory navigation, spawn RPC, error display, loading states)
- No tests for initStorage's MemoryBackend (get/set/delete/keys/clear/has/transaction/quota methods, dummy key seeding)
- No tests for patchLit (Lit property shadowing fix)
- No tests for hypivisor spawn.rs (home boundary enforcement, new_folder creation, missing path errors)
- Integration tests use mock WebSocket servers, not real pi agents — no validation of actual pi-socket behavior
- No browser-level rendering tests — HTML/CSS rendering could break without detection
- No TUI↔Web cross-channel verification

### Edge Cases
- Live pi agent test: agent process may fail to start (pi not installed, port conflict)
- Live pi agent test: registration may be delayed (startup time variance → need polling with timeout)
- Cross-channel: message ordering between TUI and web clients under concurrent sends
- Browser tests: Vite dev server startup race, custom element registration timing
- Multiple agents in same temp dir must both register (test the sacred constraint)
- safeSerialize: non-serializable event objects (BigInt, circular refs, functions)

### Security Considerations
- spawn.rs tests must verify path traversal rejection (paths outside $HOME)
- fs_browser symlink-escape tests (symlink pointing outside home)
- Auth token tests already exist but integration tests with real agents should verify token propagation

### Testing Requirements
- **Unit tests**: vitest (TypeScript), cargo test (Rust) — deterministic, no external deps
- **Integration tests**: vitest with real hypivisor binary, WebSocket clients
- **E2E tests**: tmux for pi processes, surf for browser verification
- **All tests must be CI-safe**: no manual setup, temp dirs cleaned up, processes killed in afterEach

## Tasks

### Task 1: Pi-socket index.ts unit tests

Add comprehensive unit tests for `pi-socket/src/index.ts` — the main extension module that currently has zero tests. Create `pi-socket/src/index.test.ts`.

**Files to create/modify:**
- `pi-socket/src/index.test.ts` (new — ~200 lines)

**What to test:**
1. **broadcast()** — sends JSON to all OPEN clients, skips CLOSING/CLOSED clients
2. **safeSerialize()** — handles BigInt, circular refs, functions, falls back to error JSON
3. **session_start handler** — finds port via portfinder, creates WSS, calls connectToHypivisor
4. **ws.on("message") handler** — calls `pi.sendUserMessage(text)` when idle, `pi.sendUserMessage(text, { deliverAs: "followUp" })` when busy
5. **init_state on client connect** — calls buildInitState and sends JSON to new client
6. **Event forwarding** — message_start, message_update, message_end, tool_execution_start/update/end all call broadcast()
7. **session_shutdown** — sends deregister RPC, closes WSS, closes hypivisor WS
8. **Reconnect logic** — exponential backoff (reconnectMs → double → capped at 5min), resets on success
9. **Hypivisor URL validation** — invalid URL sets hypivisorUrlValid=false, stops reconnects
10. **shutdownRequested flag** — prevents reconnect after shutdown

**Mock approach:** Create mock `ExtensionAPI` with `on()`, `sendUserMessage()`, `getAllTools()`, mock `ctx` with `sessionManager`, `isIdle()`, `ui.notify()`. Use vitest's `vi.mock()` for `ws` and `portfinder` modules. Export internal functions or test through the public extension function.

**Acceptance criteria:**
- All 10 areas tested with positive and negative cases (~15-20 tests)
- Tests pass with `cd pi-socket && npm test`
- No changes to production code (or minimal refactoring to enable testability without changing behavior)

Dependencies: none

### Task 2: Pi-DE component unit test gaps (SpawnModal, initStorage, patchLit)

Add unit tests for the 3 untested Pi-DE modules. Create test files alongside each source file.

**Files to create/modify:**
- `pi-de/src/SpawnModal.test.tsx` (new — ~150 lines)
- `pi-de/src/initStorage.test.ts` (new — ~100 lines)
- `pi-de/src/patchLit.test.ts` (new — ~60 lines)

**SpawnModal tests (8-10 tests):**
1. Renders modal with title, file browser, controls
2. Calls `rpcCall("list_directories", {})` on mount (empty path = $HOME default)
3. Double-clicking a directory navigates into it (updates path, reloads dirs)
4. "Up" button navigates to parent directory
5. Successful spawn: calls `rpcCall("spawn_agent", { path, new_folder })`, calls `onClose()`
6. Failed spawn: shows error message, modal stays open, deploy button re-enables
7. Loading state: deploy button shows "Deploying…" and is disabled during RPC
8. Overlay click calls `onClose()`
9. Empty directory list shows "No subdirectories"
10. New folder input updates state

**initStorage tests (5-6 tests):**
1. `initPiDeStorage()` creates AppStorage and sets it via `setAppStorage()`
2. MemoryBackend get/set/delete/keys/has/clear work correctly
3. MemoryBackend transaction() executes operation
4. Dummy API keys pre-populated for all providers (anthropic, openai, google, etc.)
5. getQuotaInfo returns expected values
6. requestPersistence returns true

**patchLit tests (3-4 tests):**
1. When no `agent-interface` element registered, patch is a no-op (no errors)
2. When Lit element exists with class-field-shadowed properties, patch removes own properties and restores via accessor
3. Calling patched performUpdate doesn't throw

**Mock approach:** Use vitest + jsdom + @testing-library/react for SpawnModal. Mock `rpcCall` via vi.mock('./rpc'). For patchLit, mock customElements.get() to return a test Lit element class. For initStorage, import directly and test the MemoryBackend class.

**Acceptance criteria:**
- ~18-20 new tests across 3 files
- Tests pass with `cd pi-de && npx vitest run`
- 100% line coverage on initStorage.ts, >80% on SpawnModal.tsx

Dependencies: none

### Task 3: Hypivisor Rust unit test gaps (spawn.rs, fs_browser.rs)

Add unit tests for `spawn.rs` and expand `fs_browser.rs` tests. These modules have business-critical path validation logic with 0 and 2 tests respectively.

**Files to modify:**
- `hypivisor/src/spawn.rs` — add `#[cfg(test)] mod tests` (~80 lines)
- `hypivisor/src/fs_browser.rs` — extend existing `mod tests` (~60 lines)

**spawn.rs tests (6-8 tests):**
1. `spawn_agent` rejects path outside home directory → returns Err
2. `spawn_agent` rejects non-existent path when no new_folder → returns Err("Path does not exist")
3. `spawn_agent` creates new_folder subdirectory when specified
4. `spawn_agent` with new_folder trims whitespace
5. `spawn_agent` with empty new_folder and existing path proceeds (uses path directly)
6. `spawn_agent` returns canonicalized path on success
7. Path traversal with `..` is caught by canonicalize + starts_with check

**Note:** The actual `Command::new("pi").spawn()` call will fail in CI since `pi` may not be installed. Tests should focus on the validation logic. Consider extracting the spawn call into a testable seam, or accept that tests cover the validation but not the actual spawn. Use temp directories within $HOME for tests.

**fs_browser.rs additional tests (4-5 tests):**
1. Empty directory returns empty vec
2. Directory with only hidden entries returns empty vec
3. Files (not directories) are excluded
4. Non-existent path returns error
5. Deeply nested directory works correctly

**Acceptance criteria:**
- ~12 new Rust tests
- Tests pass with `cd hypivisor && cargo test`
- All path validation edge cases covered

Dependencies: none

### Task 4: Live pi agent lifecycle integration tests

Create integration tests that spawn REAL pi agents using the pi CLI, verify they register with hypivisor, appear in the roster, and cleanly deregister on shutdown. This establishes the infrastructure (tmux helpers, pi process management) needed by subsequent integration tasks.

**Files to create/modify:**
- `integration-tests/src/pi-agent-helpers.ts` (new — ~120 lines) — Helper functions: `startPiAgent(cwd)` → spawns pi in tmux, waits for registration; `stopPiAgent(sessionName)` → sends SIGTERM/quit; `waitForNode(port, nodeId)` → polls until node appears in roster
- `integration-tests/src/lifecycle.test.ts` (new — ~180 lines)

**Exported helpers (pi-agent-helpers.ts):**
- `startPiAgent(opts: { cwd: string, hypivisorPort: number, env?: Record<string,string> }): Promise<{ sessionName: string, nodeId: string, port: number }>` — Creates tmux session, starts `pi` with `HYPIVISOR_WS` set, polls hypivisor until registration appears
- `stopPiAgent(sessionName: string): Promise<void>` — Sends `tmux send-keys ... '/quit'` then `tmux kill-session`
- `waitForNode(hypivisorPort: number, predicate: (node) => boolean, timeoutMs?: number): Promise<NodeInfo>` — Connects to hypivisor, waits for matching node in init/node_joined events

**Tests (6-8 tests):**
1. Single agent: start pi in temp dir → appears in hypivisor roster within 15s → status is "active"
2. Agent shutdown: start pi, then stop it → hypivisor emits node_offline within 10s
3. Agent deregistration: start pi, quit cleanly → node is eventually removed (deregister RPC)
4. **Multi-agent same directory (SACRED):** start 2 pi agents in same temp dir → BOTH appear in roster with different ports, different IDs, same cwd
5. Agent re-registration: start pi, kill hypivisor, restart hypivisor → agent re-registers within reconnectMs
6. Agent metadata: registered node has correct machine (hostname), cwd, valid port

**Infrastructure:**
- Use `mkdtemp` for temp directories, clean up in afterAll
- Start hypivisor via existing `startHypivisor()` helper
- Use tmux (per project AGENTS.md) for pi processes: `tmux new-session -d -s {name} "HYPIVISOR_WS=ws://localhost:{port}/ws PI_SOCKET_PORT={port} pi"`
- Each test gets its own hypivisor instance (random port)
- Set generous timeouts (30s per test) since pi startup includes extension loading

**Acceptance criteria:**
- Tests pass with `cd integration-tests && npm test -- --testPathPattern lifecycle`
- All tests clean up tmux sessions and temp dirs
- Multi-agent-per-directory constraint validated

Dependencies: none

### Task 5: Message round-trip integration tests (Web → Agent → Web)

Test the full message flow: send a message to a pi agent through the hypivisor proxy WebSocket, verify the agent processes it, and verify response events flow back through the proxy.

**Files to create/modify:**
- `integration-tests/src/message-roundtrip.test.ts` (new — ~150 lines)

**Tests (5-7 tests):**
1. **Send text through proxy → agent receives it:** Connect to `/ws/agent/{nodeId}`, receive `init_state`, send plain text message, verify agent begins processing (message_start event flows back)
2. **Full turn round-trip:** Send a simple prompt ("echo hello"), verify `message_start` (user), `message_start` (assistant), streaming `message_update` deltas, `message_end` all flow back through proxy
3. **init_state contains conversation history:** After a round-trip, disconnect and reconnect to same agent → init_state messages array includes the previous exchange
4. **Multiple clients see same events:** Connect 2 proxy clients to same agent, send message from client A, verify client B also receives broadcast events
5. **Follow-up message while streaming:** Send a message, then immediately send another → second message delivered with `deliverAs: "followUp"` (verified by both appearing in conversation)
6. **Tools list in init_state:** init_state.tools array is non-empty and contains expected tools (bash, read, etc.)

**Infrastructure:**
- Reuse `pi-agent-helpers.ts` from Task 4 to start real pi agents in tmux
- Connect to agent through hypivisor proxy: `ws://localhost:{hvPort}/ws/agent/{nodeId}`
- Use `BufferedWs` from existing helpers for message queuing
- Use simple, fast prompts (e.g., "What is 2+2?" or just test that user message appears)

**Acceptance criteria:**
- Tests pass with `cd integration-tests && npm test -- --testPathPattern message-roundtrip`
- Tests are deterministic (no timing flakes — use polling with timeout, not fixed delays)
- Clean up all WebSocket connections and tmux sessions

Dependencies: Task 4 (uses `pi-agent-helpers.ts` — `startPiAgent`, `stopPiAgent`, `waitForNode`)

### Task 6: Cross-channel message visibility and TUI interaction tests

Test the cross-channel guarantee: messages sent from the web appear in TUI output, messages sent from TUI appear in web WebSocket events. Uses tmux sendkeys for TUI interaction.

**Files to create/modify:**
- `integration-tests/src/cross-channel.test.ts` (new — ~200 lines)

**Tests (5-7 tests):**
1. **Web → TUI visibility:** Send a message via proxy WebSocket, use `tmux capture-pane` to verify the message text appears in pi's TUI output
2. **TUI → Web visibility:** Use `tmux send-keys` to type a message in pi's TUI, verify `message_start` event with role "user" and matching content arrives on connected proxy WebSocket client
3. **TUI response → Web events:** Type a prompt in TUI via sendkeys, verify assistant response events (message_start, message_update, message_end) appear on WebSocket client
4. **Concurrent clients:** Web client + TUI both active, send from web → verify TUI shows it; send from TUI → verify web client gets event
5. **Follow-up from web while TUI-initiated turn is streaming:** TUI starts a prompt, web sends a follow-up during streaming → both messages eventually appear in conversation

**TUI interaction approach:**
- `tmux send-keys -t {session} "message text" Enter` to type into pi
- `tmux capture-pane -t {session} -p` to read TUI output
- Poll `capture-pane` output with timeout for expected text
- Use unique marker strings (e.g., `XTEST_abc123`) to avoid false matches

**Acceptance criteria:**
- Tests pass with `cd integration-tests && npm test -- --testPathPattern cross-channel`
- TUI interaction is reliable (polling, not fixed delays)
- All tmux sessions cleaned up

Dependencies: Task 4 (uses `pi-agent-helpers.ts`), Task 5 (uses message round-trip patterns)

### Task 7: Pi-DE browser rendering tests with surf

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
5. **Send message from Pi-DE:** Click the chat input, type a message, submit → verify message appears in the chat (screenshot shows user message bubble)
6. **Offline agent styling:** Register an agent, disconnect it, verify the roster shows gray dot / disabled styling via screenshot comparison
7. **Spawn modal opens:** Click "Spawn Agent" button → screenshot → verify modal with file browser is visible
8. **Console error check:** After all interactions, `surf console --level error` → verify no JS errors

**surf approach (per AGENTS.md):**
- `surf tab.new http://localhost:5180` → save tab ID
- ALL subsequent commands use `--tab-id {ID}`
- `surf --tab-id {ID} screenshot` to capture state
- `surf --tab-id {ID} console --level error` to check for errors
- `surf --tab-id {ID} click "selector"` for interactions
- `surf --tab-id {ID} tab.close` in afterAll

**Acceptance criteria:**
- Tests pass with `cd integration-tests && npm test -- --testPathPattern browser-rendering`
- All tests use `--tab-id` (never bare surf commands)
- Tab closed in afterAll, tmux sessions killed
- No JS console errors in final check

Dependencies: Task 4 (uses `pi-agent-helpers.ts` for starting agents)

---

```tasks-json
[
  {
    "title": "Pi-socket index.ts unit tests",
    "description": "Add comprehensive unit tests for `pi-socket/src/index.ts` — the main extension module that currently has zero tests. Create `pi-socket/src/index.test.ts`.\n\n**Files to create/modify:**\n- `pi-socket/src/index.test.ts` (new — ~200 lines)\n\n**What to test:**\n1. **broadcast()** — sends JSON to all OPEN clients, skips CLOSING/CLOSED clients\n2. **safeSerialize()** — handles BigInt, circular refs, functions, falls back to error JSON\n3. **session_start handler** — finds port via portfinder, creates WSS, calls connectToHypivisor\n4. **ws.on(\"message\") handler** — calls `pi.sendUserMessage(text)` when idle, `pi.sendUserMessage(text, { deliverAs: \"followUp\" })` when busy\n5. **init_state on client connect** — calls buildInitState and sends JSON to new client\n6. **Event forwarding** — message_start, message_update, message_end, tool_execution_start/update/end all call broadcast()\n7. **session_shutdown** — sends deregister RPC, closes WSS, closes hypivisor WS\n8. **Reconnect logic** — exponential backoff (reconnectMs → double → capped at 5min), resets on success\n9. **Hypivisor URL validation** — invalid URL sets hypivisorUrlValid=false, stops reconnects\n10. **shutdownRequested flag** — prevents reconnect after shutdown\n\n**Mock approach:** Create mock `ExtensionAPI` with `on()`, `sendUserMessage()`, `getAllTools()`, mock `ctx` with `sessionManager`, `isIdle()`, `ui.notify()`. Use vitest's `vi.mock()` for `ws` and `portfinder` modules. Export internal functions or test through the public extension function.\n\n**Acceptance criteria:**\n- All 10 areas tested with positive and negative cases (~15-20 tests)\n- Tests pass with `cd pi-socket && npm test`\n- No changes to production code (or minimal refactoring to enable testability without changing behavior)",
    "dependsOn": []
  },
  {
    "title": "Pi-DE component unit test gaps (SpawnModal, initStorage, patchLit)",
    "description": "Add unit tests for the 3 untested Pi-DE modules. Create test files alongside each source file.\n\n**Files to create/modify:**\n- `pi-de/src/SpawnModal.test.tsx` (new — ~150 lines)\n- `pi-de/src/initStorage.test.ts` (new — ~100 lines)\n- `pi-de/src/patchLit.test.ts` (new — ~60 lines)\n\n**SpawnModal tests (8-10 tests):**\n1. Renders modal with title, file browser, controls\n2. Calls `rpcCall(\"list_directories\", {})` on mount (empty path = $HOME default)\n3. Double-clicking a directory navigates into it (updates path, reloads dirs)\n4. \"Up\" button navigates to parent directory\n5. Successful spawn: calls `rpcCall(\"spawn_agent\", { path, new_folder })`, calls `onClose()`\n6. Failed spawn: shows error message, modal stays open, deploy button re-enables\n7. Loading state: deploy button shows \"Deploying…\" and is disabled during RPC\n8. Overlay click calls `onClose()`\n9. Empty directory list shows \"No subdirectories\"\n10. New folder input updates state\n\n**initStorage tests (5-6 tests):**\n1. `initPiDeStorage()` creates AppStorage and sets it via `setAppStorage()`\n2. MemoryBackend get/set/delete/keys/has/clear work correctly\n3. MemoryBackend transaction() executes operation\n4. Dummy API keys pre-populated for all providers (anthropic, openai, google, etc.)\n5. getQuotaInfo returns expected values\n6. requestPersistence returns true\n\n**patchLit tests (3-4 tests):**\n1. When no `agent-interface` element registered, patch is a no-op (no errors)\n2. When Lit element exists with class-field-shadowed properties, patch removes own properties and restores via accessor\n3. Calling patched performUpdate doesn't throw\n\n**Acceptance criteria:**\n- ~18-20 new tests across 3 files\n- Tests pass with `cd pi-de && npx vitest run`\n- 100% line coverage on initStorage.ts, >80% on SpawnModal.tsx",
    "dependsOn": []
  },
  {
    "title": "Hypivisor Rust unit test gaps (spawn.rs, fs_browser.rs)",
    "description": "Add unit tests for `spawn.rs` and expand `fs_browser.rs` tests. These modules have business-critical path validation logic with 0 and 2 tests respectively.\n\n**Files to modify:**\n- `hypivisor/src/spawn.rs` — add `#[cfg(test)] mod tests` (~80 lines)\n- `hypivisor/src/fs_browser.rs` — extend existing `mod tests` (~60 lines)\n\n**spawn.rs tests (6-8 tests):**\n1. `spawn_agent` rejects path outside home directory → returns Err\n2. `spawn_agent` rejects non-existent path when no new_folder → returns Err(\"Path does not exist\")\n3. `spawn_agent` creates new_folder subdirectory when specified\n4. `spawn_agent` with new_folder trims whitespace\n5. `spawn_agent` with empty new_folder and existing path proceeds (uses path directly)\n6. `spawn_agent` returns canonicalized path on success\n7. Path traversal with `..` is caught by canonicalize + starts_with check\n\n**Note:** The actual `Command::new(\"pi\").spawn()` call will fail in CI since `pi` may not be installed. Tests should focus on the validation logic up to the point of spawning. Use temp directories within $HOME for tests that need valid paths.\n\n**fs_browser.rs additional tests (4-5 tests):**\n1. Empty directory returns empty vec\n2. Directory with only hidden entries returns empty vec\n3. Files (not directories) are excluded\n4. Non-existent path returns error\n5. Deeply nested directory works correctly\n\n**Acceptance criteria:**\n- ~12 new Rust tests\n- Tests pass with `cd hypivisor && cargo test`\n- All path validation edge cases covered",
    "dependsOn": []
  },
  {
    "title": "Live pi agent lifecycle integration tests",
    "description": "Create integration tests that spawn REAL pi agents using the pi CLI, verify they register with hypivisor, appear in the roster, and cleanly deregister on shutdown. This establishes the infrastructure (tmux helpers, pi process management) needed by subsequent integration tasks.\n\n**Files to create/modify:**\n- `integration-tests/src/pi-agent-helpers.ts` (new — ~120 lines) — Helper functions for managing real pi agents in tmux\n- `integration-tests/src/lifecycle.test.ts` (new — ~180 lines)\n\n**Exported helpers (pi-agent-helpers.ts):**\n- `startPiAgent(opts: { cwd: string, hypivisorPort: number, env?: Record<string,string> }): Promise<{ sessionName: string, nodeId: string, port: number }>` — Creates tmux session, starts `pi` with `HYPIVISOR_WS` set, polls hypivisor until registration appears\n- `stopPiAgent(sessionName: string): Promise<void>` — Sends `/quit` via tmux send-keys then kills session\n- `waitForNode(hypivisorPort: number, predicate: (node: Record<string,unknown>) => boolean, timeoutMs?: number): Promise<Record<string,unknown>>` — Connects to hypivisor, waits for matching node in init or node_joined events\n\n**Tests (6-8 tests):**\n1. Single agent: start pi in temp dir → appears in hypivisor roster within 15s → status is \"active\"\n2. Agent shutdown: start pi, then stop it → hypivisor emits node_offline within 10s\n3. Agent deregistration: start pi, quit cleanly → node is eventually removed (deregister RPC)\n4. **Multi-agent same directory (SACRED):** start 2 pi agents in same temp dir → BOTH appear in roster with different ports, different IDs, same cwd\n5. Agent re-registration: start pi, kill hypivisor, restart hypivisor → agent re-registers within reconnectMs\n6. Agent metadata: registered node has correct machine (hostname), cwd, valid port\n\n**Infrastructure:**\n- Use `mkdtemp` for temp directories, clean up in afterAll\n- Start hypivisor via existing `startHypivisor()` helper\n- Use tmux for pi processes: `tmux new-session -d -s {name} \"HYPIVISOR_WS=ws://localhost:{port}/ws pi\"`\n- Set generous timeouts (30s per test) since pi startup includes extension loading\n\n**Acceptance criteria:**\n- Tests pass with `cd integration-tests && npm test -- --testPathPattern lifecycle`\n- All tests clean up tmux sessions and temp dirs\n- Multi-agent-per-directory constraint validated",
    "dependsOn": []
  },
  {
    "title": "Message round-trip integration tests (Web → Agent → Web)",
    "description": "Test the full message flow: send a message to a pi agent through the hypivisor proxy WebSocket, verify the agent processes it, and verify response events flow back through the proxy.\n\n**Files to create/modify:**\n- `integration-tests/src/message-roundtrip.test.ts` (new — ~150 lines)\n\n**Tests (5-7 tests):**\n1. **Send text through proxy → agent receives it:** Connect to `/ws/agent/{nodeId}`, receive `init_state`, send plain text message, verify agent begins processing (message_start event flows back)\n2. **Full turn round-trip:** Send a simple prompt (\"What is 2+2?\"), verify message_start (user), message_start (assistant), streaming message_update deltas, message_end all flow back through proxy\n3. **init_state contains conversation history:** After a round-trip, disconnect and reconnect to same agent → init_state messages array includes the previous exchange\n4. **Multiple clients see same events:** Connect 2 proxy clients to same agent, send message from client A, verify client B also receives broadcast events\n5. **Follow-up message while streaming:** Send a message, then immediately send another → second message delivered as followUp (verified by both appearing in conversation)\n6. **Tools list in init_state:** init_state.tools array is non-empty and contains expected tools (bash, read, etc.)\n\n**Infrastructure:**\n- Reuse `pi-agent-helpers.ts` from Task 4 to start real pi agents in tmux\n- Connect to agent through hypivisor proxy: `ws://localhost:{hvPort}/ws/agent/{nodeId}`\n- Use `BufferedWs` from existing helpers for message queuing\n\n**Acceptance criteria:**\n- Tests pass with `cd integration-tests && npm test -- --testPathPattern message-roundtrip`\n- Tests are deterministic (polling with timeout, not fixed delays)\n- Clean up all WebSocket connections and tmux sessions",
    "dependsOn": ["Live pi agent lifecycle integration tests"]
  },
  {
    "title": "Cross-channel message visibility and TUI interaction tests",
    "description": "Test the cross-channel guarantee: messages sent from the web appear in TUI output, messages sent from TUI appear in web WebSocket events. Uses tmux sendkeys for TUI interaction.\n\n**Files to create/modify:**\n- `integration-tests/src/cross-channel.test.ts` (new — ~200 lines)\n\n**Tests (5-7 tests):**\n1. **Web → TUI visibility:** Send a message via proxy WebSocket, use `tmux capture-pane` to verify the message text appears in pi's TUI output\n2. **TUI → Web visibility:** Use `tmux send-keys` to type a message in pi's TUI, verify `message_start` event with role \"user\" and matching content arrives on connected proxy WebSocket client\n3. **TUI response → Web events:** Type a prompt in TUI via sendkeys, verify assistant response events (message_start, message_update, message_end) appear on WebSocket client\n4. **Concurrent clients:** Web client + TUI both active, send from web → verify TUI shows it; send from TUI → verify web client gets event\n5. **Follow-up from web while TUI-initiated turn is streaming:** TUI starts a prompt, web sends a follow-up during streaming → both messages eventually appear in conversation\n\n**TUI interaction approach:**\n- `tmux send-keys -t {session} \"message text\" Enter` to type into pi\n- `tmux capture-pane -t {session} -p` to read TUI output\n- Poll `capture-pane` output with timeout for expected text\n- Use unique marker strings (e.g., `XTEST_abc123`) to avoid false matches\n\n**Acceptance criteria:**\n- Tests pass with `cd integration-tests && npm test -- --testPathPattern cross-channel`\n- TUI interaction is reliable (polling, not fixed delays)\n- All tmux sessions cleaned up",
    "dependsOn": ["Live pi agent lifecycle integration tests", "Message round-trip integration tests (Web → Agent → Web)"]
  },
  {
    "title": "Pi-DE browser rendering tests with surf",
    "description": "Use the `surf` CLI tool to verify that Pi-DE actually renders the expected UI: agents appear in the roster, clicking an agent shows the chat stage, sending a message works.\n\n**Files to create/modify:**\n- `integration-tests/src/browser-rendering.test.ts` (new — ~200 lines)\n\n**Prerequisites (started in beforeAll):**\n- Hypivisor running (via `startHypivisor()`)\n- At least one pi agent registered (via `startPiAgent()`)\n- Pi-DE Vite dev server running (via tmux: `tmux new-session -d -s pide \"cd pi-de && npm run dev -- --port 5180\"`)\n- Wait for all services to be ready before tests run\n\n**Tests (6-8 tests):**\n1. **Pi-DE loads:** `surf tab.new http://localhost:5180` → screenshot → verify no console errors\n2. **Roster shows agents:** screenshot → verify agent cards are visible (text content includes expected cwd/project name)\n3. **Agent card click shows chat stage:** `surf click` on an active agent node → screenshot → verify chat stage header shows agent cwd\n4. **Empty stage message:** With no agent selected, verify \"Select an agent to begin\" text is visible\n5. **Send message from Pi-DE:** Click the chat input, type a message, submit → verify message appears in the chat\n6. **Offline agent styling:** Register an agent, disconnect it, verify the roster shows gray dot / disabled styling via screenshot\n7. **Spawn modal opens:** Click \"Spawn Agent\" button → screenshot → verify modal with file browser is visible\n8. **Console error check:** After all interactions, `surf console --level error` → verify no JS errors\n\n**surf approach (per AGENTS.md):**\n- `surf tab.new http://localhost:5180` → save tab ID\n- ALL subsequent commands use `--tab-id {ID}`\n- `surf --tab-id {ID} screenshot` to capture state\n- `surf --tab-id {ID} console --level error` to check for errors\n- `surf --tab-id {ID} tab.close` in afterAll\n\n**Acceptance criteria:**\n- Tests pass with `cd integration-tests && npm test -- --testPathPattern browser-rendering`\n- All tests use `--tab-id` (never bare surf commands)\n- Tab closed in afterAll, tmux sessions killed\n- No JS console errors in final check",
    "dependsOn": ["Live pi agent lifecycle integration tests"]
  }
]
```

---
## Run: 2026-02-24T00:53:50.907Z — ## Mobile Features Plan for Pi-DE

Implement the mobile f...

---
## Run: 2026-02-24T01:05:26.134Z — ## Mobile Features Plan for Pi-DE

Implement the mobile f...

### Pass 1 (01:11)
Now I have a thorough understanding of the codebase. Let me produce the task breakdown.

## 1. PRD Understanding Summary

The request implements 4 mobile features for Pi-DE from TODO.md:

1. **Responsive mobile layout** — On viewports <768px, show roster as full-screen, clicking an agent shows full-screen chat with a back button. The CSS media queries already exist in `App.css` (lines 575-600) with `.agent-selected` class rules, but `App.tsx` never applies that class.

2. **Mobile VKB behavior** — On mobile virtual keyboards, Enter should insert a newline (not submit). A visible Send button handles submission. The `<agent-interface>` web component uses light DOM (`createRenderRoot() { return this }`), so the textarea is directly accessible for event interception. The `MessageEditor` component's `handleKeyDown` does `Enter && !shiftKey → handleSend()`.

3. **Lazy message loading / infinite scroll** — Load recent N messages on connect, fetch older on scroll-to-top. Requires a new `fetch_history` request/response protocol in pi-socket, new types in `hyper-pi-protocol`, and Pi-DE scroll detection + message prepending in `RemoteAgent`.

4. **Cloudflare tunnel setup** — Infrastructure docs only, no app code changes.

## 2. Relevant Code/Docs/Resources Reviewed

| File | Purpose | Key Findings |
|------|---------|-------------|
| `pi-de/src/App.tsx` | Root layout component | 2-column grid, `activeNode` state, `agentInterfaceRef`, never applies `agent-selected` class |
| `pi-de/src/App.css` | All styles | Lines 575-600 have mobile media queries for `.agent-selected` toggling roster/chat, but class is never applied |
| `pi-de/src/RemoteAgent.ts` | WebSocket adapter | Duck-types Agent interface, handles `init_state` and all `AgentEvent` types, no pagination support |
| `pi-de/src/useAgent.ts` | Agent connection hook | Creates `RemoteAgent`, manages WS lifecycle, handles `historyTruncated` state |
| `pi-de/src/types.ts` | Re-exports from hyper-pi-protocol | Clean re-export layer |
| `pi-de/src/rpc.ts` | JSON-RPC helper | `rpcCall()` with timeout, used for hypivisor registry calls only (not agent calls) |
| `hyper-pi-protocol/src/index.ts` | Shared wire types | `InitStateEvent`, `SocketEvent`, `NodeInfo`, etc. — no pagination types exist |
| `pi-socket/src/index.ts` | Extension entry | `ws.on("message")` treats ALL incoming messages as plain text prompts — no JSON request parsing |
| `pi-socket/src/history.ts` | `buildInitState()` | Extracts messages from `ctx.sessionManager.getBranch()`, truncates at 500KB, sets `truncated: true` |
| `pi-web-ui MessageEditor.js` | Keyboard handling | `handleKeyDown`: `Enter && !shiftKey → handleSend()`. Light DOM (`createRenderRoot → this`). Has visible Send button |
| `pi-web-ui AgentInterface.js` | Scroll handling | `_scrollContainer = this.querySelector(".overflow-y-auto")`, `_handleScroll` tracks scroll position. Light DOM |
| `hypivisor/src/lib.rs` | Proxy relay | Bidirectional text relay — JSON messages pass through transparently |
| `specs/requirements.md` | R-UI-3 | Mobile single-pane layout requirement defined |
| `pi-de/*.test.*` | Existing tests | Pattern: mock WebSocket, render hooks, test events |
| `pi-socket/src/history.test.ts` | History tests | 12 tests for buildInitState — good pattern for pagination tests |

## 3. Sequential Implementation Steps

1. **Add responsive mobile layout to Pi-DE** — Toggle `agent-selected` class on `.pi-de-layout` via React state when `activeNode` is set, add a back button in the stage-header, verify the existing CSS media queries activate correctly. Add tests.

2. **Add mobile VKB keyboard behavior** — Create a `patchMobileKeyboard.ts` module that detects mobile viewport and intercepts Enter key on the `<agent-interface>` textarea to insert newlines instead of sending. The visible Send button in MessageEditor already handles submission. Wire it up via the `agentInterfaceRef` in App.tsx. Add tests.

3. **Add `fetch_history` protocol types and pi-socket server handler** — Define `FetchHistoryRequest` and `HistoryPageResponse` in `hyper-pi-protocol`. Modify pi-socket's `ws.on("message")` to detect JSON `fetch_history` requests vs. plain text prompts. Add `getHistoryPage()` to `history.ts` that slices the session branch. Add tests.

4. **Add Pi-DE infinite scroll client** — Add `fetchHistory(before, limit)` to `RemoteAgent`, handle `history_page` responses, detect scroll-to-top on the agent-interface's `.overflow-y-auto` container to trigger loading, prepend older messages to state. Add tests.

5. **Document Cloudflare tunnel setup** — Create docs with `cloudflared tunnel` configuration for accessing the hypivisor and Pi-DE from mobile devices on different networks.

## 4. Parallelized Task Graph

**Parallelism summary:** 5 tasks form 2 independent streams:

- **Stream A (Mobile UI):** Task 1 + Task 2 (independent, separate files)
- **Stream B (Pagination):** Task 3 → Task 4 (protocol/server before client)
- **Stream C (Docs):** Task 5 (independent)

Wave 1 (all independent): Tasks 1, 2, 3, 5
Wave 2 (after deps): Task 4 (needs Task 3)

Critical path length: **2 waves** — most work happens in wave 1.

---

## Gap Analysis

### Missing Requirements
- pi-socket currently treats ALL incoming WebSocket messages as plain text prompts — no structured JSON request parsing exists. `fetch_history` requires adding a JSON request router alongside the existing text path.
- No mechanism to identify message indices or timestamps for pagination cursors. `getBranch()` returns an ordered array — index-based slicing is the simplest approach.
- The `<agent-interface>` component's scroll container (`.overflow-y-auto`) doesn't expose a scroll-to-top event — Pi-DE must attach its own scroll listener.

### Edge Cases
- **Concurrent `fetch_history` + live events:** A `history_page` response arriving while new messages are streaming must not corrupt message ordering. Prepending must be insertion-safe.
- **Empty history page:** Agent with fewer messages than the page size should return `hasMore: false` on the first (and only) fetch.
- **JSON vs text disambiguation:** A user could type valid JSON as a prompt. The `fetch_history` handler must only match `{ type: "fetch_history", ... }` and fall through to `sendUserMessage` for everything else.
- **Back button on mobile during agent streaming:** Returning to roster while the agent is streaming should not cause errors — the existing `useAgent` cleanup handles this.
- **VKB detection reliability:** Some tablets in landscape mode are >768px but still have VKBs. Use `"ontouchstart" in window` OR `matchMedia("(pointer: coarse)")` as secondary signals.
- **Race between `init_state` and `fetch_history`:** If the user scrolls up before `init_state` arrives, the fetch must be deferred until after init.

### Security Considerations
- The `fetch_history` endpoint runs over the same authenticated WebSocket — no additional auth needed.
- The Cloudflare tunnel doc must emphasize that the tunnel provides transport security but `HYPI_TOKEN` is still required for application-level auth.

### Testing Requirements
- **Unit tests (vitest):** Mobile layout class toggling, back button navigation, VKB keyboard interception, `getHistoryPage()` slicing/pagination, `RemoteAgent.fetchHistory()`, history response handling
- **DOM tests:** Verify `agent-selected` class presence/absence, textarea keydown behavior on mobile, scroll event trigger detection
- **Integration pattern:** Existing `RemoteAgent.test.ts` mock WebSocket pattern reusable for pagination tests

---

## Tasks

### Task 1: Responsive mobile layout with roster-to-chat navigation

Implement the mobile-first responsive layout where the roster and chat view are full-screen pages that toggle on agent selection, satisfying R-UI-3.

**Files to modify:**
- `pi-de/src/App.tsx` — Add `agent-selected` class to `.pi-de-layout` when `activeNode` is non-null. Add a back button `<button>` inside `.stage-header` that calls `setActiveNode(null)`. The back button should only render on mobile (via CSS or a `useMediaQuery`-style check).
- `pi-de/src/App.css` — Style the `.back-button` in the stage-header (touch-friendly 44px, left-aligned). Verify/fix the existing media query rules at lines 575-600. Add `display: none` for `.back-button` on desktop viewports.

**Implementation details:**
- The className on the layout div changes from `"pi-de-layout"` to `\`pi-de-layout \${activeNode ? "agent-selected" : ""}\`` 
- The existing CSS rules (`.pi-de-layout.agent-selected .roster-pane { display: none }` and `.pi-de-layout.agent-selected .main-stage { display: flex }`) already handle the visibility toggling
- The back button goes inside `.stage-header` before the `<h3>`: `<button className="back-button" onClick={() => setActiveNode(null)}>← Back</button>`
- On desktop (>767px), `.back-button { display: none }` — the sidebar is always visible

**Acceptance criteria:**
- On viewports <768px, only roster is visible when no agent is selected
- Clicking an agent card shows full-screen chat, roster is hidden
- Back button in chat header returns to roster (clears `activeNode`)
- Back button is hidden on desktop viewports
- All existing desktop tests pass unchanged
- New tests: verify `agent-selected` class toggling, back button click clears selection
- Tests pass with `cd pi-de && npm test`

Dependencies: none

### Task 2: Mobile virtual keyboard Enter-key behavior

On mobile devices, make Enter in the virtual keyboard insert a newline in the prompt textarea instead of submitting. The existing visible Send button in `MessageEditor` handles submission.

**Files to create/modify:**
- `pi-de/src/patchMobileKeyboard.ts` (new, ~60 lines) — Module that sets up mobile keyboard interception on the `<agent-interface>` element's textarea
- `pi-de/src/patchMobileKeyboard.test.ts` (new, ~100 lines) — Tests
- `pi-de/src/App.tsx` — Import `patchMobileKeyboard` and call it in the `useEffect` that wires the `agentInterfaceRef`

**Implementation details:**
- Mobile detection: `window.matchMedia("(pointer: coarse)").matches` as primary signal (targets touch devices). Falls back to `"ontouchstart" in window`. Export `isMobileDevice()` for testability.
- `patchMobileKeyboard(el: HTMLElement)` function:
  1. Uses `MutationObserver` or `requestAnimationFrame` loop to find the `textarea` element inside the `<agent-interface>` (it renders in light DOM)
  2. Adds a capturing `keydown` listener on the textarea
  3. If `isMobileDevice()` and `e.key === "Enter"` and `!e.shiftKey`: call `e.stopImmediatePropagation()` to prevent MessageEditor's `handleKeyDown` from firing. The default textarea behavior (insert newline) proceeds.
  4. Returns a cleanup function that removes the listener and disconnects the observer
- In `App.tsx`'s `useEffect`, after setting `ai.session = agent.remoteAgent`:
  ```typescript
  const cleanup = patchMobileKeyboard(el);
  return () => { cleanup(); };
  ```
- The Send button in `MessageEditor` (line 345 `onClick: this.handleSend`) already works — it calls `onSend` with the textarea value. No changes needed to the web component.

**Why `stopImmediatePropagation` works:** Both our capturing listener and MessageEditor's `@keydown` handler are on the same element (the textarea, in light DOM). Our listener registered via `addEventListener("keydown", fn, { capture: true })` fires before Lit's event binding. Calling `stopImmediatePropagation()` prevents MessageEditor's handler from executing.

**Acceptance criteria:**
- On mobile (coarse pointer), Enter in textarea inserts newline, does NOT submit
- On desktop, Enter still submits (existing behavior unchanged)
- Shift+Enter behavior unchanged on all platforms
- Send button works on mobile to submit the prompt
- Cleanup function properly removes listeners
- Tests: mock `matchMedia`, verify Enter behavior on mobile vs desktop, verify cleanup
- Tests pass with `cd pi-de && npm test`

Dependencies: none

### Task 3: History pagination protocol and pi-socket server handler

Add the `fetch_history` request/response protocol types to `hyper-pi-protocol` and implement the server-side handler in pi-socket that serves paginated history from the session branch.

**Files to modify:**
- `hyper-pi-protocol/src/index.ts` — Add new types:
  ```typescript
  export interface FetchHistoryRequest {
    type: "fetch_history";
    before: number;  // message index — fetch messages before this index
    limit: number;   // max messages to return
  }
  export interface HistoryPageResponse {
    type: "history_page";
    messages: AgentMessage[];
    hasMore: boolean;
    oldestIndex: number;  // index of the oldest message in this page
  }
  ```
  Update `SocketEvent` union to include `HistoryPageResponse`.
- `pi-socket/src/history.ts` — Add `getHistoryPage(entries, before, limit)` function:
  - Extracts messages from session entries (same logic as `buildInitState`)
  - Returns the slice `[max(0, before-limit) .. before]` plus `hasMore` flag
  - Reuses the same entry-to-message extraction logic (extract to shared helper)
- `pi-socket/src/index.ts` — Modify `ws.on("message")` handler:
  - Try to parse incoming text as JSON
  - If it has `type: "fetch_history"`, call `getHistoryPage()` and `ws.send()` the response
  - Otherwise, fall through to existing `sendUserMessage()` logic
  - JSON parse failure means it's a plain text prompt (most messages) — proceed as before
- `pi-socket/src/types.ts` — Re-export new types from hyper-pi-protocol

**Message routing logic in `ws.on("message")`:**
```typescript
const text = data.toString();
if (!text.trim()) { /* reject empty */ return; }

// Try structured request
let parsed: unknown;
try { parsed = JSON.parse(text); } catch { parsed = null; }
if (parsed && typeof parsed === "object" && (parsed as any).type === "fetch_history") {
  const req = parsed as FetchHistoryRequest;
  const page = getHistoryPage(ctx.sessionManager.getBranch(), req.before, req.limit);
  if (ws.readyState === WebSocket.OPEN) ws.send(safeSerialize(page));
  return;
}

// Plain text prompt — existing logic
```

**Acceptance criteria:**
- `getHistoryPage()` correctly slices messages from session entries
- `getHistoryPage()` returns `hasMore: true` when there are older messages, `false` at beginning
- `getHistoryPage()` handles edge cases: `before=0`, `limit > total messages`, empty entries
- JSON `fetch_history` messages are handled and don't get sent to `pi.sendUserMessage()`
- Plain text prompts (including valid JSON that isn't `fetch_history`) still work as before
- `hyper-pi-protocol` builds: `cd hyper-pi-protocol && npm run build`
- Tests pass with `cd pi-socket && npm test`
- New tests: `getHistoryPage()` unit tests (~8 tests), message routing tests (~4 tests)

Dependencies: none

### Task 4: Pi-DE infinite scroll client with history prepending

Implement the client side of lazy message loading: detect scroll-to-top, send `fetch_history` requests, and prepend older messages to the conversation.

**Files to modify:**
- `pi-de/src/RemoteAgent.ts` — Add:
  - `fetchHistory(before: number, limit: number): void` method that sends JSON `{ type: "fetch_history", before, limit }` over the WebSocket
  - Handle `history_page` response in `handleSocketEvent()`: prepend `messages` to `this._state.messages`, update local state, emit an event so the UI re-renders
  - Track `hasMore` and `oldestIndex` state for pagination cursor
  - Add `onHistoryPage` callback (like `onInitState`) so useAgent can update loading state
- `pi-de/src/useAgent.ts` — Add:
  - `isLoadingHistory` state
  - `oldestIndex` ref tracking the cursor for next fetch
  - Wire `remoteAgent.onHistoryPage` callback to update loading/cursor state
  - `loadOlderMessages()` function that calls `remoteAgent.fetchHistory(oldestIndex, 50)`
  - Initialize `oldestIndex` from `init_state` (message count or a provided index)
  - Return `{ isLoadingHistory, hasMoreHistory, loadOlderMessages }` from the hook
- `pi-de/src/App.tsx` — Add:
  - Destructure `isLoadingHistory`, `hasMoreHistory`, `loadOlderMessages` from `useAgent()`
  - Add a scroll listener (`useEffect`) on the `agentInterfaceRef`'s `.overflow-y-auto` child
  - When `scrollTop === 0` and `hasMoreHistory` and `!isLoadingHistory`, call `loadOlderMessages()`
  - Show a loading indicator (e.g. `<div className="loading-history">Loading older messages…</div>`) above the messages when `isLoadingHistory`
  - After prepending, restore scroll position so content doesn't jump (save `scrollHeight` before prepend, set `scrollTop += newScrollHeight - oldScrollHeight` after)
- `pi-de/src/App.css` — Add `.loading-history` styles

**Scroll position restoration:**
```typescript
const container = agentInterfaceRef.current?.querySelector(".overflow-y-auto");
if (!container) return;
const prevHeight = container.scrollHeight;
// ... after messages prepended (via state update) ...
requestAnimationFrame(() => {
  container.scrollTop += container.scrollHeight - prevHeight;
});
```

**Message prepending in RemoteAgent:**
```typescript
case "history_page": {
  const page = event as HistoryPageResponse;
  this._state = {
    ...this._state,
    messages: [...page.messages, ...this._state.messages],
  };
  this.onHistoryPage?.(page);
  this.emit({ type: "agent_end", messages: this._state.messages });
  break;
}
```

**Acceptance criteria:**
- Scrolling to the top of the conversation triggers a `fetch_history` request
- Older messages are prepended above existing messages
- Scroll position is preserved (no jump) after prepending
- Loading indicator shows while fetching
- When `hasMore` is false, no more fetches are triggered
- Debouncing prevents rapid duplicate requests
- Tests: RemoteAgent `fetchHistory()` sends correct JSON, `history_page` handling prepends messages, scroll detection triggers, loading state transitions
- Tests pass with `cd pi-de && npm test`

Dependencies: Task 3 ("History pagination protocol and pi-socket server handler" — provides `FetchHistoryRequest`/`HistoryPageResponse` types in hyper-pi-protocol and the server endpoint in pi-socket)

### Task 5: Cloudflare tunnel setup documentation

Document how to set up a Cloudflare tunnel so Pi-DE can be accessed from mobile devices on different networks.

**Files to create:**
- `docs/cloudflare-tunnel.md` (new, ~80 lines) — Setup guide

**Content:**
1. **Prerequisites:** `cloudflared` CLI installed, Cloudflare account (free tier works)
2. **Quick tunnel (no account needed):** `cloudflared tunnel --url http://localhost:31415` — creates a temporary public URL for the hypivisor
3. **Named tunnel setup:** `cloudflared tunnel create hyper-pi`, configure `~/.cloudflared/config.yml`:
   ```yaml
   tunnel: hyper-pi
   credentials-file: ~/.cloudflared/<tunnel-id>.json
   ingress:
     - hostname: hyper-pi.yourdomain.com
       service: http://localhost:31415
     - hostname: pide.yourdomain.com
       service: http://localhost:5180
     - service: http_status:404
   ```
4. **Pi-DE configuration:** Set `VITE_HYPIVISOR_PORT` and adjust the WebSocket URL construction in useAgent.ts/useHypivisor.ts if needed (wss:// vs ws://)
5. **Security note:** Always set `HYPI_TOKEN` when exposing over a tunnel. The tunnel provides transport encryption but `HYPI_TOKEN` provides application-level auth.
6. **WebSocket considerations:** Cloudflare tunnels support WebSocket natively — no special config needed.
7. **Mobile testing:** Open the tunnel URL in a mobile browser to access Pi-DE.

**Acceptance criteria:**
- Doc covers quick tunnel and named tunnel setups
- Includes security warnings about HYPI_TOKEN
- References existing env vars (`VITE_HYPIVISOR_PORT`, `HYPI_TOKEN`)
- No code changes required

Dependencies: none

---

```tasks-json
[
  {
    "title": "Responsive mobile layout with roster-to-chat navigation",
    "description": "Implement the mobile-first responsive layout where the roster and chat view are full-screen pages that toggle on agent selection, satisfying R-UI-3.\n\n**Files to modify:**\n- `pi-de/src/App.tsx` — Add `agent-selected` class to `.pi-de-layout` when `activeNode` is non-null. Add a back button inside `.stage-header` that calls `setActiveNode(null)`. The back button should only render on mobile (hidden via CSS on desktop).\n- `pi-de/src/App.css` — Style the `.back-button` in the stage-header (touch-friendly 44px, left-aligned). Verify/fix the existing media query rules at lines 575-600. Add `display: none` for `.back-button` on desktop viewports.\n\n**Implementation details:**\n- The className on the layout div changes from `\"pi-de-layout\"` to `` `pi-de-layout ${activeNode ? \"agent-selected\" : \"\"}` ``\n- The existing CSS rules (`.pi-de-layout.agent-selected .roster-pane { display: none }` and `.pi-de-layout.agent-selected .main-stage { display: flex }`) already handle the visibility toggling\n- The back button goes inside `.stage-header` before the `<h3>`: `<button className=\"back-button\" onClick={() => setActiveNode(null)}>← Back</button>`\n- On desktop (>767px), `.back-button { display: none }` — the sidebar is always visible\n\n**Acceptance criteria:**\n- On viewports <768px, only roster is visible when no agent is selected\n- Clicking an agent card shows full-screen chat, roster is hidden\n- Back button in chat header returns to roster (clears activeNode)\n- Back button is hidden on desktop viewports\n- All existing desktop tests pass unchanged\n- New tests: verify `agent-selected` class toggling, back button click clears selection\n- Tests pass with `cd pi-de && npm test`",
    "dependsOn": []
  },
  {
    "title": "Mobile virtual keyboard Enter-key behavior",
    "description": "On mobile devices, make Enter in the virtual keyboard insert a newline in the prompt textarea instead of submitting. The existing visible Send button in MessageEditor handles submission.\n\n**Files to create/modify:**\n- `pi-de/src/patchMobileKeyboard.ts` (new, ~60 lines) — Module that sets up mobile keyboard interception on the `<agent-interface>` element's textarea\n- `pi-de/src/patchMobileKeyboard.test.ts` (new, ~100 lines) — Tests\n- `pi-de/src/App.tsx` — Import `patchMobileKeyboard` and call it in the `useEffect` that wires the `agentInterfaceRef`, adding its cleanup to the effect return\n\n**Implementation details:**\n- Mobile detection: `window.matchMedia(\"(pointer: coarse)\").matches` as primary signal (targets touch devices). Falls back to `\"ontouchstart\" in window`. Export `isMobileDevice()` for testability.\n- `patchMobileKeyboard(el: HTMLElement): () => void` function:\n  1. Uses `MutationObserver` to find the `textarea` element inside the `<agent-interface>` (it renders in light DOM — `createRenderRoot() { return this; }`)\n  2. Adds a capturing `keydown` listener on the textarea\n  3. If `isMobileDevice()` and `e.key === \"Enter\"` and `!e.shiftKey`: call `e.stopImmediatePropagation()` to prevent MessageEditor's `handleKeyDown` from firing. The default textarea behavior (insert newline) proceeds.\n  4. Returns a cleanup function that removes the listener and disconnects the observer\n- In `App.tsx`'s existing `useEffect` (the one that sets `ai.session`), after wiring the agent: `const cleanup = patchMobileKeyboard(el); return () => { cleanup(); };`\n- The Send button in MessageEditor (onClick: this.handleSend) already works for submission.\n\n**Why `stopImmediatePropagation` works:** Both our capturing listener and MessageEditor's `@keydown` handler are on the same element (the textarea, in light DOM). Our listener registered via `addEventListener(\"keydown\", fn, { capture: true })` fires before Lit's event binding. Calling `stopImmediatePropagation()` prevents MessageEditor's handler from executing.\n\n**Acceptance criteria:**\n- On mobile (coarse pointer), Enter in textarea inserts newline, does NOT submit\n- On desktop, Enter still submits (existing behavior unchanged)\n- Shift+Enter behavior unchanged on all platforms\n- Send button works on mobile to submit the prompt\n- Cleanup function properly removes listeners\n- Tests: mock `matchMedia`, verify Enter behavior on mobile vs desktop, verify cleanup\n- Tests pass with `cd pi-de && npm test`",
    "dependsOn": []
  },
  {
    "title": "History pagination protocol and pi-socket server handler",
    "description": "Add the `fetch_history` request/response protocol types to `hyper-pi-protocol` and implement the server-side handler in pi-socket that serves paginated history from the session branch.\n\n**Files to modify:**\n- `hyper-pi-protocol/src/index.ts` — Add new types:\n  ```typescript\n  export interface FetchHistoryRequest {\n    type: \"fetch_history\";\n    before: number;  // message index — fetch messages before this index\n    limit: number;   // max messages to return\n  }\n  export interface HistoryPageResponse {\n    type: \"history_page\";\n    messages: AgentMessage[];\n    hasMore: boolean;\n    oldestIndex: number;  // index of the oldest message in this page\n  }\n  ```\n  Update `SocketEvent` union to include `HistoryPageResponse`.\n- `pi-socket/src/history.ts` — Add `getHistoryPage(entries: unknown[], before: number, limit: number): HistoryPageResponse` function. Extract the message-extraction logic from `buildInitState` into a shared `extractMessages(entries)` helper. `getHistoryPage` returns the slice `[max(0, before-limit) .. before]` plus `hasMore` flag and `oldestIndex`.\n- `pi-socket/src/index.ts` — Modify `ws.on(\"message\")` handler to detect JSON `fetch_history` requests vs plain text prompts. Try `JSON.parse(text)` — if result has `type === \"fetch_history\"`, handle it. On parse failure or any other type, fall through to existing `sendUserMessage()` logic. Must store `ctx` reference accessible to the handler.\n- `pi-socket/src/types.ts` — Re-export `FetchHistoryRequest` and `HistoryPageResponse` from hyper-pi-protocol.\n\n**Message routing logic in `ws.on(\"message\")`:**\n```typescript\nconst text = data.toString();\nif (!text.trim()) { /* reject empty */ return; }\nlet parsed: unknown;\ntry { parsed = JSON.parse(text); } catch { parsed = null; }\nif (parsed && typeof parsed === \"object\" && (parsed as any).type === \"fetch_history\") {\n  const req = parsed as FetchHistoryRequest;\n  const page = getHistoryPage(ctx.sessionManager.getBranch(), req.before, req.limit);\n  if (ws.readyState === WebSocket.OPEN) ws.send(safeSerialize(page));\n  return;\n}\n// Plain text prompt — existing logic unchanged\n```\n\n**Acceptance criteria:**\n- `getHistoryPage()` correctly slices messages from session entries\n- `getHistoryPage()` returns `hasMore: true` when older messages exist, `false` at beginning\n- Edge cases handled: `before=0`, `limit > total messages`, empty entries, `before > total`\n- JSON `fetch_history` messages are handled and NOT sent to `pi.sendUserMessage()`\n- Plain text prompts (including valid JSON that isn't `fetch_history`) still work as before\n- `hyper-pi-protocol` builds: `cd hyper-pi-protocol && npm run build`\n- New tests: `getHistoryPage()` unit tests (~8 tests), message routing tests (~4 tests)\n- Tests pass with `cd pi-socket && npm test`",
    "dependsOn": []
  },
  {
    "title": "Pi-DE infinite scroll client with history prepending",
    "description": "Implement the client side of lazy message loading: detect scroll-to-top, send `fetch_history` requests, and prepend older messages to the conversation.\n\n**Files to modify:**\n- `pi-de/src/RemoteAgent.ts` — Add:\n  - `fetchHistory(before: number, limit: number): void` method that sends JSON `{ type: \"fetch_history\", before, limit }` over the WebSocket\n  - Handle `history_page` response in `handleSocketEvent()`: prepend `messages` to `this._state.messages`, update local state\n  - Track `hasMore` and `oldestIndex` state properties\n  - Add `onHistoryPage?: (page: HistoryPageResponse) => void` callback\n- `pi-de/src/useAgent.ts` — Add:\n  - `isLoadingHistory` state, `hasMoreHistory` state\n  - `oldestIndex` ref for pagination cursor\n  - Wire `remoteAgent.onHistoryPage` to update loading/cursor state\n  - `loadOlderMessages()` function calling `remoteAgent.fetchHistory(oldestIndex, 50)`\n  - Initialize `oldestIndex` from `init_state` message count\n  - Return `{ isLoadingHistory, hasMoreHistory, loadOlderMessages }` from hook\n- `pi-de/src/App.tsx` — Add:\n  - Destructure new values from `useAgent()`\n  - `useEffect` attaching scroll listener to `agentInterfaceRef`'s `.overflow-y-auto` child\n  - When `scrollTop < 50` and `hasMoreHistory` and `!isLoadingHistory`, call `loadOlderMessages()`\n  - Show loading indicator above messages when `isLoadingHistory`\n  - After prepend, restore scroll position: save `scrollHeight` before, set `scrollTop += newScrollHeight - oldScrollHeight` after\n- `pi-de/src/App.css` — Add `.loading-history` styles (centered spinner/text above messages)\n\n**Scroll position restoration:**\n```typescript\nconst container = agentInterfaceRef.current?.querySelector(\".overflow-y-auto\");\nconst prevHeight = container.scrollHeight;\n// ... after messages prepended ...\nrequestAnimationFrame(() => {\n  container.scrollTop += container.scrollHeight - prevHeight;\n});\n```\n\n**RemoteAgent history_page handling:**\n```typescript\nif (socketEvent.type === \"history_page\") {\n  const page = socketEvent as HistoryPageResponse;\n  this._state = { ...this._state, messages: [...page.messages, ...this._state.messages] };\n  this.onHistoryPage?.(page);\n  this.emit({ type: \"agent_end\", messages: this._state.messages });\n  return;\n}\n```\n\n**Acceptance criteria:**\n- Scrolling to top triggers `fetch_history` request with correct cursor\n- Older messages prepended above existing messages\n- Scroll position preserved (no jump) after prepending\n- Loading indicator visible while fetching\n- No fetches when `hasMore` is false\n- Debouncing prevents rapid duplicate requests\n- Tests: RemoteAgent `fetchHistory()` sends correct JSON, `history_page` handling prepends, useAgent loading state, scroll detection\n- Tests pass with `cd pi-de && npm test`",
    "dependsOn": ["History pagination protocol and pi-socket server handler"]
  },
  {
    "title": "Cloudflare tunnel setup documentation",
    "description": "Document how to set up a Cloudflare tunnel so Pi-DE and the hypivisor can be accessed from mobile devices on different networks.\n\n**Files to create:**\n- `docs/cloudflare-tunnel.md` (new, ~80 lines) — Setup guide\n\n**Content:**\n1. **Prerequisites:** `cloudflared` CLI installed (`brew install cloudflare/cloudflare/cloudflared`), Cloudflare account (free tier works)\n2. **Quick tunnel (no account needed):** `cloudflared tunnel --url http://localhost:31415` — creates a temporary public URL for the hypivisor. Note: this gives you a random `*.trycloudflare.com` subdomain.\n3. **Named tunnel setup:** `cloudflared tunnel create hyper-pi`, configure `~/.cloudflared/config.yml` with ingress rules for both the hypivisor (port 31415) and Pi-DE dev server (port 5180)\n4. **Pi-DE configuration:** When accessing via tunnel, Pi-DE connects to the hypivisor at the tunnel's hostname. Set `VITE_HYPIVISOR_PORT` to 443 (tunnel uses HTTPS). Note that WebSocket upgrades work over Cloudflare tunnels natively.\n5. **Security warning:** ALWAYS set `HYPI_TOKEN` env var on the hypivisor when exposing via tunnel. The tunnel provides transport encryption (TLS) but `HYPI_TOKEN` provides application-level authentication.\n6. **WebSocket note:** Cloudflare tunnels support WebSocket protocol natively — no special configuration needed. The proxy relay through the hypivisor works identically whether local or tunneled.\n7. **Mobile testing workflow:** Start hypivisor + Pi-DE locally, run `cloudflared tunnel`, open the tunnel URL on your phone's browser.\n\n**Acceptance criteria:**\n- Doc covers quick tunnel and named tunnel setups\n- Includes security warnings about HYPI_TOKEN\n- References existing env vars (VITE_HYPIVISOR_PORT, VITE_HYPI_TOKEN, HYPI_TOKEN)\n- Includes example cloudflared config.yml\n- No code changes required",
    "dependsOn": []
  }
]
```
