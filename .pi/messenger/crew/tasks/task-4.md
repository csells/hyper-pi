# Live pi agent lifecycle integration tests

Create integration tests that spawn REAL pi agents using the pi CLI, verify they register with hypivisor, appear in the roster, and cleanly deregister on shutdown. This establishes the infrastructure (tmux helpers, pi process management) needed by subsequent integration tasks.

**Files to create/modify:**
- `integration-tests/src/pi-agent-helpers.ts` (new — ~120 lines) — Helper functions for managing real pi agents in tmux
- `integration-tests/src/lifecycle.test.ts` (new — ~180 lines)

**Exported helpers (pi-agent-helpers.ts):**
- `startPiAgent(opts: { cwd: string, hypivisorPort: number, env?: Record<string,string> }): Promise<{ sessionName: string, nodeId: string, port: number }>` — Creates tmux session, starts `pi` with `HYPIVISOR_WS` set, polls hypivisor until registration appears
- `stopPiAgent(sessionName: string): Promise<void>` — Sends `/quit` via tmux send-keys then kills session
- `waitForNode(hypivisorPort: number, predicate: (node: Record<string,unknown>) => boolean, timeoutMs?: number): Promise<Record<string,unknown>>` — Connects to hypivisor, waits for matching node in init or node_joined events

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
- Use tmux for pi processes: `tmux new-session -d -s {name} "HYPIVISOR_WS=ws://localhost:{port}/ws pi"`
- Set generous timeouts (30s per test) since pi startup includes extension loading

**Acceptance criteria:**
- Tests pass with `cd integration-tests && npm test -- --testPathPattern lifecycle`
- All tests clean up tmux sessions and temp dirs
- Multi-agent-per-directory constraint validated
