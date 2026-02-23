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