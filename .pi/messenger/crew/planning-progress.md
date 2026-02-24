# Planning Progress

## Notes
<!-- User notes here are read by the planner on every run.
     Add steering like "ignore auth" or "prioritize performance". -->


---
[2026-02-23T14:07:42.902Z] Re-plan: Implement ALL waves (1-5) from the synthesis in parallel. Each task should be independently executable. Group by file to avoid conflicts. Key files: pi-de/src/useHypivisor.ts, pi-de/src/useAgent.ts, pi-de/src/RemoteAgent.ts, pi-de/src/rpc.ts, pi-de/src/SpawnModal.tsx, pi-socket/src/history.ts, pi-socket/src/safety.ts, hypivisor/src/main.rs, hypivisor/src/state.rs, hypivisor/src/auth.rs. Each task MUST include tests. The multi-agent-per-directory constraint is sacred: NEVER deduplicate by cwd. Read AGENTS.md before implementing anything.

[2026-02-24T03:14:29.967Z] Re-plan: Focus on Pi-DE frontend features first (F1-F6), leave F7 (PID cross-component change) for last. Each task should be independently implementable and testable. Keep tasks small — one feature per task.

[2026-02-24T03:57:39.383Z] Re-plan: Focus on F1 and F2 together (send during streaming + cancel/submit buttons) as one task since they're tightly coupled. F3 (theming) is already mostly done — just needs the TODO updated. F4 (spawn check) and F5 (tool output) are investigation tasks. Keep tasks small — max 4 tasks total.

[2026-02-24T07:21:03.177Z] Re-plan: Implement the remaining features from todo.md. Here's the context:

## What needs to be built (4 features from todo.md)

### Feature 1: Abort/Cancel + Send-during-streaming
The MessageEditor button in Pi-DE needs two states during streaming:
- **Empty input → stop button**: Sends an `abort` message over WebSocket to pi-socket, which calls `ctx.abort()` (confirmed available in pi's ExtensionAPI at `ctx.abort()`)
- **Non-empty input → send button**: Sends the message as a follow-up (already works via patchSendDuringStreaming.ts)

The existing `patchSendDuringStreaming.ts` already handles the UI toggle between stop/send based on input content. What's missing:
1. A new protocol message type: client sends `{"type":"abort"}` JSON over WebSocket
2. pi-socket handler: detect the `abort` JSON message and call `ctx.abort()` 
3. `RemoteAgent.abort()`: currently a no-op, needs to send `{"type":"abort"}` over WebSocket
4. Add the `AbortRequest` type to `hyper-pi-protocol`

### Feature 2: Autocomplete for `/` commands
When the user types "/" in the message editor:
1. New protocol message: `{"type":"list_commands"}` request and `{"type":"commands_list", commands: [...]}` response
2. pi-socket handler: uses pi ExtensionAPI to get available commands/skills
3. Pi-DE: needs autocomplete UI integration with the message editor

### Feature 3: Autocomplete for `@` file references
When the user types "@" in the message editor:
1. New protocol message: `{"type":"list_files", prefix: "..."}` request and `{"type":"files_list", files: [...]}` response
2. pi-socket handler: reads file listings relative to agent's cwd
3. Pi-DE: needs autocomplete UI integration with the message editor

### Feature 4: Attach files
File attachment support:
1. New protocol message: `{"type":"attach_file"}` or binary frame support
2. pi-socket handler: receives file content and includes it in the next user message
3. Pi-DE: file picker/drag-drop UI

## Key files involved:
- `hyper-pi-protocol/` — shared wire types (add new message types here first)
- `pi-socket/src/index.ts` — extension entry point (add handlers)
- `pi-socket/src/types.ts` — re-exports from protocol
- `pi-de/src/RemoteAgent.ts` — WebSocket adapter (implement abort, autocomplete)
- `pi-de/src/patchSendDuringStreaming.ts` — already handles stop/send button toggle
- `pi-de/src/App.tsx` — root component

## Architecture constraints:
- TDD: write tests first
- All protocol types in `hyper-pi-protocol/` package
- pi-socket uses `boundary()` wrapper for safety
- Never modify pi itself — everything is additive
- The `ctx` (ExtensionContext) has: `ctx.abort()`, `ctx.isIdle()`, `ctx.hasPendingMessages()`
- The pi ExtensionAPI has: `pi.sendUserMessage()`, `pi.getAllTools()`, `pi.on()`

## Build commands:
- pi-socket: `cd pi-socket && npm test`
- pi-de: `cd pi-de && npm test`
- protocol: `cd hyper-pi-protocol && npm run build`
- integration-tests: `cd integration-tests && npm test`

Focus on features 1 (abort) first as it's the highest priority (mobile users have no way to cancel), then 2 and 3 (autocomplete), then 4 (file attach).

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

---
## Run: 2026-02-24T03:14:29.967Z — PRD.md

### Pass 1 (03:24)
The task plan is complete. Here's the summary:

## Task Execution Plan

| Wave | Tasks | Description |
|------|-------|-------------|
| **Wave 1** | Tasks 1, 2, 3 | PID field (cross-component), Theming (new hook + CSS), Stage improvements (header/offline/scroll) — all independent |
| **Wave 2** | Task 4 | Roster grouping (depends on Tasks 1 & 3 for PID type + `isAgentStreaming` state) |

**Critical path: 2 waves**

### Task dependency graph:
```
Task 1 (PID)  ──────┐
Task 2 (Theming)     │ (independent)
Task 3 (Stage)  ─────┼──→ Task 4 (Roster)
```

### Key design decisions:
- **F2 (working/idle indicator) split across Tasks 3 & 4**: Task 3 adds `isAgentStreaming` to `useAgent` + stage dot + CSS animation. Task 4 uses it for roster card dot.
- **No standalone types/config task**: Task 1 owns the full PID stack (protocol → pi-socket → hypivisor). Task 3 owns the `useAgent` streaming state addition alongside its real UI work.
- **File conflict minimization**: Tasks 1 (protocol/backend), 2 (hook + CSS vars), and 3 (stage section) touch non-overlapping file sections. Task 4 waits for both 1 and 3 to serialize App.tsx roster changes.

---
## Run: 2026-02-24T03:57:39.382Z — PRD.md

### Pass 1 (04:00)
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

---
## Run: 2026-02-24T07:21:03.177Z — PRD.md

### Pass 1 (07:26)
Now I have complete context. Let me produce the task breakdown.

## 1. PRD Understanding Summary

The PRD specifies 5 QoL features (F1–F5) for Pi-DE. Comparing against the **current codebase**:

| Feature | PRD Spec | Current State |
|---------|----------|---------------|
| **F1**: Send during streaming | Patch `AgentInterface.sendMessage` + `MessageEditor.isStreaming` | ✅ **DONE** — `patchSendDuringStreaming.ts` exists with tests, wired into `App.tsx` |
| **F2**: Cancel + submit buttons | Both stop and send buttons during streaming | ⚠️ **PARTIAL** — MessageEditor conditionally shows stop (empty input) vs send (typed text). But `RemoteAgent.abort()` is a no-op. TODO.md marks `[~]` |
| **F3**: Theming | Support all pi themes | ✅ **DONE** — 7 themes in `piThemes.ts` with 51→CSS token mapping, `<select>` dropdown |
| **F4**: Spawn verification | Manual surf test | ✅ **DONE** — checked in TODO.md |
| **F5**: Tool output investigation | CSS adjustments | ✅ **DONE** — `toolRenderers.ts` with compact TUI-style renderers |

**The sole remaining work**: Implement the abort wire protocol so the stop button (■) actually cancels agent work. This requires changes across 3 components: `hyper-pi-protocol` (types), `pi-socket` (handler calling `ctx.abort()`), and `pi-de` (`RemoteAgent.abort()` sending JSON over WebSocket).

## 2. Relevant Code/Docs/Resources Reviewed

| File | Key Findings |
|------|-------------|
| `TODO.md` | End-to-End section: `[ ] abort/cancel + send-during-streaming` — "Needs a new `abort` WebSocket message type in the protocol, a pi-socket handler that calls `pi.abort()`, and `RemoteAgent.abort()` sending it over WebSocket." |
| `pi-de/src/patchSendDuringStreaming.ts` | Overrides `MessageEditor.isStreaming` to conditionally return true (empty input + streaming → stop ■) or false (text in input → send). The stop button's click handler already calls `AgentInterface.session.abort()` → `RemoteAgent.abort()` |
| `pi-de/src/RemoteAgent.ts:159` | `abort(): void { // Remote agents don't support abort from the web UI }` — **no-op** |
| `pi-socket/src/index.ts:88-138` | `ws.on("message")` handler: parses JSON, handles `fetch_history`, else sends plain text via `pi.sendUserMessage()`. **No abort handling** — `{ "type": "abort" }` falls through to `sendUserMessage`, which is wrong. |
| `pi-socket/.../extensions/types.d.ts:193` | `ExtensionContext` has `abort(): void` — the abort capability exists on `ctx` (passed to `session_start` handler) |
| `pi-socket/.../extensions/types.d.ts:191` | `ExtensionContext` has `isIdle(): boolean` — already used by pi-socket for follow-up logic |
| `hyper-pi-protocol/src/index.ts` | Defines `FetchHistoryRequest`, `HistoryPageResponse`, `SocketEvent`. No `AbortRequest` type yet. |
| `pi-socket/src/index.test.ts` | `mockCtx` has `isIdle: vi.fn()` but **no `abort` mock** — needs updating for abort tests |
| `hypivisor/src/lib.rs` | Bidirectional relay — all WebSocket text frames forwarded transparently between Pi-DE and pi-socket. **No hypivisor changes needed.** |
| `pi-de/src/App.css` | `.btn-cancel-stream` CSS already defined (red border, danger color). But no button in JSX — the stop button lives inside `<message-editor>` via the `isStreaming` patch. |
| `pi-agent-core Agent.abort()` | Calls `this.abortController?.abort()` — stops the LLM stream and agent loop. This is what `ctx.abort()` delegates to. |

## 3. Sequential Implementation Steps

1. **Add `AbortRequest` type to `hyper-pi-protocol/src/index.ts`** — `{ type: "abort" }` interface, exported alongside `FetchHistoryRequest`
2. **Build protocol**: `cd hyper-pi-protocol && npm run build` so downstream packages pick up the type
3. **Add abort handler in `pi-socket/src/index.ts`** — after the `fetch_history` check, detect `{ type: "abort" }` and call `ctx.abort()`. Log at info level.
4. **Add `abort: vi.fn()` to `mockCtx` in `pi-socket/src/index.test.ts`** and add tests: abort message calls `ctx.abort()`, abort doesn't call `sendUserMessage`
5. **Implement `RemoteAgent.abort()` in `pi-de/src/RemoteAgent.ts`** — send `JSON.stringify({ type: "abort" })` over WebSocket if connected
6. **Re-export `AbortRequest` from `pi-de/src/types.ts`** (for type consistency)
7. **Update `pi-de/src/RemoteAgent.test.ts`** — test abort sends JSON, test abort is no-op when disconnected
8. **Update `TODO.md`** — check off the abort/cancel item in the End-to-End section
9. **Run all tests**: `cd pi-socket && npm test`, `cd pi-de && npm test && npm run build && npm run lint`

## 4. Parallelized Task Graph

### Gap Analysis

#### Missing Requirements
- **Abort is fire-and-forget**: `ctx.abort()` is void. Pi-DE gets no confirmation that abort succeeded — the agent will stop streaming and emit `agent_end`, which RemoteAgent already handles by setting `isStreaming = false`. No additional response handling needed.
- **Abort during tool execution**: `ctx.abort()` aborts the current `AbortController`, which cancels the LLM stream. If a bash command is running, it won't be killed (that requires `ctx.abortBash()`). This is acceptable — the TUI's stop button has the same behavior.

#### Edge Cases
- **Abort when not streaming**: `ctx.abort()` is safe to call when idle — the `abortController` is undefined, so `abort()` is a no-op. No guard needed in pi-socket.
- **Rapid abort + send**: User clicks stop (abort) then immediately types and sends. The abort cancels the current stream; the new message arrives via `sendUserMessage` with `deliverAs: "followUp"` because the agent may still be in a streaming state briefly. This is correct behavior.
- **JSON `{ "type": "abort" }` must not fall through to `sendUserMessage`**: Currently, any JSON that's not `fetch_history` is sent as a plain text prompt. The abort handler must `return` before the fallthrough.

#### Security Considerations
- No new security concerns — abort operates within the existing WebSocket trust boundary. Any connected client can already send arbitrary prompts.

#### Testing Requirements
- pi-socket unit tests: abort message calls `ctx.abort()`, abort doesn't trigger `sendUserMessage`, non-abort JSON still treated as prompt
- Pi-DE unit tests: `RemoteAgent.abort()` sends `{ type: "abort" }` JSON, abort is no-op when WebSocket is null or not OPEN
- All existing tests pass (177 pi-de, 94 pi-socket)

## Tasks

### Task 1: Add abort wire protocol type and pi-socket abort handler

Add the `AbortRequest` type to the shared wire protocol and implement the abort message handler in pi-socket.

**hyper-pi-protocol changes** (`hyper-pi-protocol/src/index.ts`):
- Add `AbortRequest` interface: `{ type: "abort" }` — exported alongside `FetchHistoryRequest`
- Add to the client→server message types section (near `FetchHistoryRequest`)
- Run `cd hyper-pi-protocol && npm run build` to compile

**pi-socket changes** (`pi-socket/src/index.ts`):
- In the `ws.on("message")` handler (around line 113), after the `fetch_history` check and before the plain-text prompt fallthrough, add:
  ```typescript
  if (parsed && typeof parsed === "object" && (parsed as any).type === "abort") {
    ctx.abort();
    return;
  }
  ```
- Import `AbortRequest` from `hyper-pi-protocol` in `pi-socket/src/types.ts` re-exports
- Log at info level: `log.info("pi-socket", "abort requested by client")`

**pi-socket test changes** (`pi-socket/src/index.test.ts`):
- Add `abort: vi.fn()` to `mockCtx` in `beforeEach`
- Add test: "calls ctx.abort() when receiving abort message" — send `{ "type": "abort" }` buffer, verify `mockCtx.abort` called and `mockPi.sendUserMessage` NOT called
- Add test: "does not treat abort as a text prompt" — verify `sendUserMessage` is not called for abort messages
- Verify existing `fetch_history` and plain-text tests still pass

**Acceptance criteria**:
- `AbortRequest` type exported from `hyper-pi-protocol`
- pi-socket handles `{ "type": "abort" }` by calling `ctx.abort()` and returning (not falling through to sendUserMessage)
- Tests verify abort handling and no regression
- `cd hyper-pi-protocol && npm run build` passes
- `cd pi-socket && npm test` passes (94+ tests)

Dependencies: none

### Task 2: Implement RemoteAgent.abort() in Pi-DE

Change `RemoteAgent.abort()` from a no-op to sending a JSON abort message over WebSocket, completing the abort control flow from Pi-DE → hypivisor proxy → pi-socket → `ctx.abort()`.

**Pi-DE changes** (`pi-de/src/RemoteAgent.ts`):
- Replace the no-op `abort()` method (line ~159) with:
  ```typescript
  abort(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ type: "abort" }));
  }
  ```
- Remove the comment `// Remote agents don't support abort from the web UI`

**Pi-DE type re-export** (`pi-de/src/types.ts`):
- Add `AbortRequest` to the re-exports from `hyper-pi-protocol`

**Pi-DE test changes** (`pi-de/src/RemoteAgent.test.ts`):
- Add test: "abort() sends abort JSON when connected" — create RemoteAgent, connect to mock WebSocket, call `abort()`, verify `ws.send` called with `'{"type":"abort"}'`
- Add test: "abort() does nothing when WebSocket is null" — call `abort()` on unconnected RemoteAgent, no throw
- Add test: "abort() does nothing when WebSocket is not OPEN" — set `readyState` to CLOSED, call `abort()`, verify `ws.send` not called

**TODO.md update**:
- Change the End-to-End abort item from `[ ]` to `[x]` with note: "abort WebSocket message type added to protocol; pi-socket calls ctx.abort(); RemoteAgent.abort() sends { type: 'abort' } over WebSocket"
- Change the QoL `[~]` cancel button item to `[x]` with updated note

**Acceptance criteria**:
- `RemoteAgent.abort()` sends `{ "type": "abort" }` JSON over WebSocket when connected
- `RemoteAgent.abort()` is a safe no-op when disconnected
- Stop button (■) in MessageEditor now actually cancels agent work end-to-end
- Tests verify send behavior and edge cases
- `cd pi-de && npm test && npm run build && npm run lint` passes (177+ tests)

Dependencies: none

```tasks-json
[
  {
    "title": "Add abort wire protocol type and pi-socket abort handler",
    "description": "Add the `AbortRequest` type to the shared wire protocol and implement the abort message handler in pi-socket.\n\n**hyper-pi-protocol changes** (`hyper-pi-protocol/src/index.ts`):\n- Add `AbortRequest` interface: `{ type: \"abort\" }` — exported alongside `FetchHistoryRequest`\n- Add to the client→server message types section (near `FetchHistoryRequest`)\n- Run `cd hyper-pi-protocol && npm run build` to compile\n\n**pi-socket changes** (`pi-socket/src/index.ts`):\n- In the `ws.on(\"message\")` handler (around line 113), after the `fetch_history` check and before the plain-text prompt fallthrough, add abort detection:\n  ```typescript\n  if (parsed && typeof parsed === \"object\" && (parsed as any).type === \"abort\") {\n    ctx.abort();\n    return;\n  }\n  ```\n- Import `AbortRequest` from `hyper-pi-protocol` in `pi-socket/src/types.ts` re-exports\n- Log at info level: `log.info(\"pi-socket\", \"abort requested by client\")`\n\n**pi-socket test changes** (`pi-socket/src/index.test.ts`):\n- Add `abort: vi.fn()` to `mockCtx` in `beforeEach`\n- Add test: \"calls ctx.abort() when receiving abort message\" — send `{ \"type\": \"abort\" }` buffer, verify `mockCtx.abort` called and `mockPi.sendUserMessage` NOT called\n- Add test: \"does not treat abort as a text prompt\" — verify `sendUserMessage` is not called for abort messages\n- Verify existing `fetch_history` and plain-text tests still pass\n\n**Key implementation detail**: The abort handler MUST be placed after the `fetch_history` check but BEFORE the plain-text prompt fallthrough in the `ws.on(\"message\")` handler. Currently any JSON that's not `fetch_history` falls through to `sendUserMessage()` — the abort check must `return` before that.\n\n**Acceptance criteria**:\n- `AbortRequest` type exported from `hyper-pi-protocol`\n- pi-socket handles `{ \"type\": \"abort\" }` by calling `ctx.abort()` and returning (not falling through to sendUserMessage)\n- Tests verify abort handling and no regression on existing fetch_history/text prompt behavior\n- `cd hyper-pi-protocol && npm run build` passes\n- `cd pi-socket && npm test` passes (94+ tests)",
    "dependsOn": []
  },
  {
    "title": "Implement RemoteAgent.abort() in Pi-DE",
    "description": "Change `RemoteAgent.abort()` from a no-op to sending a JSON abort message over WebSocket, completing the abort control flow from Pi-DE → hypivisor proxy → pi-socket → `ctx.abort()`.\n\n**Pi-DE changes** (`pi-de/src/RemoteAgent.ts`):\n- Replace the no-op `abort()` method (line ~159) with:\n  ```typescript\n  abort(): void {\n    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;\n    this.ws.send(JSON.stringify({ type: \"abort\" }));\n  }\n  ```\n- Remove the comment `// Remote agents don't support abort from the web UI`\n\n**Pi-DE type re-export** (`pi-de/src/types.ts`):\n- Add `AbortRequest` to the re-exports from `hyper-pi-protocol` (the type will be added by the sibling task; if not yet available, define locally as `{ type: \"abort\" }` — the wire format is the contract)\n\n**Pi-DE test changes** (`pi-de/src/RemoteAgent.test.ts`):\n- Add test: \"abort() sends abort JSON when connected\" — create RemoteAgent, connect to mock WebSocket with `readyState = WebSocket.OPEN`, call `abort()`, verify `ws.send` called with `'{\"type\":\"abort\"}'`\n- Add test: \"abort() does nothing when WebSocket is null\" — call `abort()` on unconnected RemoteAgent, no throw\n- Add test: \"abort() does nothing when WebSocket is not OPEN\" — set `readyState` to CLOSED, call `abort()`, verify `ws.send` not called\n\n**TODO.md update**:\n- Change the End-to-End abort/cancel item from `[ ]` to `[x]` with note: \"abort WebSocket message type added to protocol; pi-socket calls ctx.abort(); RemoteAgent.abort() sends { type: 'abort' } over WebSocket\"\n- Change the QoL `[~]` cancel button item to `[x]` with updated note removing the 'abort is a no-op' caveat\n\n**How abort flows end-to-end**: User sees stop button (■) in MessageEditor when streaming with empty input → clicks it → MessageEditor calls `AgentInterface.session.abort()` → `RemoteAgent.abort()` → sends `{\"type\":\"abort\"}` over WebSocket → hypivisor relays transparently → pi-socket receives it → calls `ctx.abort()` → pi's AbortController fires → LLM stream stops → agent emits `agent_end` → RemoteAgent sets `isStreaming=false` → UI updates.\n\n**Acceptance criteria**:\n- `RemoteAgent.abort()` sends `{ \"type\": \"abort\" }` JSON over WebSocket when connected\n- `RemoteAgent.abort()` is a safe no-op when disconnected or WebSocket not OPEN\n- Stop button (■) in MessageEditor now actually cancels agent work end-to-end\n- Tests verify send behavior and edge cases (3 new tests minimum)\n- TODO.md updated to reflect completion\n- `cd pi-de && npm test && npm run build && npm run lint` passes (177+ tests)",
    "dependsOn": []
  }
]
```
